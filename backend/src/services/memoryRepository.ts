import { supabaseAdmin } from '../lib/supabase';
import { ExtractedMemory, Memory } from '../types/memory';
import { logger } from '../lib/logger';
import { qt } from '../lib/queryTracker';
import { config } from '../config';

// Explicit column list — never use select('*') on memories
const MEMORY_COLUMNS = 'id, key, value, importance, confidence, frequency, emotional_weight, last_accessed_at, created_at, is_archived, memory_type';

export class MemoryRepository {
  /**
   * Upserts a memory.
   * If user_id + key exists, it updates the value, increments importance (up to 100),
   * and updates the confidence and updated_at.
   */
  async upsertMemory(userId: string, memory: ExtractedMemory, sourceMessage: string): Promise<void> {
    if (!memory.shouldPersist) return;

    try {
      // 1. Check if memory exists — only fetch the columns we need
      const { data: existing } = await qt.track('upsert_memory_check', 'memories', () =>
        supabaseAdmin
          .from('memories')
          .select('id, importance, frequency, emotional_weight')
          .eq('user_id', userId)
          .eq('key', memory.key)
          .maybeSingle()
      );

      if (existing) {
        const newImportance = Math.min((existing.importance || 50) + 5, 100);
        const newFrequency = (existing.frequency || 1) + 1;

        await qt.track('upsert_memory_update', 'memories', () =>
          supabaseAdmin
            .from('memories')
            .update({
              value: memory.value,
              importance: Math.max(newImportance, memory.importance),
              confidence: memory.confidence,
              frequency: newFrequency,
              emotional_weight: memory.emotional_weight ?? existing.emotional_weight ?? 0,
              source_message: sourceMessage,
              updated_at: new Date().toISOString(),
            })
            .eq('id', existing.id)
        );

        logger.debug('Memory updated', { key: memory.key, userId, frequency: newFrequency });
      } else {
        await qt.track('upsert_memory_insert', 'memories', () =>
          supabaseAdmin
            .from('memories')
            .insert({
              user_id: userId,
              memory_type: memory.type,
              key: memory.key,
              value: memory.value,
              importance: memory.importance,
              confidence: memory.confidence,
              source_message: sourceMessage,
            })
        );

        logger.debug('Memory inserted', { key: memory.key, userId });
      }
    } catch (err) {
      logger.error('Failed to upsert memory', { error: err instanceof Error ? err.message : String(err), memory });
      throw err;
    }
  }

  /**
   * Retrieves memories for a user, bounded by MEMORY_SEARCH_LIMIT.
   * Scores and ranks in-process, returns top 3.
   */
  async searchMemories(userId: string, keywords: string[]): Promise<Memory[]> {
    try {
      const limit = config.db.memorySearchLimit;

      const { data, error } = await qt.track('search_memories', 'memories', () =>
        supabaseAdmin
          .from('memories')
          .select(MEMORY_COLUMNS)
          .eq('user_id', userId)
          .eq('is_archived', false)
          .order('importance', { ascending: false })
          .limit(limit)
      );

      if (error) throw new Error(error.message);

      const memories = (data || []) as Memory[];
      if (memories.length === 0) return [];

      const now = Date.now();

      // Score memories
      const scoredMemories = memories.map(mem => {
        const normImportance = Math.min(100, Math.max(1, mem.importance)) / 100;

        let matches = 0;
        const keyLower = mem.key.toLowerCase();
        const valLower = mem.value.toLowerCase();
        for (const kw of keywords) {
          if (keyLower.includes(kw) || valLower.includes(kw)) matches++;
        }
        const relevance = keywords.length > 0 ? Math.min(1.0, matches / keywords.length) : 0;

        const targetDate = mem.last_accessed_at || mem.created_at;
        const daysOld = (now - new Date(targetDate).getTime()) / (1000 * 60 * 60 * 24);
        const recency = Math.max(0, 1 - daysOld / 30);

        const normFrequency = Math.min(10, Math.max(1, mem.frequency || 1)) / 10;
        const normEmotion = Math.min(10, Math.abs(mem.emotional_weight || 0)) / 10;

        const final_score =
          normImportance * 0.30 +
          relevance * 0.30 +
          recency * 0.15 +
          normFrequency * 0.15 +
          normEmotion * 0.10;

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

      // Fire-and-forget: update last_accessed_at
      if (selected.length > 0) {
        const memoryIds = selected.map(m => m.id);
        qt.track('update_last_accessed', 'memories', () =>
          supabaseAdmin
            .from('memories')
            .update({ last_accessed_at: new Date().toISOString() })
            .in('id', memoryIds)
        ).catch(err => logger.warn('Failed to update last_accessed_at', { error: err.message }));
      }

      return selected;
    } catch (err) {
      logger.error('Failed to search memories', { error: err instanceof Error ? err.message : String(err), keywords });
      return [];
    }
  }
}

export const memoryRepository = new MemoryRepository();
