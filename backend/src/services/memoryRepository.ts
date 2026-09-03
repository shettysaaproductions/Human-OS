import { supabaseAdmin } from '../lib/supabase';
import { ExtractedMemory, Memory, SourceAuthority, SourceDependencyType, SourceProvenanceReport } from '../types/memory';
import { logger } from '../lib/logger';
import { qt } from '../lib/queryTracker';
import { stopWords } from '../utils/nlp';
import { canonicalizeKey, isKnownCanonicalKey } from '../lib/memoryKeySchema';
import { isGarbageMemoryValue } from '../lib/memoryFilters';
import { deterministicGuardian } from './DeterministicGuardianService';
import { sourceDependencyService } from './SourceDependencyService';
import { memoryPolicyService } from './MemoryPolicyService';

// Explicit column list — never use select('*') on memories
const MEMORY_COLUMNS = 'id, user_id, key, value, importance, confidence, frequency, emotional_weight, last_accessed_at, created_at, updated_at, is_archived, memory_type, source_authority, protection_source, protected_at, compression_status, lifecycle_state, superseded_by, superseded_at, supersession_reason, valid_from, valid_until, temporal_precision, temporal_metadata';

// ── Authority rank (higher = more authoritative) ──────────────────────────────
const AUTHORITY_RANK: Record<SourceAuthority, number> = {
  subconscious_inference: 1,
  confirmed_memory:       2,
  deterministic:          3,
  explicit_user:          4,
  needs_review:           0, // reconciliation placeholder — always overwriteable
};

function authorityRank(a?: string | null): number {
  return AUTHORITY_RANK[(a ?? 'subconscious_inference') as SourceAuthority] ?? 1;
}

// ── Generic entity value blocklist ────────────────────────────────────────────
// These are relational nouns, NOT proper names. Storing them as a _name value
// is a Category Error — they must never overwrite a real name like "Sakshi".
// Applied only when source_authority = subconscious_inference AND key ends _name.
const GENERIC_ENTITY_VALUES = new Set([
  'wife', 'husband', 'mom', 'mother', 'dad', 'father', 'bhai', 'brother',
  'sister', 'son', 'daughter', 'didi', 'bhabhi', 'nana', 'nani', 'dada',
  'dadi', 'spouse', 'partner', 'girlfriend', 'boyfriend', 'friend', 'yaar',
]);

function isGenericEntityValue(key: string, value: string, authority?: string): boolean {
  if (authority !== 'subconscious_inference') return false;
  if (!key.endsWith('_name')) return false;
  return GENERIC_ENTITY_VALUES.has(value.toLowerCase().trim());
}

/**
 * Identifies if a memory value or statement describes a historical/past fact
 * (e.g. "Worked at Company A in 2023", "ex-founder", "formerly").
 */
function isHistoricalFact(val: string, sourceMessage?: string, factClass?: string, isHistorical?: boolean): boolean {
  if (isHistorical === true || factClass === 'HISTORICAL_FACT') return true;
  const historicalPattern = /\b(in\s+(?:19\d\d|20[0-2]\d)|pehle|formerly|previously|used to|worked at.*in\s+\d{4}|ex-|past|purana|purani)\b/i;
  if (historicalPattern.test(val)) return true;
  if (sourceMessage && historicalPattern.test(sourceMessage)) return true;
  return false;
}

export class MemoryRepository {
  /**
   * Phase 2F-A: Upserts a memory with authoritative supersession and state preservation.
   *
   * Invariants:
   * 1. EXPLICIT CORRECTION SUPERSESSION: When a new higher-authority fact arrives for an
   *    existing CURRENT canonical key with a conflicting value, supersede ONLY that conflicting
   *    current representation.
   * 2. PROVENANCE PRESERVATION: The old row is marked `is_archived = true`, `lifecycle_state = 'SUPERSEDED'`,
   *    and linked via `superseded_by = new_memory_id`. Zero physical DELETEs occur.
   * 3. HISTORICAL PRESERVATION: Distinct historical facts (e.g. "Worked at Company A in 2023")
   *    are assigned `lifecycle_state = 'HISTORICAL'` and are NOT superseded by current facts.
   * 4. PROPOSED MEMORY SAFETY: Proposed memories (`compression_status = 'proposed'`) NEVER supersede
   *    or overwrite CURRENT facts.
   * 5. IDEMPOTENCY: Repeated identical assertions reinforce frequency/importance without supersession churn.
   * 6. AUTHORITY HIERARCHY: Lower authority cannot supersede higher authority without explicit correction intent.
   */
  async upsertMemory(userId: string, memory: ExtractedMemory, sourceMessage: string): Promise<void> {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await this._upsertMemoryImpl(userId, memory, sourceMessage);
        return;
      } catch (err: any) {
        if (err.message === 'CONCURRENT_INSERT_RETRY' && attempt < 3) {
          logger.warn(`[MemoryRepository] Retrying upsert due to concurrent insert`, { key: memory.key, attempt });
          continue;
        }
        throw err;
      }
    }
  }

  private async _upsertMemoryImpl(userId: string, memory: ExtractedMemory, sourceMessage: string): Promise<void> {
    if (!memory.shouldPersist) return;

    // Privacy gate: when MEMORY_ENABLED is false, no new persistent semantic memory may be created.
    // This is the final defense — callers should also check early, but this ensures queued workers cannot bypass.
    if (!(await memoryPolicyService.isMemoryEnabled(userId))) {
      logger.info('[MemoryRepository] Blocked memory write — memory paused', { userId, key: memory.key, reason: 'MEMORY_PAUSED' });
      return;
    }

    // ── Layer 0: Canonical key normalization ──────────────────────────────────
    const { canonical: canonicalKey, wasAliased } = canonicalizeKey(memory.key);
    if (wasAliased) {
      logger.info('[MemoryRepository] Key canonicalized', {
        userId, originalKey: memory.key, canonicalKey
      });
    }
    const normalizedMemory: ExtractedMemory = wasAliased
      ? { ...memory, key: canonicalKey }
      : memory;

    // ── Layer 0b: Explicit canonical membership (authoritative schema) ────────
    // Every semantic memory key must be a member of the approved canonical set.
    // Known aliases are already normalized above; unknown arbitrary keys remain
    // non-canonical and must fail closed with zero mutation.
    if (!isKnownCanonicalKey(normalizedMemory.key)) {
      logger.warn('[MemoryRepository] Blocked non-canonical key', { userId, key: normalizedMemory.key, reason: 'NON_CANONICAL_KEY' });
      return;
    }

    const incomingAuthority = normalizedMemory.source_authority ?? 'subconscious_inference';

    // ── Layer 1: Generic entity value blocklist ───────────────────────────────
    if (isGenericEntityValue(normalizedMemory.key, normalizedMemory.value, incomingAuthority)) {
      logger.info('[MemoryRepository] BLOCKED generic entity value', {
        userId, canonicalKey: normalizedMemory.key, reason: 'GENERIC_ENTITY_VALUE', authority: incomingAuthority
      });
      return;
    }

    // ── Layer 1b: Shared garbage admission guard ──────────────────────────────
    if (isGarbageMemoryValue(normalizedMemory.key, normalizedMemory.value, 'memoryRepository')) {
      return;
    }

    // ── Layer 1c: Proposed, Historical & Future Intent Classification ────────
    const isProposed = normalizedMemory.compression_status === 'proposed';
    const isFutureIntent = normalizedMemory.is_future_intent === true || normalizedMemory.temporal_metadata?.is_future_intent === true;
    const isHistorical = !isFutureIntent && (
      normalizedMemory.lifecycle_state === 'HISTORICAL' ||
      normalizedMemory.temporal_status === 'HISTORICAL' ||
      isHistoricalFact(normalizedMemory.value, sourceMessage, (normalizedMemory as any).factClass, normalizedMemory.is_historical)
    );
    const isExplicitUnknown = !isHistorical && !isFutureIntent && (
      normalizedMemory.lifecycle_state === ('UNKNOWN' as any) ||
      normalizedMemory.temporal_status === 'UNKNOWN'
    );

    const incomingLifecycleState: string = isProposed
      ? 'PROPOSED'
      : isHistorical
      ? 'HISTORICAL'
      : isFutureIntent || isExplicitUnknown
      ? 'UNKNOWN'
      : 'CURRENT';

    const validFrom = normalizedMemory.valid_from ?? normalizedMemory.temporal_metadata?.valid_from ?? null;
    const validUntil = normalizedMemory.valid_until ?? normalizedMemory.temporal_metadata?.valid_until ?? null;
    const temporalPrecision = normalizedMemory.temporal_precision ?? normalizedMemory.temporal_metadata?.precision ?? 'unknown';
    const temporalMetadata = normalizedMemory.temporal_metadata ?? (validFrom ? {
      temporal_status: isHistorical ? 'HISTORICAL' : isFutureIntent ? 'UNKNOWN' : 'CURRENT',
      valid_from: validFrom,
      valid_until: validUntil,
      precision: temporalPrecision,
      is_future_intent: isFutureIntent,
    } : {});

    try {
      // ── Layer 2: Query ALL active/unarchived rows for this canonical key ────
      const { data: existingRows, error: fetchErr } = await qt.track('upsert_memory_check', 'memories', () =>
        supabaseAdmin
          .from('memories')
          .select('id, user_id, key, value, importance, confidence, frequency, emotional_weight, source_authority, is_archived, protection_source, lifecycle_state, compression_status, created_at, updated_at')
          .eq('user_id', userId)
          .eq('key', normalizedMemory.key)
          .eq('is_archived', false)
      );

      if (fetchErr) {
        throw new Error(`Failed to query existing memories: ${fetchErr.message}`);
      }

      const activeRows = (existingRows || []) as any[];

      // Filter out PROPOSED or INVALIDATED rows from consideration as existing CURRENT facts
      const currentActiveRows = activeRows.filter(r =>
        !r.is_archived &&
        r.lifecycle_state !== 'SUPERSEDED' &&
        r.lifecycle_state !== 'INVALIDATED' &&
        r.compression_status !== 'proposed'
      );

      // Check for exact matching value (Idempotent update / Reinforcement)
      const matchingRow = currentActiveRows.find(
        r => (r.value || '').toLowerCase().trim() === (normalizedMemory.value || '').toLowerCase().trim()
      );

      if (matchingRow) {
        // Idempotent reinforcement: Increment frequency and importance safely
        const newImportance = Math.min((matchingRow.importance || 50) + 5, 100);
        const newFrequency = (matchingRow.frequency || 1) + 1;

        await qt.track('upsert_memory_reinforce', 'memories', () =>
          supabaseAdmin
            .from('memories')
            .update({
              importance: Math.max(newImportance, normalizedMemory.importance),
              confidence: Math.max(matchingRow.confidence || 0.8, normalizedMemory.confidence),
              frequency: newFrequency,
              emotional_weight: normalizedMemory.emotional_weight ?? matchingRow.emotional_weight ?? 0,
              source_message: sourceMessage,
              source_authority: authorityRank(incomingAuthority) >= authorityRank(matchingRow.source_authority)
                ? incomingAuthority
                : matchingRow.source_authority,
              updated_at: new Date().toISOString(),
              last_accessed_at: new Date().toISOString(),
              ...(normalizedMemory.is_protected ? {
                protection_source: normalizedMemory.protection_source || 'system',
                protected_at: new Date().toISOString()
              } : {}),
            })
            .eq('id', matchingRow.id)
            .eq('user_id', userId)
        );

        logger.debug('[MemoryRepository] Memory reinforced (idempotent)', {
          key: normalizedMemory.key,
          userId,
          memoryId: matchingRow.id,
          frequency: newFrequency
        });
        return;
      }

      const executeInsert = async (payload: any, trackerName: string) => {
        const { data, error } = await qt.track(trackerName, 'memories', () =>
          supabaseAdmin.from('memories').insert(payload).select('id').maybeSingle()
        );
        if (error) {
          const errMsg = error.message || '';
          if (error.code === '23505' || errMsg.includes('unique constraint')) {
            logger.warn(`[MemoryRepository] Concurrent CURRENT row insertion blocked by DB unique index. Retrying...`, { payloadKey: payload.key, error: errMsg });
            throw new Error('CONCURRENT_INSERT_RETRY');
          }
          if (
            errMsg.includes('schema cache') ||
            errMsg.includes('Could not find') ||
            errMsg.includes('does not exist') ||
            error.code === '42703' ||
            error.code === 'PGRST204'
          ) {
            const fallbackPayload = { ...payload };
            delete fallbackPayload.valid_from;
            delete fallbackPayload.valid_until;
            delete fallbackPayload.temporal_precision;
            delete fallbackPayload.temporal_metadata;
            const resFallback = await qt.track(`${trackerName}_fallback`, 'memories', () =>
              supabaseAdmin.from('memories').insert(fallbackPayload).select('id').maybeSingle()
            );
            if (resFallback.error && (resFallback.error.code === '23505' || resFallback.error.message.includes('unique constraint'))) {
               logger.warn(`[MemoryRepository] Concurrent CURRENT row insertion blocked by DB unique index (fallback).`, { payloadKey: payload.key });
               throw new Error('CONCURRENT_INSERT_RETRY');
            }
            if (resFallback.error) {
              throw new Error(`Failed to insert memory (fallback): ${resFallback.error.message}`);
            }
            return resFallback;
          }
          throw new Error(`Failed to insert memory: ${error.message} (Code: ${error.code})`);
        }
        return { data, error: null };
      };

      // If incoming memory is PROPOSED, insert it as PROPOSED without superseding any CURRENT rows
      if (isProposed) {
        await executeInsert({
          user_id: userId,
          memory_type: normalizedMemory.type,
          key: normalizedMemory.key,
          value: normalizedMemory.value,
          importance: normalizedMemory.importance,
          confidence: normalizedMemory.confidence,
          emotional_weight: normalizedMemory.emotional_weight ?? 0,
          source_message: sourceMessage,
          source_message_id: (normalizedMemory as any).source_message_id || null,
          source_authority: incomingAuthority,
          is_archived: false,
          lifecycle_state: 'PROPOSED',
          compression_status: 'proposed',
          ...(normalizedMemory.source_references ? { source_references: normalizedMemory.source_references } : {}),
          valid_from: validFrom,
          valid_until: validUntil,
          temporal_precision: temporalPrecision,
          temporal_metadata: temporalMetadata,
          last_accessed_at: new Date().toISOString(),
        }, 'upsert_memory_insert_proposed');
        return;
      }

      // If incoming memory is HISTORICAL, insert it as HISTORICAL (do NOT supersede CURRENT rows)
      if (isHistorical) {
        await executeInsert({
          user_id: userId,
          memory_type: normalizedMemory.type,
          key: normalizedMemory.key,
          value: normalizedMemory.value,
          importance: normalizedMemory.importance,
          confidence: normalizedMemory.confidence,
          emotional_weight: normalizedMemory.emotional_weight ?? 0,
          source_message: sourceMessage,
          source_message_id: (normalizedMemory as any).source_message_id || null,
          source_authority: incomingAuthority,
          is_archived: false,
          lifecycle_state: 'HISTORICAL',
          valid_from: validFrom,
          valid_until: validUntil,
          temporal_precision: temporalPrecision,
          temporal_metadata: temporalMetadata,
          last_accessed_at: new Date().toISOString(),
          ...(normalizedMemory.is_protected ? {
            protection_source: normalizedMemory.protection_source || 'system',
            protected_at: new Date().toISOString()
          } : {}),
          ...(normalizedMemory.source_references ? { source_references: normalizedMemory.source_references } : {}),
          ...(normalizedMemory.compression_status ? { compression_status: normalizedMemory.compression_status } : {}),
        }, 'upsert_memory_insert_historical');
        logger.info('[MemoryRepository] Historical memory preserved & inserted', {
          canonicalKey: normalizedMemory.key,
          userId,
          lifecycleState: 'HISTORICAL',
          hasValidFrom: !!validFrom,
          temporalPrecision
        });
        return;
      }

      // If incoming memory is FUTURE INTENT or EXPLICIT UNKNOWN, insert without superseding CURRENT rows
      if (isFutureIntent || isExplicitUnknown) {
        await executeInsert({
          user_id: userId,
          memory_type: normalizedMemory.type,
          key: normalizedMemory.key,
          value: normalizedMemory.value,
          importance: normalizedMemory.importance,
          confidence: normalizedMemory.confidence,
          emotional_weight: normalizedMemory.emotional_weight ?? 0,
          source_message: sourceMessage,
          source_message_id: (normalizedMemory as any).source_message_id || null,
          source_authority: incomingAuthority,
          is_archived: false,
          lifecycle_state: 'UNKNOWN',
          valid_from: validFrom,
          valid_until: validUntil,
          temporal_precision: temporalPrecision,
          temporal_metadata: temporalMetadata,
          last_accessed_at: new Date().toISOString(),
          ...(normalizedMemory.is_protected ? {
            protection_source: normalizedMemory.protection_source || 'system',
            protected_at: new Date().toISOString()
          } : {}),
          ...(normalizedMemory.source_references ? { source_references: normalizedMemory.source_references } : {}),
        }, 'upsert_memory_insert_future_or_unknown');
        logger.info('[MemoryRepository] Future intent / unknown memory inserted without supersession', {
          canonicalKey: normalizedMemory.key,
          userId,
          lifecycleState: 'UNKNOWN',
          isFutureIntent
        });
        return;
      }

      // Find conflicting CURRENT row(s) to supersede
      // (Exclude rows that are explicitly HISTORICAL or UNKNOWN)
      const conflictingCurrentRow = currentActiveRows.find(
        r => r.lifecycle_state !== 'HISTORICAL' && r.lifecycle_state !== 'UNKNOWN' && !isHistoricalFact(r.value)
      );

      const isCorrection = normalizedMemory.correction_intent === true;

      // For corrections, ALWAYS route through the atomic RPC to enforce provenance gating.
      // The RPC handles both cases: existing CURRENT (supersede) and no CURRENT (fresh insert).
      // This ensures: missing/nonexistent/cross-user/assistant provenance -> MISSING_PROVENANCE + zero mutation.
      if (isCorrection || conflictingCurrentRow) {
        // Authority hierarchy check (only applies when superseding existing CURRENT):
        if (conflictingCurrentRow) {
          const existingRank = authorityRank(conflictingCurrentRow.source_authority);
          const incomingRank = authorityRank(incomingAuthority);

          if (existingRank > incomingRank && !isCorrection) {
            logger.info('[MemoryRepository] BLOCKED lower-authority overwrite', {
              userId,
              key: normalizedMemory.key,
              existingAuthority: conflictingCurrentRow.source_authority,
              incomingAuthority,
            });
            return;
          }
        }

        // Authoritative atomic execution via RPC.
        // Validates provenance, enforces ordering, supersedes if needed, inserts new CURRENT.
        const rpcPayload = {
          p_user_id: userId,
          p_key: normalizedMemory.key,
          p_new_value: normalizedMemory.value,
          p_memory_type: normalizedMemory.type,
          p_importance: conflictingCurrentRow
            ? Math.max(conflictingCurrentRow.importance || 50, normalizedMemory.importance ?? 50)
            : (normalizedMemory.importance ?? 50),
          p_confidence: normalizedMemory.confidence ?? 0.8,
          p_emotional_weight: normalizedMemory.emotional_weight ?? (conflictingCurrentRow?.emotional_weight ?? 0),
          p_source_message: sourceMessage,
          p_source_message_id: (normalizedMemory as any).source_message_id || null,
          p_source_authority: incomingAuthority,
          p_is_protected: normalizedMemory.is_protected || !!conflictingCurrentRow?.protection_source,
          p_protection_source: normalizedMemory.protection_source || conflictingCurrentRow?.protection_source || 'system',
          p_source_references: normalizedMemory.source_references || null,
          p_compression_status: normalizedMemory.compression_status || null,
          p_valid_from: validFrom,
          p_valid_until: validUntil,
          p_temporal_precision: temporalPrecision,
          p_temporal_metadata: temporalMetadata
        };

        const { data: rpcResult, error: rpcError } = await qt.track('upsert_memory_atomic_supersede', 'memories', () =>
          supabaseAdmin.rpc('atomic_supersede_memory', rpcPayload)
        );

        if (rpcError) {
          throw new Error(`Failed to execute atomic supersession: ${rpcError.message}`);
        }

        if (rpcResult && rpcResult.success === false) {
          if (rpcResult.reason === 'STALE_WRITE') {
            logger.warn(`[MemoryRepository] Blocked stale write. Incoming message is older than current memory's source.`, { userId, key: normalizedMemory.key });
            return;
          }
          if (rpcResult.reason === 'MISSING_PROVENANCE') {
            logger.warn(`[MemoryRepository] Blocked correction with invalid provenance`, { userId, key: normalizedMemory.key, detail: rpcResult.detail });
            return;
          }
          if (rpcResult.reason === 'NON_CANONICAL_KEY') {
            logger.warn(`[MemoryRepository] Blocked non-canonical key`, { userId, key: normalizedMemory.key, detail: rpcResult.detail });
            return;
          }
          throw new Error(`Atomic supersession failed: ${rpcResult.reason}`);
        }

        if (conflictingCurrentRow) {
          logger.info('[MemoryRepository] Conflicting CURRENT memory SUPERSEDED atomically', {
            userId,
            canonicalKey: normalizedMemory.key,
            oldMemoryId: rpcResult?.superseded_id,
            newMemoryId: rpcResult?.new_id,
            reason: 'SUPERSEDED_VIA_PROVENANCE',
            outcome: 'exactly_one_CURRENT',
            incomingAuthority
          });
        } else {
          logger.info('[MemoryRepository] Correction inserted atomically with provenance validation', {
            userId,
            canonicalKey: normalizedMemory.key,
            newMemoryId: rpcResult?.new_id,
            reason: 'CORRECTION_ATOMIC_INSERT',
            outcome: 'exactly_one_CURRENT',
            incomingAuthority
          });
        }

        // Pre-Heartbeat Hardening: Invalidate stale working memory for this canonical key
        await this.invalidateStaleWorkingMemory(userId, normalizedMemory.key, normalizedMemory.value);
      } else {
        // No conflicting CURRENT row found and not a correction: clean fresh insert
        await executeInsert({
          user_id: userId,
          memory_type: normalizedMemory.type,
          key: normalizedMemory.key,
          value: normalizedMemory.value,
          importance: normalizedMemory.importance,
          confidence: normalizedMemory.confidence,
          emotional_weight: normalizedMemory.emotional_weight ?? 0,
          source_message: sourceMessage,
          source_message_id: (normalizedMemory as any).source_message_id || null,
          source_authority: incomingAuthority,
          is_archived: false,
          lifecycle_state: incomingLifecycleState,
          valid_from: validFrom,
          valid_until: validUntil,
          temporal_precision: temporalPrecision,
          temporal_metadata: temporalMetadata,
          last_accessed_at: new Date().toISOString(),
          ...(normalizedMemory.is_protected ? {
            protection_source: normalizedMemory.protection_source || 'system',
            protected_at: new Date().toISOString()
          } : {}),
          ...(normalizedMemory.source_references ? { source_references: normalizedMemory.source_references } : {}),
          ...(normalizedMemory.compression_status ? { compression_status: normalizedMemory.compression_status } : {}),
        }, 'upsert_memory_insert_fresh');

        logger.debug('[MemoryRepository] Fresh memory inserted', {
          key: normalizedMemory.key,
          userId,
          authority: incomingAuthority,
          lifecycleState: incomingLifecycleState
        });

        // If authoritative or explicit correction, invalidate any conflicting working memory rows
        if (authorityRank(incomingAuthority) >= authorityRank('deterministic') || normalizedMemory.correction_intent) {
          await this.invalidateStaleWorkingMemory(userId, normalizedMemory.key, normalizedMemory.value);
        }
      }

      // Phase 2A: Non-blocking Guardian mutation observation trigger
      setImmediate(() => {
        deterministicGuardian.runMutationScan(userId, 'memory', normalizedMemory.key).catch(gErr => {
          logger.debug('[MemoryRepository] Guardian observation non-fatal error', { error: gErr?.message });
        });
      });
    } catch (err) {
      logger.error('Failed to upsert memory', { error: err instanceof Error ? err.message : String(err), canonicalKey: memory.key, reason: 'UPSERT_FAILED' });
      throw err;
    }
  }

  /**
   * Explicitly protects a memory from pruning or overwriting
   */
  async protectMemory(userId: string, memoryId: string, source: string): Promise<void> {
    await qt.track('protect_memory', 'memories', () =>
      supabaseAdmin
        .from('memories')
        .update({
          protection_source: source,
          protected_at: new Date().toISOString()
        })
        .eq('id', memoryId)
        .eq('user_id', userId)
    );
    logger.info('Memory protected', { memoryId, userId, source });
  }

  /**
   * Default forget semantics: Archive and redact from active retrieval,
   * but keep the row for potential system audits or compaction reconciliation.
   * Returns true if a row was archived, false if not found.
   */
  async forgetMemory(userId: string, memoryId: string): Promise<boolean> {
    const { data, error } = await qt.track('forget_memory', 'memories', () =>
      supabaseAdmin
        .from('memories')
        .update({ is_archived: true, updated_at: new Date().toISOString() })
        .eq('id', memoryId)
        .eq('user_id', userId)
        .select('id')
    );

    if (error) {
      logger.error('[MemoryRepository] Failed to forget memory', { userId, memoryId, error: error.message });
      return false;
    }

    const forgotten = (data || []).length > 0;
    if (forgotten) {
      logger.info('[MemoryRepository] Memory forgotten (archived)', { memoryId, userId });
    }
    return forgotten;
  }

  /**
   * Explicit hard delete. Use ONLY when explicitly requested by user for GDPR
   * or complete purging.
   */
  async forgetMemoryCompletely(userId: string, memoryId: string): Promise<void> {
    await qt.track('forget_memory_completely', 'memories', () =>
      supabaseAdmin
        .from('memories')
        .delete()
        .eq('id', memoryId)
        .eq('user_id', userId)
    );
    logger.info('Memory forgotten completely (hard delete)', { memoryId, userId });
  }

  /**
   * Retrieves memories for a user, bounding to top 3 using Supabase RPC.
   * Falls back to in-process scoring if RPC fails.
   */
  async searchMemories(userId: string, keywords: string[]): Promise<Memory[]> {
    try {
      const query = keywords.join(' ');
      
      // 1. Try RPC First
      const { data: rpcData, error: rpcError } = await qt.track('search_memories_rpc', 'memories', () =>
        supabaseAdmin.rpc('search_relevant_memories', {
          p_user_id: userId,
          p_query: query,
          p_limit: 3
        })
      );

      if (!rpcError && rpcData) {
        // Track estimated egress saved (assume fallback would pull ~200 rows of 300 bytes = 60,000, RPC pulled 3 rows = 900)
        qt.recordEgressSaved(60000 - (rpcData.length * 300));
        return rpcData as Memory[];
      }

      // Log RPC Failure
      logger.warn('RPC search_relevant_memories failed, falling back to JS scoring', { 
        error: rpcError?.message, userId 
      });

      // 2. Fallback Mode (limit to 50 as requested)
      const fallbackLimit = 50;

      const { data, error } = await qt.track('search_memories_fallback', 'memories', () =>
        supabaseAdmin
          .from('memories')
          .select(MEMORY_COLUMNS)
          .eq('user_id', userId)
          .eq('is_archived', false)
          .order('importance', { ascending: false })
          .limit(fallbackLimit)
      );

      if (error) throw new Error(error.message);

      const memories = (data || []) as Memory[];
      if (memories.length === 0) return [];

      const now = Date.now();

      // Score memories in JS
      const effectiveKeywords = keywords.filter(kw => !stopWords.has(kw.toLowerCase()));
      const scoredMemories = memories.map(mem => {
        const normImportance = Math.min(100, Math.max(1, mem.importance)) / 100;
        let matches = 0;
        const keyLower = mem.key.toLowerCase();
        const valLower = mem.value.toLowerCase();
        for (const kw of keywords) {
          if (keyLower.includes(kw) || valLower.includes(kw)) matches++;
        }
        const relevance = effectiveKeywords.length > 0 ? Math.min(1.0, matches / effectiveKeywords.length) : 0;
        const targetDate = mem.last_accessed_at || mem.created_at;
        const daysOld = (now - new Date(targetDate).getTime()) / (1000 * 60 * 60 * 24);
        const recency = Math.max(0, 1 - daysOld / 30);
        const normFrequency = Math.min(10, Math.max(1, mem.frequency || 1)) / 10;
        const normEmotion = Math.min(10, Math.abs(mem.emotional_weight || 0)) / 10;
        
        // JS version doesn't perfectly match the new RPC weighting, but it's just a fallback
        const final_score = normImportance * 0.25 + relevance * 0.25 + recency * 0.10 + normFrequency * 0.10 + normEmotion * 0.10 + 0.20; // 0.20 buffer for missing fields

        return { mem, final_score, normImportance };
      });

      scoredMemories.sort((a, b) => b.final_score - a.final_score);

      const selected: Memory[] = [];
      const selectedIds = new Set<string>();

      for (const item of scoredMemories) {
        if (selected.length < 2) {
          selected.push(item.mem);
          selectedIds.add(item.mem.id);
        } else break;
      }

      scoredMemories.sort((a, b) => b.normImportance - a.normImportance);
      for (const item of scoredMemories) {
        if (!selectedIds.has(item.mem.id)) {
          selected.push(item.mem);
          break;
        }
      }

      // Fire-and-forget: update last_accessed_at and retrieval_count
      if (selected.length > 0) {
        const memoryIds = selected.map(m => m.id);
        
        // Fetch current retrieval_count to increment it (simple approximation for JS fallback)
        qt.track('update_fallback_access', 'memories', () =>
          supabaseAdmin
            .from('memories')
            .update({ last_accessed_at: new Date().toISOString() }) // Supabase REST doesn't support increment directly easily
            .in('id', memoryIds)
        ).catch(err => logger.warn('Failed to update last_accessed_at in fallback', { error: err.message }));
      }

      return selected;
    } catch (err) {
      logger.error('Failed to search memories', { error: err instanceof Error ? err.message : String(err), keywords });
      return [];
    }
  }

  /**
   * Phase 2C Safe Deterministic Repair Operation: Archive Memory
   * Safely marks a memory as archived without physical deletion.
   */
  async archiveMemory(userId: string, memoryId: string, reason: string): Promise<boolean> {
    try {
      const { data, error } = await qt.track('mem_repo_archive', 'memories', () =>
        supabaseAdmin
          .from('memories')
          .update({
            is_archived: true,
            updated_at: new Date().toISOString(),
          })
          .eq('id', memoryId)
          .eq('user_id', userId)
          .select('id')
      );

      if (error) {
        logger.error('[MemoryRepository] Failed to archive memory', { userId, memoryId, error: error.message });
        return false;
      }

      logger.info('[MemoryRepository] Memory archived via canonical repository', { userId, memoryId, reason });
      return (data || []).length > 0;
    } catch (err: any) {
      logger.error('[MemoryRepository] archiveMemory error', { userId, memoryId, error: err?.message });
      return false;
    }
  }

  /**
   * Phase 2F: Safe Unarchive — restores an archived memory without creating duplicate CURRENT.
   * Invariants:
   *  - Ownership is validated (userId must match)
   *  - Only legitimately archived CURRENT memories are user-unarchivable
   *  - Never resurrect SUPERSEDED, HISTORICAL, INVALIDATED, PROPOSED, UNKNOWN
   *  - Cannot create two CURRENT rows for same canonical key (pre-check + DB constraint race guard)
   *  - Preserves lifecycle_state, only flips is_archived
   * Returns {success, reason} — reason is stable code like SUPERSEDED/HISTORICAL/DUPLICATE_CURRENT
   */
  async unarchiveMemory(userId: string, memoryId: string): Promise<{ success: boolean; reason?: string }> {
    try {
      // Fetch target with ownership check
      const { data: target, error: fetchErr } = await qt.track('mem_repo_unarchive_fetch', 'memories', () =>
        supabaseAdmin
          .from('memories')
          .select('id, key, value, lifecycle_state, is_archived, user_id')
          .eq('id', memoryId)
          .eq('user_id', userId)
          .maybeSingle()
      );

      if (fetchErr) {
        logger.error('[MemoryRepository] Failed to fetch memory for unarchive', { userId, memoryId, error: fetchErr.message });
        return { success: false, reason: 'FETCH_ERROR' };
      }

      if (!target) {
        return { success: false, reason: 'NOT_FOUND' };
      }

      if (!target.is_archived) {
        // Already active — idempotent success
        return { success: true };
      }

      // Privacy gate: when MEMORY_ENABLED is false, do not restore archived memory to active
      if (!(await memoryPolicyService.isMemoryEnabled(userId))) {
        logger.info('[MemoryRepository] Blocked unarchive — memory paused', { userId, memoryId, reason: 'MEMORY_PAUSED' });
        return { success: false, reason: 'MEMORY_PAUSED' };
      }

      // Only legitimately archived CURRENT memories are user-unarchivable.
      // Never resurrect non-CURRENT lifecycle states.
      const ls = target.lifecycle_state as string | null | undefined;
      if (ls === 'SUPERSEDED') {
        logger.warn('[MemoryRepository] Blocked unarchive of superseded row', { userId, memoryId, key: target.key });
        return { success: false, reason: 'SUPERSEDED' };
      }
      if (ls === 'HISTORICAL') {
        logger.warn('[MemoryRepository] Blocked unarchive of historical row as CURRENT', { userId, memoryId, key: target.key });
        return { success: false, reason: 'HISTORICAL' };
      }
      if (ls === 'INVALIDATED') {
        logger.warn('[MemoryRepository] Blocked unarchive of invalidated row', { userId, memoryId, key: target.key });
        return { success: false, reason: 'INVALIDATED' };
      }
      if (ls === 'PROPOSED') {
        logger.warn('[MemoryRepository] Blocked unarchive of proposed row', { userId, memoryId, key: target.key });
        return { success: false, reason: 'PROPOSED' };
      }
      if (ls === 'UNKNOWN') {
        logger.warn('[MemoryRepository] Blocked unarchive of unknown lifecycle row', { userId, memoryId, key: target.key });
        return { success: false, reason: 'UNKNOWN' };
      }
      if (ls !== 'CURRENT' && ls != null) {
        logger.warn('[MemoryRepository] Blocked unarchive of non-CURRENT lifecycle row', { userId, memoryId, key: target.key, lifecycle_state: ls });
        return { success: false, reason: ls };
      }

      // Check for duplicate CURRENT on same canonical key
      const { canonical } = canonicalizeKey(target.key || '');
      const { data: activeRows, error: activeErr } = await qt.track('mem_repo_unarchive_check', 'memories', () =>
        supabaseAdmin
          .from('memories')
          .select('id, lifecycle_state, is_archived')
          .eq('user_id', userId)
          .eq('key', canonical)
          .eq('is_archived', false)
      );

      if (activeErr) {
        logger.error('[MemoryRepository] Failed to check duplicate CURRENT for unarchive', { userId, memoryId, error: activeErr.message });
        return { success: false, reason: 'CHECK_ERROR' };
      }

      const hasDuplicateCurrent = (activeRows || []).some(
        (r: any) => r.id !== memoryId && r.lifecycle_state !== 'SUPERSEDED' && r.lifecycle_state !== 'INVALIDATED' && r.lifecycle_state !== 'HISTORICAL'
      );

      if (hasDuplicateCurrent) {
        logger.warn('[MemoryRepository] Blocked unarchive that would create duplicate CURRENT', { userId, memoryId, canonical });
        return { success: false, reason: 'DUPLICATE_CURRENT' };
      }

      // Safe to unarchive — final update with race-safe handling.
      // Two concurrent unarchives for same canonical key could both pass the
      // pre-check; the DB unique constraint will reject the loser, which we
      // map to a safe DUPLICATE_CURRENT failure rather than success.
      const { data, error } = await qt.track('mem_repo_unarchive', 'memories', () =>
        supabaseAdmin
          .from('memories')
          .update({ is_archived: false, updated_at: new Date().toISOString() })
          .eq('id', memoryId)
          .eq('user_id', userId)
          .select('id')
      );

      if (error) {
        const msg = error.message || '';
        if ((error as any).code === '23505' || msg.includes('unique constraint') || msg.includes('idx_memories_user_current_key')) {
          logger.warn('[MemoryRepository] Blocked concurrent unarchive duplicate CURRENT (DB constraint)', { userId, memoryId, canonical });
          return { success: false, reason: 'DUPLICATE_CURRENT' };
        }
        logger.error('[MemoryRepository] Failed to unarchive memory', { userId, memoryId, error: error.message });
        return { success: false, reason: 'UPDATE_ERROR' };
      }

      const ok = (data || []).length > 0;
      if (ok) {
        logger.info('[MemoryRepository] Memory unarchived via canonical repository', { userId, memoryId, canonical });
      }
      return { success: ok, reason: ok ? undefined : 'NOT_FOUND' };
    } catch (err: any) {
      logger.error('[MemoryRepository] unarchiveMemory error', { userId, memoryId, error: err?.message });
      return { success: false, reason: 'EXCEPTION' };
    }
  }

  /**
   * Phase 2C Safe Deterministic Repair Operation: Key Canonicalization
   * Normalizes an aliased key to its canonical schema equivalent.
   */
  async canonicalizeMemoryKey(
    userId: string,
    memoryId: string,
    oldKey: string,
    newCanonicalKey: string
  ): Promise<boolean> {
    try {
      // 1. Fetch the exact state of the old alias memory
      const { data: oldMem, error: fetchErr } = await supabaseAdmin
        .from('memories')
        .select('*')
        .eq('id', memoryId)
        .eq('user_id', userId)
        .eq('key', oldKey)
        .single();

      if (fetchErr || !oldMem) {
        logger.error('[MemoryRepository] Failed to fetch alias memory for canonicalization', { userId, memoryId, oldKey, error: fetchErr?.message });
        return false;
      }

      // 2. Perform a race-safe atomic insertion of the new canonical key
      // This routes through upsertMemory, which uses atomic_supersede_memory
      await this.upsertMemory(userId, {
        type: oldMem.memory_type,
        key: newCanonicalKey,
        value: oldMem.value,
        importance: oldMem.importance,
        confidence: oldMem.confidence,
        emotional_weight: oldMem.emotional_weight,
        source_references: oldMem.source_references,
        is_protected: !!oldMem.protection_source,
        protection_source: oldMem.protection_source,
        compression_status: oldMem.compression_status,
        source_authority: oldMem.source_authority,
        shouldPersist: true
      } as any, oldMem.source_message);

      // 3. Safely archive the old alias row now that the canonical one is atomically inserted
      await this.archiveMemory(userId, memoryId, 'Canonicalized to schema key: ' + newCanonicalKey);

      logger.info('[MemoryRepository] Memory alias safely canonicalized via atomic RPC path', { userId, memoryId, oldKey, newCanonicalKey });
      return true;
    } catch (err: any) {
      logger.error('[MemoryRepository] canonicalizeMemoryKey error', { userId, memoryId, error: err?.message });
      return false;
    }
  }

  /**
   * Phase 2F-B Hard Delete Guard:
   * Checks whether a source evidence record is safe to permanently delete,
   * or if an active trusted compressed memory depends on it.
   */
  async canPermanentlyDeleteSource(
    userId: string,
    sourceType: SourceDependencyType,
    sourceId: string
  ): Promise<boolean> {
    return sourceDependencyService.canPermanentlyDeleteSource(userId, sourceType, sourceId);
  }

  /**
   * Phase 2F-B Provenance Audit:
   * Resolves the provenance dependency tree for a specific semantic memory.
   */
  async getSourceProvenance(userId: string, memoryId: string): Promise<SourceProvenanceReport | null> {
    const { data: mem, error } = await qt.track('mem_repo_get_provenance', 'memories', () =>
      supabaseAdmin
        .from('memories')
        .select(MEMORY_COLUMNS)
        .eq('id', memoryId)
        .eq('user_id', userId)
        .maybeSingle()
    );

    if (error || !mem) return null;
    return sourceDependencyService.resolveMemoryProvenance(userId, mem as Memory);
  }

  /**
   * Pre-Heartbeat Hardening: Stale Working-Memory Invalidation on Authoritative Correction.
   * When an authoritative fact or correction is committed for canonical key K,
   * any active working_memory row for the same user with matching canonical key K
   * and differing value is marked promotion_status = 'SUPERSEDED'.
   * 
   * Invariants:
   * 1. Deterministic canonical key matching via canonicalizeKey().
   * 2. Preserves row in DB (0 physical DELETE).
   * 3. Zero LLM calls.
   * 4. Does not touch unrelated working memory rows.
   * 5. Does not touch episodic memories.
   * 6. Scoped strictly to the same userId (cross-user isolation).
   */
  async invalidateStaleWorkingMemory(
    userId: string,
    canonicalKey: string,
    activeValue: string
  ): Promise<number> {
    if (!userId || !canonicalKey) return 0;

    try {
      const { canonical: targetCanonical } = canonicalizeKey(canonicalKey.trim());
      const normActiveVal = (activeValue || '').toLowerCase().trim();

      const { data: wmRows, error: fetchErr } = await qt.track(
        'wm_fetch_for_invalidation',
        'working_memory',
        () =>
          supabaseAdmin
            .from('working_memory')
            .select('id, key, value, promotion_status')
            .eq('user_id', userId)
      );

      if (fetchErr || !wmRows || wmRows.length === 0) {
        return 0;
      }

      const staleRowIds: string[] = [];

      for (const row of wmRows as any[]) {
        if (row.promotion_status === 'SUPERSEDED' || row.promotion_status === 'INVALIDATED') {
          continue;
        }

        const { canonical: rowCanonical } = canonicalizeKey(row.key || '');
        if (rowCanonical === targetCanonical) {
          const rowVal = (row.value || '').toLowerCase().trim();
          if (rowVal !== normActiveVal) {
            staleRowIds.push(row.id);
          }
        }
      }

      if (staleRowIds.length > 0) {
        const { error: updateErr } = await qt.track(
          'wm_invalidate_stale',
          'working_memory',
          () =>
            supabaseAdmin
              .from('working_memory')
              .update({
                promotion_status: 'SUPERSEDED',
              })
              .in('id', staleRowIds)
              .eq('user_id', userId)
        );

        if (updateErr) {
          logger.warn('[MemoryRepository] Failed to invalidate stale working memory', {
            userId,
            canonicalKey: targetCanonical,
            error: updateErr.message,
          });
          return 0;
        }

        logger.info('[MemoryRepository] Invalidated stale working memory records', {
          userId,
          canonicalKey: targetCanonical,
          invalidatedCount: staleRowIds.length,
          staleRowIds,
        });

        return staleRowIds.length;
      }

      return 0;
    } catch (err: any) {
      logger.warn('[MemoryRepository] Exception during stale working memory invalidation', {
        userId,
        canonicalKey,
        error: err?.message,
      });
      return 0;
    }
  }
}

export const memoryRepository = new MemoryRepository();

