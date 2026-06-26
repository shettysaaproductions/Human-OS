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
      // 1. Check if memory exists for this user + key
      const { data: existing } = await supabaseAdmin
        .from('memories')
        .select('*')
        .eq('user_id', userId)
        .eq('key', memory.key)
        .single();

      if (existing) {
        // Increment importance if it's mentioned again
        const newImportance = Math.min((existing.importance || 5) + 1, 10);
        
        await supabaseAdmin
          .from('memories')
          .update({
            value: memory.value,
            importance: Math.max(newImportance, memory.importance),
            confidence: memory.confidence,
            source_message: sourceMessage,
            updated_at: new Date().toISOString()
          })
          .eq('id', existing.id);
          
        logger.debug('Memory updated', { key: memory.key, userId });
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
   * Retrieves memories for a user based on keyword matches OR high importance.
   * Updates last_accessed_at for retrieved memories.
   */
  async searchMemories(userId: string, keywords: string[]): Promise<Memory[]> {
    try {
      // V1 approach: without embeddings, keyword matching is too fragile (e.g., 'listen' doesn't match 'music_preference: rap').
      // Since users will only have a handful of memories initially, we simply pull their top 10 highest importance/most recent memories.
      const query = supabaseAdmin
        .from('memories')
        .select('*')
        .eq('user_id', userId);

      const { data, error } = await query
        .order('importance', { ascending: false })
        .order('last_accessed_at', { ascending: false, nullsFirst: false })
        .limit(10);

      if (error) throw new Error(error.message);

      const memories = (data || []) as Memory[];

      // Async update last_accessed_at in the background (fire and forget)
      if (memories.length > 0) {
        const memoryIds = memories.map(m => m.id);
        supabaseAdmin
          .from('memories')
          .update({ last_accessed_at: new Date().toISOString() })
          .in('id', memoryIds)
          .then(({ error }) => {
            if (error) logger.warn('Failed to update last_accessed_at', { error: error.message });
          });
      }

      return memories;
    } catch (err) {
      logger.error('Failed to search memories', { error: err instanceof Error ? err.message : String(err), keywords });
      return []; // Fail gracefully, don't break the chat
    }
  }
}

export const memoryRepository = new MemoryRepository();
