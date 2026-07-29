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
}

export const freeTierGuard = new FreeTierGuardService();
