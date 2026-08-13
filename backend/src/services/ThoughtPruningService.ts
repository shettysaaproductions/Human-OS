import { supabaseAdmin } from '../lib/supabase';
import { logger } from '../lib/logger';

export const thoughtPruningService = {
  /**
   * Deletes thoughts older than 5 days.
   * Runs daily via cron or triggered by a background worker.
   */
  async pruneOldThoughts(): Promise<void> {
    try {
      const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
      
      logger.info('[ThoughtPruningService] Starting daily pruning of old thoughts', { olderThan: fiveDaysAgo });

      const { data, error } = await supabaseAdmin
        .from('nova_thoughts')
        .delete()
        .lt('created_at', fiveDaysAgo)
        .select('id');

      if (error) {
        throw error;
      }

      logger.info('[ThoughtPruningService] Pruning complete', { deletedCount: data?.length || 0 });
    } catch (error) {
      logger.error('[ThoughtPruningService] Error during thought pruning', { error });
    }
  }
};
