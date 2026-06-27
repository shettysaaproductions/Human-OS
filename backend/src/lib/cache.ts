/**
 * Lightweight in-process TTL cache with namespace invalidation and hit/miss tracking.
 * Zero external dependencies. Safe for single-process Node.js.
 */

import { logger } from './logger';

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
  namespace: string;
}

class NodeCache {
  private store = new Map<string, CacheEntry<any>>();
  private hits = 0;
  private misses = 0;

  get<T>(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) {
      this.misses++;
      return undefined;
    }
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      this.misses++;
      return undefined;
    }
    this.hits++;
    return entry.value as T;
  }

  set<T>(key: string, value: T, ttlMs: number, namespace = 'default'): void {
    this.store.set(key, {
      value,
      expiresAt: Date.now() + ttlMs,
      namespace
    });
  }

  /**
   * Invalidate a single key.
   */
  invalidate(key: string): void {
    this.store.delete(key);
  }

  /**
   * Invalidate ALL keys in a given namespace.
   * E.g., cache.invalidateNamespace('profile') clears all profile caches.
   */
  invalidateNamespace(namespace: string): void {
    let count = 0;
    for (const [key, entry] of this.store.entries()) {
      if (entry.namespace === namespace) {
        this.store.delete(key);
        count++;
      }
    }
    if (count > 0) {
      logger.debug(`Cache: invalidated ${count} keys in namespace "${namespace}"`);
    }
  }

  /**
   * Returns cache statistics.
   */
  stats(): { hits: number; misses: number; size: number; hitRate: number; missRate: number } {
    const total = this.hits + this.misses;
    return {
      hits: this.hits,
      misses: this.misses,
      size: this.store.size,
      hitRate: total > 0 ? parseFloat((this.hits / total).toFixed(4)) : 0,
      missRate: total > 0 ? parseFloat((this.misses / total).toFixed(4)) : 0,
    };
  }

  /**
   * Clear everything (used in tests).
   */
  flush(): void {
    this.store.clear();
    this.hits = 0;
    this.misses = 0;
  }
}

// Singleton instance — imported by all services
export const cache = new NodeCache();

// Namespaces used across the system
export const CACHE_NS = {
  PROFILE: 'profile',
  WORKING_MEMORY: 'working_memory',
  DIAGNOSTICS: 'diagnostics',
  DB_HEALTH: 'db_health',
  IDEMPOTENCY: 'idempotency',
} as const;

// TTLs
export const CACHE_TTL = {
  PROFILE_MS: 5 * 60 * 1000,          // 5 minutes
  WORKING_MEMORY_MS: 30 * 1000,       // 30 seconds
  DIAGNOSTICS_MS: 30 * 1000,          // 30 seconds
  DB_HEALTH_MS: 30 * 1000,            // 30 seconds
  IDEMPOTENCY_MS: 60 * 1000,          // 60 seconds
} as const;
