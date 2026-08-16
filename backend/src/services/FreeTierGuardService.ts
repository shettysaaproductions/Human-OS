import { logger } from '../lib/logger';
import { supabaseAdmin } from '../lib/supabase';

/**
 * FreeTierGuardService — Zero-Cost Enforcement
 *
 * Ensures Nova never exceeds free-tier limits across:
 * - Supabase (500MB storage, auto-freeze on inactivity)
 * - NVIDIA (rate limits per key)
 * - Render (512MB RAM, auto-sleep after 15 min)
 *
 * This service provides guard methods that other services call before
 * making expensive operations. It tracks usage and blocks operations
 * that would exceed limits.
 */
export class FreeTierGuardService {
  // NVIDIA call tracking per key
  private nvidiaCallCounts: Map<string, { count: number; resetAt: number }> = new Map();
  private static readonly NVIDIA_CALLS_PER_HOUR = 200; // Conservative limit per free-tier key

  // Supabase auto-cleanup retention limits
  private static readonly CHAT_HISTORY_LIMIT = 500;    // messages kept per user
  private static readonly COMPLETED_JOB_DAYS = 7;      // days to keep completed jobs
  private static readonly SUPABASE_STORAGE_LIMIT_MB = 500;
  private static readonly SUPABASE_WARNING_MB = 400;

  /**
   * Check if an NVIDIA API call is safe to make for a given key.
   * Returns true if under the rate limit, false if we should skip.
   */
  canCallNvidia(keyName: string): boolean {
    const now = Date.now();
    const entry = this.nvidiaCallCounts.get(keyName);

    if (!entry || now >= entry.resetAt) {
      // New hour window
      this.nvidiaCallCounts.set(keyName, { count: 1, resetAt: now + 60 * 60 * 1000 });
      return true;
    }

    if (entry.count >= FreeTierGuardService.NVIDIA_CALLS_PER_HOUR) {
      logger.warn(`[FREE TIER GUARD] NVIDIA key "${keyName}" has hit hourly limit (${entry.count}/${FreeTierGuardService.NVIDIA_CALLS_PER_HOUR}). Blocking call.`);
      return false;
    }

    entry.count++;
    return true;
  }

  /**
   * Track an NVIDIA call (call AFTER a successful API call)
   */
  trackNvidiaCall(keyName: string): void {
    const now = Date.now();
    const entry = this.nvidiaCallCounts.get(keyName);
    if (!entry || now >= entry.resetAt) {
      this.nvidiaCallCounts.set(keyName, { count: 1, resetAt: now + 60 * 60 * 1000 });
    } else {
      entry.count++;
    }
  }

  /**
   * Check Supabase storage usage. Returns true if safe, logs warning if approaching limit.
   * This is a lightweight check — only run daily, not on every request.
   */
  async checkSupabaseStorage(): Promise<{ safe: boolean; usedMB: number }> {
    try {
      const { data, error } = await supabaseAdmin.rpc('pg_database_size', { db_name: 'postgres' });
      
      if (error) {
        // pg_database_size may not be available on all plans — graceful fallback
        logger.warn('[FREE TIER GUARD] Could not check DB size (may not have pg_database_size)', { error: error.message });
        return { safe: true, usedMB: 0 }; // Assume safe if we can't check
      }

      const usedMB = Math.round((data || 0) / (1024 * 1024));

      if (usedMB >= FreeTierGuardService.SUPABASE_STORAGE_LIMIT_MB) {
        logger.error(`[FREE TIER GUARD] ⚠️ CRITICAL: Supabase storage at ${usedMB}MB / ${FreeTierGuardService.SUPABASE_STORAGE_LIMIT_MB}MB!`);
        return { safe: false, usedMB };
      }

      if (usedMB >= FreeTierGuardService.SUPABASE_WARNING_MB) {
        logger.warn(`[FREE TIER GUARD] Supabase storage warning: ${usedMB}MB / ${FreeTierGuardService.SUPABASE_STORAGE_LIMIT_MB}MB`);
      }

      return { safe: true, usedMB };
    } catch (err) {
      logger.warn('[FREE TIER GUARD] Storage check failed (non-critical)', {
        error: err instanceof Error ? err.message : String(err)
      });
      return { safe: true, usedMB: 0 };
    }
  }

  /**
   * Get a summary of current free-tier usage across all services.
   * Useful for the Auto Upgrade summary report.
   */
  getUsageSummary(): {
    nvidia: { [key: string]: { count: number; limit: number } };
    warnings: string[];
  } {
    const nvidia: { [key: string]: { count: number; limit: number } } = {};
    const warnings: string[] = [];

    for (const [key, entry] of this.nvidiaCallCounts) {
      nvidia[key] = {
        count: entry.count,
        limit: FreeTierGuardService.NVIDIA_CALLS_PER_HOUR
      };
      if (entry.count > FreeTierGuardService.NVIDIA_CALLS_PER_HOUR * 0.8) {
        warnings.push(`NVIDIA key "${key}" at ${Math.round(entry.count / FreeTierGuardService.NVIDIA_CALLS_PER_HOUR * 100)}% of hourly limit`);
      }
    }

    return { nvidia, warnings };
  }

  /**
   * Check if the Render free tier memory is being approached.
   * Uses process.memoryUsage() to check current heap usage.
   */
  checkRenderMemory(): { safe: boolean; usedMB: number; limitMB: number } {
    const heapUsed = process.memoryUsage().heapUsed;
    const usedMB = Math.round(heapUsed / (1024 * 1024));
    const limitMB = 512; // Render free tier

    if (usedMB > limitMB * 0.85) {
      logger.warn(`[FREE TIER GUARD] Render memory warning: ${usedMB}MB / ${limitMB}MB`);
    }

    return { safe: usedMB < limitMB * 0.9, usedMB, limitMB };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Supabase Auto-Cleanup (stays within free-tier storage)
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Main cleanup method — scheduled periodically (e.g. every 6 hours).
   * Prunes old rows so Supabase stays within the 500MB free-tier limit.
   */
  async runCleanup(): Promise<{ deleted: Record<string, number> }> {
    const deleted: Record<string, number> = {};

    try {
      deleted.chat_history = await this.pruneChatHistory();
      deleted.nova_thoughts = await this.pruneThoughts();
      deleted.outreach_log = await this.pruneOutreachLog();
      deleted.followups = await this.pruneFollowups();
      deleted.background_jobs = await this.pruneBackgroundJobs();
      deleted.working_memory = await this.pruneExpiredWorkingMemory();

      const totalDeleted = Object.values(deleted).reduce((a, b) => a + b, 0);
      if (totalDeleted > 0) {
        logger.info('[FreeTierGuard] Cleanup complete', { deleted, total: totalDeleted });
      }

      return { deleted };
    } catch (err) {
      logger.error('[FreeTierGuard] Cleanup failed', { error: err instanceof Error ? err.message : String(err) });
      return { deleted };
    }
  }

  private async pruneChatHistory(): Promise<number> {
    try {
      // Get all distinct users that have chat history
      const { data: users } = await supabaseAdmin
        .from('chat_history')
        .select('user_id')
        .limit(1000);

      if (!users || users.length === 0) return 0;
      const uniqueUsers = [...new Set(users.map((u: any) => u.user_id))];
      let totalDeleted = 0;

      for (const userId of uniqueUsers) {
        // Keep the newest N messages per user; find the created_at cutoff row
        const { data: cutoffRow } = await supabaseAdmin
          .from('chat_history')
          .select('created_at')
          .eq('user_id', userId)
          .order('created_at', { ascending: false })
          .range(FreeTierGuardService.CHAT_HISTORY_LIMIT, FreeTierGuardService.CHAT_HISTORY_LIMIT)
          .limit(1)
          .maybeSingle();

        if (cutoffRow) {
          const { count } = await supabaseAdmin
            .from('chat_history')
            .delete({ count: 'exact' })
            .eq('user_id', userId)
            .lt('created_at', cutoffRow.created_at);
          totalDeleted += count || 0;
        }
      }
      return totalDeleted;
    } catch (e) {
      logger.warn('[FreeTierGuard] Chat history prune failed', { error: e instanceof Error ? e.message : String(e) });
      return 0;
    }
  }

  private async pruneThoughts(): Promise<number> {
    try {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const { count } = await supabaseAdmin
        .from('nova_thoughts')
        .delete({ count: 'exact' })
        .lt('created_at', sevenDaysAgo);
      return count || 0;
    } catch (e) {
      logger.warn('[FreeTierGuard] Thoughts prune failed', { error: e instanceof Error ? e.message : String(e) });
      return 0;
    }
  }

  private async pruneOutreachLog(): Promise<number> {
    try {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const { count } = await supabaseAdmin
        .from('nova_outreach_log')
        .delete({ count: 'exact' })
        .lt('created_at', thirtyDaysAgo);
      return count || 0;
    } catch (e) {
      logger.warn('[FreeTierGuard] Outreach log prune failed', { error: e instanceof Error ? e.message : String(e) });
      return 0;
    }
  }

  private async pruneFollowups(): Promise<number> {
    try {
      const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
      const { count } = await supabaseAdmin
        .from('nova_followups')
        .delete({ count: 'exact' })
        .eq('status', 'sent')
        .lt('created_at', fourteenDaysAgo);
      return count || 0;
    } catch (e) {
      logger.warn('[FreeTierGuard] Followups prune failed', { error: e instanceof Error ? e.message : String(e) });
      return 0;
    }
  }

  private async pruneBackgroundJobs(): Promise<number> {
    try {
      const cutoff = new Date(Date.now() - FreeTierGuardService.COMPLETED_JOB_DAYS * 24 * 60 * 60 * 1000).toISOString();
      const { count } = await supabaseAdmin
        .from('background_jobs')
        .delete({ count: 'exact' })
        .eq('status', 'completed')
        .lt('created_at', cutoff);
      return count || 0;
    } catch (e) {
      logger.warn('[FreeTierGuard] Background jobs prune failed', { error: e instanceof Error ? e.message : String(e) });
      return 0;
    }
  }

  private async pruneExpiredWorkingMemory(): Promise<number> {
    try {
      const { count } = await supabaseAdmin
        .from('working_memory')
        .delete({ count: 'exact' })
        .lt('expires_at', new Date().toISOString());
      return count || 0;
    } catch (e) {
      logger.warn('[FreeTierGuard] Working memory prune failed', { error: e instanceof Error ? e.message : String(e) });
      return 0;
    }
  }
}

export const freeTierGuard = new FreeTierGuardService();

/** Alias for the auto-cleanup scheduler (kept separate from the original full-guard singleton). */
export const freeTierGuardService = new FreeTierGuardService();
