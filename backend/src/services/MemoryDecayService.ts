import { supabaseAdmin } from '../lib/supabase';
import { logger } from '../lib/logger';

export class MemoryDecayService {
  /**
   * score = importance + frequency + emotional_weight + recency
   * Decreases score weekly by increasing decay factor on older memories.
   *
   * CANONICAL PROTECTION:
   * - Memories owned by an active canonical entity bubble (bubble_id != null) are IMMUNE to decay.
   * - Protected memories (is_protected = true) are IMMUNE to decay.
   * - Deterministic memories (source_authority = 'deterministic') are IMMUNE to decay.
   * Only unowned, unprotected, non-deterministic lifestyle/preference facts decay.
   */
  async processWeeklyDecay() {
    logger.info('Starting Memory Decay Process');

    // Fetch all active, non-canonical, non-protected memories
    // Exclude: bubble-owned facts, protected facts, deterministic facts
    const { data: memories, error } = await supabaseAdmin
      .from('memories')
      .select('id, user_id, importance, frequency, emotional_weight, last_accessed_at, is_archived, bubble_id, is_protected, source_authority')
      .eq('is_archived', false)
      .is('bubble_id', null)      // Only decay unowned facts (canonical entity facts are immune)
      .neq('source_authority', 'deterministic') // Deterministic facts are immune
      .eq('is_protected', false); // Protected facts are immune

    if (error || !memories) {
      logger.error('Failed to fetch memories for decay', { error: error?.message });
      return;
    }

    let archivedCount = 0;
    let protectedSkipped = 0;
    const now = Date.now();
    const oneWeekMs = 7 * 24 * 60 * 60 * 1000;

    for (const mem of memories) {
      // Double-check: never decay a memory with a bubble_id (canonical guard)
      if (mem.bubble_id) {
        protectedSkipped++;
        continue;
      }

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
        const { memoryRepository } = await import('./memoryRepository');
        await memoryRepository.archiveMemory(mem.user_id, mem.id, 'Memory decay below threshold');
        archivedCount++;
      }
    }

    logger.info('Memory Decay Process Completed', {
      total_processed: memories.length,
      archived: archivedCount,
      canonical_protected_skipped: protectedSkipped,
    });
    
    return archivedCount;
  }
}

export const memoryDecayService = new MemoryDecayService();
