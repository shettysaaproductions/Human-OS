import { supabaseAdmin } from '../lib/supabase';
import { ExtractedMemory, Memory, SourceAuthority } from '../types/memory';
import { logger } from '../lib/logger';
import { qt } from '../lib/queryTracker';
import { stopWords } from '../utils/nlp';
import { canonicalizeKey } from '../lib/memoryKeySchema';

// Explicit column list — never use select('*') on memories
const MEMORY_COLUMNS = 'id, key, value, importance, confidence, frequency, emotional_weight, last_accessed_at, created_at, is_archived, memory_type, source_authority, protection_source, protected_at';

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

export class MemoryRepository {
  /**
   * Upserts a memory with authority-aware overwrite protection.
   *
   * Authority rules:
   *   1. Generic entity value blocklist — rejects relational nouns as _name values
   *      from subconscious_inference sources (defense layer 1 — extraction boundary).
   *   2. Authority hierarchy guard — a lower-authority source cannot overwrite
   *      a higher-authority existing fact unless correction_intent = true (layer 2).
   *   3. is_protected / protection_source are UNCHANGED — they govern Phase 6.1
   *      retention/pruning and are completely orthogonal to authority.
   */
  async upsertMemory(userId: string, memory: ExtractedMemory, sourceMessage: string): Promise<void> {
    if (!memory.shouldPersist) return;

    // ── Layer 0: Canonical key normalization ──────────────────────────────────
    // This MUST happen before any other check so that alias keys (e.g.
    // mothers_name, sons_name, business_name) are resolved to their canonical
    // counterparts before the authority guard or DB lookup.
    const { canonical: canonicalKey, wasAliased } = canonicalizeKey(memory.key);
    if (wasAliased) {
      logger.info('[MemoryRepository] Key canonicalized', {
        userId, originalKey: memory.key, canonicalKey
      });
    }
    // Mutate the in-memory object so all downstream references use canonical key
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

    try {
      // 1. Check if memory exists — fetch authority alongside existing columns
      const { data: existing } = await qt.track('upsert_memory_check', 'memories', () =>
        supabaseAdmin
          .from('memories')
          .select('id, importance, frequency, emotional_weight, source_authority')
          .eq('user_id', userId)
          .eq('key', normalizedMemory.key)
          .maybeSingle()
      );

      if (existing) {
        // ── Layer 2: Authority hierarchy guard ───────────────────────────────
        const existingRank = authorityRank(existing.source_authority);
        const incomingRank = authorityRank(incomingAuthority);

        if (existingRank > incomingRank && !normalizedMemory.correction_intent) {
          logger.info('[MemoryRepository] BLOCKED lower-authority overwrite', {
            userId,
            key: normalizedMemory.key,
            existingAuthority: existing.source_authority,
            incomingAuthority,
          });
          return;
        }

        if (normalizedMemory.correction_intent) {
          logger.info('[MemoryRepository] CORRECTION accepted — superseding existing value', {
            userId, key: normalizedMemory.key,
            from: existing.source_authority, to: incomingAuthority,
          });
        }

        const newImportance = Math.min((existing.importance || 50) + 5, 100);
        const newFrequency = (existing.frequency || 1) + 1;

        await qt.track('upsert_memory_update', 'memories', () =>
          supabaseAdmin
            .from('memories')
            .update({
              value: normalizedMemory.value,
              importance: Math.max(newImportance, normalizedMemory.importance),
              confidence: normalizedMemory.confidence,
              frequency: newFrequency,
              emotional_weight: normalizedMemory.emotional_weight ?? existing.emotional_weight ?? 0,
              source_message: sourceMessage,
              source_authority: incomingAuthority,
              updated_at: new Date().toISOString(),
              // Retention semantics — Phase 6.1 UNCHANGED
              ...(normalizedMemory.is_protected ? {
                protection_source: normalizedMemory.protection_source || 'system',
                protected_at: new Date().toISOString()
              } : {}),
            })
            .eq('id', existing.id)
        );

        logger.debug('Memory updated', { key: normalizedMemory.key, userId, frequency: newFrequency, authority: incomingAuthority });
      } else {
        await qt.track('upsert_memory_insert', 'memories', () =>
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
              last_accessed_at: new Date().toISOString(),
              // Retention semantics — Phase 6.1 UNCHANGED
              ...(normalizedMemory.is_protected ? {
                protection_source: normalizedMemory.protection_source || 'system',
                protected_at: new Date().toISOString()
              } : {}),
            })
        );

        logger.debug('Memory inserted', { key: normalizedMemory.key, userId, authority: incomingAuthority });
      }
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
}

export const memoryRepository = new MemoryRepository();
