import { supabaseAdmin } from '../lib/supabase';
import { logger } from '../lib/logger';

/**
 * MemoryPolicyService — Server-authoritative MEMORY_ENABLED privacy gate.
 *
 * Default: true (backward compatible for existing users with no persisted value).
 * When false: no new persistent semantic memory may be created, no correction
 * persisted, no queued write persists, no memory injection into context.
 * Existing stored memories remain stored (not deleted).
 *
 * This is the single reusable gate. Call isMemoryEnabled(userId) BEFORE any
 * persistent memory mutation, and again at worker/persistence time for queue safety.
 * Enforced finally at MemoryRepository boundary as defense-in-depth.
 */
export class MemoryPolicyService {
  /**
   * Returns true if memory is enabled for user, false if paused.
   * Defaults to true if no row or column missing or error (fail open for privacy? No — fail closed to enabled is safe default).
   * Logs only safe metadata (userId, enabled, reason).
   */
  async isMemoryEnabled(userId: string): Promise<boolean> {
    if (!userId) return true;
    try {
      const { data, error } = await supabaseAdmin
        .from('profiles')
        .select('memory_enabled')
        .eq('id', userId)
        .maybeSingle();

      if (error) {
        // If column does not exist yet (migration not applied), default to enabled
        if (error.message?.includes('memory_enabled') || (error as any).code === '42703') {
          logger.warn('[MemoryPolicy] memory_enabled column missing, defaulting to enabled', { userId });
          return true;
        }
        logger.warn('[MemoryPolicy] Failed to fetch memory_enabled, defaulting to enabled', { userId, error: error.message });
        return true;
      }

      if (!data) return true;
      // Explicit false only if stored false; otherwise true
      if (data.memory_enabled === false) return false;
      return true;
    } catch (err: any) {
      logger.warn('[MemoryPolicy] Exception fetching memory_enabled, defaulting to enabled', { userId, error: err?.message });
      return true;
    }
  }

  async getMemoryPolicy(userId: string): Promise<{ enabled: boolean }> {
    const enabled = await this.isMemoryEnabled(userId);
    return { enabled };
  }

  async setMemoryEnabled(userId: string, enabled: boolean): Promise<boolean> {
    if (typeof enabled !== 'boolean') {
      throw new Error('memory_enabled must be boolean');
    }
    try {
      const { error } = await supabaseAdmin
        .from('profiles')
        .update({ memory_enabled: enabled, updated_at: new Date().toISOString() })
        .eq('id', userId);

      if (error) {
        // Handle missing column gracefully
        if (error.message?.includes('memory_enabled') || (error as any).code === '42703') {
          logger.error('[MemoryPolicy] memory_enabled column missing, migration required', { userId });
          throw new Error('memory_enabled column not available');
        }
        logger.error('[MemoryPolicy] Failed to set memory_enabled', { userId, error: error.message });
        throw error;
      }

      logger.info('[MemoryPolicy] Memory privacy setting updated', { userId, enabled, action: 'set_memory_enabled' });
      return true;
    } catch (err: any) {
      logger.error('[MemoryPolicy] setMemoryEnabled error', { userId, error: err?.message });
      throw err;
    }
  }
}

export const memoryPolicyService = new MemoryPolicyService();
export default memoryPolicyService;
