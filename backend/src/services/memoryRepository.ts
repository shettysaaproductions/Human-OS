import { supabaseAdmin } from '../lib/supabase';
import { ExtractedMemory, Memory, SourceAuthority } from '../types/memory';
import { logger } from '../lib/logger';
import { qt } from '../lib/queryTracker';
import { stopWords } from '../utils/nlp';
import { canonicalizeKey } from '../lib/memoryKeySchema';
import { isGarbageMemoryValue } from '../lib/memoryFilters';
import { deterministicGuardian } from './DeterministicGuardianService';

// Explicit column list — never use select('*') on memories
const MEMORY_COLUMNS = 'id, user_id, key, value, importance, confidence, frequency, emotional_weight, last_accessed_at, created_at, updated_at, is_archived, memory_type, source_authority, protection_source, protected_at, compression_status, lifecycle_state, superseded_by, superseded_at, supersession_reason';

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
    if (!memory.shouldPersist) return;

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

    const incomingAuthority = normalizedMemory.source_authority ?? 'subconscious_inference';

    // ── Layer 1: Generic entity value blocklist ───────────────────────────────
    if (isGenericEntityValue(normalizedMemory.key, normalizedMemory.value, incomingAuthority)) {
      logger.info('[MemoryRepository] BLOCKED generic entity value', {
        userId, key: normalizedMemory.key, value: normalizedMemory.value, authority: incomingAuthority
      });
      return;
    }

    // ── Layer 1b: Shared garbage admission guard ──────────────────────────────
    if (isGarbageMemoryValue(normalizedMemory.key, normalizedMemory.value, 'memoryRepository')) {
      return;
    }

    // ── Layer 1c: Proposed & Historical Classification ────────────────────────
    const isProposed = normalizedMemory.compression_status === 'proposed';
    const isHistorical = normalizedMemory.lifecycle_state === 'HISTORICAL' ||
      isHistoricalFact(normalizedMemory.value, sourceMessage, (normalizedMemory as any).factClass, normalizedMemory.is_historical);
    const incomingLifecycleState: string = isProposed
      ? 'PROPOSED'
      : isHistorical
      ? 'HISTORICAL'
      : 'CURRENT';

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

      // If incoming memory is PROPOSED, insert it as PROPOSED without superseding any CURRENT rows
      if (isProposed) {
        await qt.track('upsert_memory_insert_proposed', 'memories', () =>
          supabaseAdmin
            .from('memories')
            .insert({
              user_id: userId,
              memory_type: normalizedMemory.type,
              key: normalizedMemory.key,
              value: normalizedMemory.value,
              importance: normalizedMemory.importance,
              confidence: normalizedMemory.confidence,
              emotional_weight: normalizedMemory.emotional_weight ?? 0,
              source_message: sourceMessage,
              source_authority: incomingAuthority,
              is_archived: false,
              lifecycle_state: 'PROPOSED',
              compression_status: 'proposed',
              source_references: normalizedMemory.source_references,
              last_accessed_at: new Date().toISOString(),
            })
        );
        return;
      }

      // If incoming memory is HISTORICAL, insert it as HISTORICAL (do NOT supersede CURRENT rows)
      if (isHistorical) {
        await qt.track('upsert_memory_insert_historical', 'memories', () =>
          supabaseAdmin
            .from('memories')
            .insert({
              user_id: userId,
              memory_type: normalizedMemory.type,
              key: normalizedMemory.key,
              value: normalizedMemory.value,
              importance: normalizedMemory.importance,
              confidence: normalizedMemory.confidence,
              emotional_weight: normalizedMemory.emotional_weight ?? 0,
              source_message: sourceMessage,
              source_authority: incomingAuthority,
              is_archived: false,
              lifecycle_state: 'HISTORICAL',
              last_accessed_at: new Date().toISOString(),
              ...(normalizedMemory.is_protected ? {
                protection_source: normalizedMemory.protection_source || 'system',
                protected_at: new Date().toISOString()
              } : {}),
              ...(normalizedMemory.source_references ? { source_references: normalizedMemory.source_references } : {}),
              ...(normalizedMemory.compression_status ? { compression_status: normalizedMemory.compression_status } : {}),
            })
        );
        logger.info('[MemoryRepository] Historical memory preserved & inserted', {
          key: normalizedMemory.key,
          userId,
          value: normalizedMemory.value
        });
        return;
      }

      // Find conflicting CURRENT row(s) to supersede
      // (Exclude rows that are explicitly HISTORICAL)
      const conflictingCurrentRow = currentActiveRows.find(
        r => r.lifecycle_state !== 'HISTORICAL' && !isHistoricalFact(r.value)
      );

      if (conflictingCurrentRow) {
        // Authority hierarchy check:
        const existingRank = authorityRank(conflictingCurrentRow.source_authority);
        const incomingRank = authorityRank(incomingAuthority);

        if (existingRank > incomingRank && !normalizedMemory.correction_intent) {
          logger.info('[MemoryRepository] BLOCKED lower-authority overwrite', {
            userId,
            key: normalizedMemory.key,
            existingAuthority: conflictingCurrentRow.source_authority,
            incomingAuthority,
          });
          return;
        }

        // Authoritative Supersession Execution:
        // 1. Mark conflicting old row as SUPERSEDED first (frees the unique partial index slot)
        const supersededTimestamp = new Date().toISOString();
        const { error: supersedeErr } = await qt.track('upsert_memory_mark_superseded', 'memories', () =>
          supabaseAdmin
            .from('memories')
            .update({
              is_archived: true,
              lifecycle_state: 'SUPERSEDED',
              superseded_at: supersededTimestamp,
              supersession_reason: `Authoritative correction: superseded by ${incomingAuthority} fact`,
              updated_at: supersededTimestamp,
            })
            .eq('id', conflictingCurrentRow.id)
            .eq('user_id', userId)
        );

        if (supersedeErr) {
          throw new Error(`Failed to archive superseded memory: ${supersedeErr.message}`);
        }

        // 2. Insert NEW memory row as CURRENT
        const { data: newRow, error: insertErr } = await qt.track('upsert_memory_insert_superseding', 'memories', () =>
          supabaseAdmin
            .from('memories')
            .insert({
              user_id: userId,
              memory_type: normalizedMemory.type,
              key: normalizedMemory.key,
              value: normalizedMemory.value,
              importance: Math.max(conflictingCurrentRow.importance || 50, normalizedMemory.importance),
              confidence: normalizedMemory.confidence,
              emotional_weight: normalizedMemory.emotional_weight ?? conflictingCurrentRow.emotional_weight ?? 0,
              source_message: sourceMessage,
              source_authority: incomingAuthority,
              is_archived: false,
              lifecycle_state: 'CURRENT',
              last_accessed_at: new Date().toISOString(),
              ...(normalizedMemory.is_protected || conflictingCurrentRow.protection_source ? {
                protection_source: normalizedMemory.protection_source || conflictingCurrentRow.protection_source || 'system',
                protected_at: new Date().toISOString()
              } : {}),
              ...(normalizedMemory.source_references ? { source_references: normalizedMemory.source_references } : {}),
              ...(normalizedMemory.compression_status ? { compression_status: normalizedMemory.compression_status } : {}),
            })
            .select('id')
            .single()
        );

        if (insertErr || !newRow) {
          throw new Error(`Failed to insert superseding memory: ${insertErr?.message}`);
        }

        const newMemoryId = newRow.id;

        // 3. Back-link superseded_by on the old row
        await qt.track('upsert_memory_link_superseded', 'memories', () =>
          supabaseAdmin
            .from('memories')
            .update({
              superseded_by: newMemoryId,
            })
            .eq('id', conflictingCurrentRow.id)
            .eq('user_id', userId)
        );

        logger.info('[MemoryRepository] Conflicting CURRENT memory SUPERSEDED cleanly', {
          userId,
          key: normalizedMemory.key,
          oldMemoryId: conflictingCurrentRow.id,
          oldValue: conflictingCurrentRow.value,
          newMemoryId,
          newValue: normalizedMemory.value,
          incomingAuthority,
          supersededAt: supersededTimestamp,
        });
      } else {
        // No conflicting CURRENT row found: clean fresh insert
        await qt.track('upsert_memory_insert_fresh', 'memories', () =>
          supabaseAdmin
            .from('memories')
            .insert({
              user_id: userId,
              memory_type: normalizedMemory.type,
              key: normalizedMemory.key,
              value: normalizedMemory.value,
              importance: normalizedMemory.importance,
              confidence: normalizedMemory.confidence,
              emotional_weight: normalizedMemory.emotional_weight ?? 0,
              source_message: sourceMessage,
              source_authority: incomingAuthority,
              is_archived: false,
              lifecycle_state: incomingLifecycleState,
              last_accessed_at: new Date().toISOString(),
              ...(normalizedMemory.is_protected ? {
                protection_source: normalizedMemory.protection_source || 'system',
                protected_at: new Date().toISOString()
              } : {}),
              ...(normalizedMemory.source_references ? { source_references: normalizedMemory.source_references } : {}),
              ...(normalizedMemory.compression_status ? { compression_status: normalizedMemory.compression_status } : {}),
            })
        );

        logger.debug('[MemoryRepository] Fresh memory inserted', {
          key: normalizedMemory.key,
          userId,
          authority: incomingAuthority,
          lifecycleState: incomingLifecycleState
        });
      }

      // Phase 2A: Non-blocking Guardian mutation observation trigger
      setImmediate(() => {
        deterministicGuardian.runMutationScan(userId, 'memory', normalizedMemory.key).catch(gErr => {
          logger.debug('[MemoryRepository] Guardian observation non-fatal error', { error: gErr?.message });
        });
      });
    } catch (err) {
      logger.error('Failed to upsert memory', { error: err instanceof Error ? err.message : String(err), memory });
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
   */
  async forgetMemory(userId: string, memoryId: string): Promise<void> {
    await qt.track('forget_memory', 'memories', () =>
      supabaseAdmin
        .from('memories')
        .update({ is_archived: true })
        .eq('id', memoryId)
        .eq('user_id', userId)
    );
    logger.info('Memory forgotten (archived)', { memoryId, userId });
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
      const { data, error } = await qt.track('mem_repo_canonicalize_key', 'memories', () =>
        supabaseAdmin
          .from('memories')
          .update({
            key: newCanonicalKey,
            updated_at: new Date().toISOString(),
          })
          .eq('id', memoryId)
          .eq('user_id', userId)
          .eq('key', oldKey)
          .select('id')
      );

      if (error) {
        logger.error('[MemoryRepository] Failed to canonicalize memory key', { userId, memoryId, oldKey, newCanonicalKey, error: error.message });
        return false;
      }

      logger.info('[MemoryRepository] Memory key canonicalized via canonical repository', { userId, memoryId, oldKey, newCanonicalKey });
      return (data || []).length > 0;
    } catch (err: any) {
      logger.error('[MemoryRepository] canonicalizeMemoryKey error', { userId, memoryId, error: err?.message });
      return false;
    }
  }
}

export const memoryRepository = new MemoryRepository();
