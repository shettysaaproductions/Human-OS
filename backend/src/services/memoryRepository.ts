import { supabaseAdmin } from '../lib/supabase';
import { ExtractedMemory, Memory } from '../types/memory';
import { logger } from '../lib/logger';

export class MemoryRepository {
  /**
   * Upserts a memory.
   * If user_id + key exists, it updates the value, increments importance (up to 10),
   * and updates the confidence and updated_at.
   */
  async upsertMemory(userId: string, memory: ExtractedMemory, sourceMessage: string): Promise<void> {
    if (!memory.shouldPersist) return;

    try {
      // TODO (Tech Debt): Race condition vulnerability.
      // If two requests upsert the same memory simultaneously, the select() -> update() 
      // cycle will overwrite each other's increments. 
      // Fix: Implement Postgres RPC with ON CONFLICT DO UPDATE for atomic increments.
      
      // 1. Check if memory exists for this user + key
      const { data: existing } = await supabaseAdmin
        .from('memories')
        .select('*')
        .eq('user_id', userId)
        .eq('key', memory.key)
        .single();

      if (existing) {
        // Increment importance and frequency if it's mentioned again
        const newImportance = Math.min((existing.importance || 50) + 5, 100);
        const newFrequency = (existing.frequency || 1) + 1;
        
        await supabaseAdmin
          .from('memories')
          .update({
            value: memory.value,
            importance: Math.max(newImportance, memory.importance),
            confidence: memory.confidence,
            frequency: newFrequency,
            emotional_weight: memory.emotional_weight || existing.emotional_weight || 0,
            source_message: sourceMessage,
            updated_at: new Date().toISOString()
          })
          .eq('id', existing.id);
          
        logger.debug('Memory updated', { key: memory.key, userId, frequency: newFrequency });
      } else {
        // Insert new memory
        await supabaseAdmin
          .from('memories')
          .insert({
            user_id: userId,
            memory_type: memory.type,
            key: memory.key,
            value: memory.value,
            importance: memory.importance,
            confidence: memory.confidence,
            source_message: sourceMessage,
          });
          
        logger.debug('Memory inserted', { key: memory.key, userId });
      }
    } catch (err) {
      logger.error('Failed to upsert memory', { error: err instanceof Error ? err.message : String(err), memory });
      throw err;
    }
  }

  /**
   * Retrieves memories for a user, using custom ranking.
   */
  async searchMemories(userId: string, keywords: string[]): Promise<Memory[]> {
    try {
      // Pull all memories for the user (MVP logic before pgvector)
      const { data, error } = await supabaseAdmin
        .from('memories')
        .select('*')
        .eq('user_id', userId);

      if (error) throw new Error(error.message);

      let memories = (data || []) as Memory[];
      if (memories.length === 0) return [];

      const now = Date.now();

      // Calculate scores
      const scoredMemories = memories.filter(m => !m.is_archived).map(mem => {
        // 1. Importance (0.0 to 1.0)
        const normImportance = Math.min(100, Math.max(1, mem.importance)) / 100;

        // 2. Relevance (0.0 to 1.0)
        let matches = 0;
        const keyLower = mem.key.toLowerCase();
        const valLower = mem.value.toLowerCase();
        for (const kw of keywords) {
          if (keyLower.includes(kw) || valLower.includes(kw)) matches++;
        }
        const relevance = keywords.length > 0 ? Math.min(1.0, matches / keywords.length) : 0;

        // 3. Recency (0.0 to 1.0) - Decays to 0 over 30 days
        const targetDate = mem.last_accessed_at || mem.created_at;
        const daysOld = (now - new Date(targetDate).getTime()) / (1000 * 60 * 60 * 24);
        const recency = Math.max(0, 1 - (daysOld / 30));

        // 4. Frequency (0.0 to 1.0) - Maxes out at 10 accesses
        const normFrequency = Math.min(10, Math.max(1, mem.frequency || 1)) / 10;

        // 5. Emotional Weight (0.0 to 1.0) - Magnitude of emotion
        const normEmotion = Math.min(10, Math.abs(mem.emotional_weight || 0)) / 10;

        // Final Score (30/30/15/15/10)
        const final_score = (normImportance * 0.30) + (relevance * 0.30) + (recency * 0.15) + (normFrequency * 0.15) + (normEmotion * 0.10);

        return { mem, final_score, normImportance };
      });

      // Sort by final score descending
      scoredMemories.sort((a, b) => b.final_score - a.final_score);

      // Strategy: Top 2 relevant memories, plus Top 1 highest importance
      const selected: Memory[] = [];
      const selectedIds = new Set<string>();

      // Get top 2 relevant
      for (const item of scoredMemories) {
        if (selected.length < 2) {
          selected.push(item.mem);
          selectedIds.add(item.mem.id);
        } else {
          break;
        }
      }

      // Get top 1 highest importance NOT already selected
      scoredMemories.sort((a, b) => b.normImportance - a.normImportance);
      for (const item of scoredMemories) {
        if (!selectedIds.has(item.mem.id)) {
          selected.push(item.mem);
          break;
        }
      }

      // Async update last_accessed_at in the background (fire and forget)
      if (selected.length > 0) {
        const memoryIds = selected.map(m => m.id);
        supabaseAdmin
          .from('memories')
          .update({ last_accessed_at: new Date().toISOString() })
          .in('id', memoryIds)
          .then(({ error }) => {
            if (error) logger.warn('Failed to update last_accessed_at', { error: error.message });
          });
      }

      return selected;
    } catch (err) {
      logger.error('Failed to search memories', { error: err instanceof Error ? err.message : String(err), keywords });
      return []; // Fail gracefully, don't break the chat
    }
  }
}

export const memoryRepository = new MemoryRepository();
