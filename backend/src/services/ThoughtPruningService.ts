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
      
      logger.info('[ThoughtPruningService] Starting daily pruning of old thoughts and presence history', { olderThan: fiveDaysAgo });

      const { data, error } = await supabaseAdmin
        .from('nova_thoughts')
        .delete()
        .lt('created_at', fiveDaysAgo)
        .select('id');

      if (error) {
        throw error;
      }

      const { data: presenceData, error: presenceError } = await supabaseAdmin
        .from('user_presence_history')
        .delete()
        .lt('created_at', fiveDaysAgo)
        .select('id');

      if (presenceError) {
        throw presenceError;
      }

      logger.info('[ThoughtPruningService] Pruning complete', { deletedThoughtsCount: data?.length || 0, deletedPresenceCount: presenceData?.length || 0 });
    } catch (error) {
      logger.error('[ThoughtPruningService] Error during pruning', { error });
    }
  }
};
