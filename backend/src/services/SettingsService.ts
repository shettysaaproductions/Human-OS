import { supabaseAdmin } from '../lib/supabase';
import { logger } from '../lib/logger';

interface CacheEntry {
  value: string | null;
  expiresAt: number;
}

const CACHE_TTL_MS = 60 * 1000; // 60 seconds

class SettingsService {
  private cache = new Map<string, CacheEntry>();

  /**
   * Retrieves a setting value. Pulls from cache if valid, otherwise queries Supabase.
   */
  async getSetting(key: string): Promise<string | null> {
    const cached = this.cache.get(key);
    const now = Date.now();

    if (cached && cached.expiresAt > now) {
      return cached.value;
    }

    try {
      const { data, error } = await supabaseAdmin
        .from('app_settings')
        .select('value')
        .eq('key', key)
        .maybeSingle();

      if (error) {
        logger.error(`Error fetching setting '${key}':`, { error: error.message });
        // Return stale cache if available, otherwise null
        return cached ? cached.value : null;
      }

      const value = data ? data.value : null;
      this.cache.set(key, {
        value,
        expiresAt: now + CACHE_TTL_MS
      });

      return value;
    } catch (err: any) {
      logger.error(`Fatal error in SettingsService.getSetting for key '${key}':`, { error: err.message });
      return cached ? cached.value : null;
    }
  }

  /**
   * Updates or creates a setting. Invalidates/updates the cache.
   */
  async setSetting(key: string, value: string): Promise<void> {
    try {
      const { error } = await supabaseAdmin
        .from('app_settings')
        .upsert({ key, value, updated_at: new Date().toISOString() });

      if (error) {
        throw new Error(`Failed to upsert setting: ${error.message}`);
      }

      // Update local cache
      this.cache.set(key, {
        value,
        expiresAt: Date.now() + CACHE_TTL_MS
      });
      
      logger.info(`Setting updated: '${key}'`);
    } catch (err: any) {
      logger.error(`Error in SettingsService.setSetting for key '${key}':`, { error: err.message });
      throw err;
    }
  }

  /**
   * Explicitly clears the local memory cache, forcing next fetches to hit the DB.
   */
  async refreshCache(): Promise<void> {
    this.cache.clear();
    logger.info('Settings cache explicitly refreshed/cleared.');
  }
}

export const settingsService = new SettingsService();
export default settingsService;
