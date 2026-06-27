import { supabaseAdmin } from '../lib/supabase';
import { logger } from '../lib/logger';

export class MemoryDecayService {
  /**
   * score = importance + frequency + emotional_weight + recency
   * Decreases score weekly by increasing decay factor on older memories.
   */
  async processWeeklyDecay() {
    logger.info('Starting Memory Decay Process');

    // Fetch all active memories
    const { data: memories, error } = await supabaseAdmin
      .from('memories')
      .select('id, importance, frequency, emotional_weight, last_accessed_at, is_archived')
      .eq('is_archived', false);

    if (error || !memories) {
      logger.error('Failed to fetch memories for decay', { error: error?.message });
      return;
    }

    let archivedCount = 0;
    const now = Date.now();
    const oneWeekMs = 7 * 24 * 60 * 60 * 1000;

    for (const mem of memories) {
      const lastAccessed = mem.last_accessed_at ? new Date(mem.last_accessed_at).getTime() : now;
      const weeksSinceAccess = Math.max(0, (now - lastAccessed) / oneWeekMs);

      // Recency drops as weeks increase (max recency score = 20)
      const recency = Math.max(0, 20 - (weeksSinceAccess * 5));

      // Calculate base score
      const baseScore = (mem.importance || 10) + (mem.frequency || 1) + (mem.emotional_weight || 0) + recency;

      // Decay penalty: -5 for every week since it was last accessed
      const decay = weeksSinceAccess * 5;
      
      const finalScore = baseScore - decay;

      if (finalScore < 10) {
        // Archive
        await supabaseAdmin.from('memories').update({ is_archived: true }).eq('id', mem.id);
        archivedCount++;
      }
    }

    logger.info('Memory Decay Process Completed', {
      total_processed: memories.length,
      archived: archivedCount
    });
    
    return archivedCount;
  }
}

export const memoryDecayService = new MemoryDecayService();
