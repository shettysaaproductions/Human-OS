import { supabaseAdmin } from '../lib/supabase';
import { logger } from '../lib/logger';

export class ShortTermMemoryCleanupService {
  async run() {
    try {
      logger.info('Running Short-Term Memory Cleanup...');
      
      const { data, error } = await supabaseAdmin
        .from('short_term_memories')
        .delete()
        .lt('expires_at', new Date().toISOString())
        .select('id');

      if (error) {
        throw new Error(error.message);
      }

      const deletedCount = data?.length || 0;
      logger.info('Expired Memories Deleted:', { count: deletedCount });
    } catch (err) {
      logger.error('Failed to cleanup short term memories', { error: err instanceof Error ? err.message : String(err) });
    }
  }
}

export const shortTermMemoryCleanupService = new ShortTermMemoryCleanupService();
