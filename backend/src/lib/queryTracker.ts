/**
 * QueryTracker — Wraps every Supabase call to record:
 *   - query name
 *   - duration ms
 *   - rows returned
 *   - estimated bytes transferred
 *
 * Writes are batched and flushed every 10s to avoid write amplification.
 */

import { supabaseAdmin } from './supabase';
import { logger } from './logger';

// Approximate average bytes per row for each table
const AVG_ROW_BYTES: Record<string, number> = {
  memories: 512,
  chat_history: 1024,
  kg_nodes: 256,
  kg_edges: 128,
  episodic_memories: 512,
  working_memory: 256,
  emotional_states: 128,
  background_jobs: 512,
  processed_jobs: 128,
  agent_metrics: 128,
  conversation_sessions: 128,
  profiles: 256,
  reflections: 1024,
  failed_jobs: 512,
  default: 256,
};

export interface QueryMetricRecord {
  query_name: string;
  table_name: string;
  duration_ms: number;
  rows_returned: number;
  estimated_bytes: number;
  created_at: string;
}

class QueryTracker {
  private buffer: QueryMetricRecord[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private totalEgressBytes = 0;

  constructor() {
    // Flush every 10 seconds
    this.flushTimer = setInterval(() => this.flush(), 10_000);
    // Allow process to exit without waiting
    if (this.flushTimer.unref) this.flushTimer.unref();
  }

  /**
   * Record a completed query. Call this after every DB operation.
   */
  record(queryName: string, tableName: string, durationMs: number, rowCount: number): void {
    const bytesPerRow = AVG_ROW_BYTES[tableName] ?? AVG_ROW_BYTES.default;
    const estimatedBytes = rowCount * bytesPerRow;
    this.totalEgressBytes += estimatedBytes;

    this.buffer.push({
      query_name: queryName,
      table_name: tableName,
      duration_ms: Math.round(durationMs),
      rows_returned: rowCount,
      estimated_bytes: estimatedBytes,
      created_at: new Date().toISOString(),
    });

    if (durationMs > 500) {
      logger.warn(`Slow query detected: ${queryName} on ${tableName} took ${Math.round(durationMs)}ms`);
    }
  }

  /**
   * Estimated total egress in MB since process start.
   */
  estimatedEgressMb(): number {
    return parseFloat((this.totalEgressBytes / (1024 * 1024)).toFixed(3));
  }

  /**
   * Flush buffered records to Supabase query_metrics table.
   */
  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;

    const toFlush = [...this.buffer];
    this.buffer = [];

    try {
      const { error } = await supabaseAdmin.from('query_metrics').insert(toFlush);
      if (error) {
        logger.warn('QueryTracker flush failed, re-buffering', { error: error.message });
        // Re-buffer (avoid infinite growth by capping at 1000)
        this.buffer = [...toFlush.slice(-500), ...this.buffer.slice(-500)];
      }
    } catch (err) {
      logger.warn('QueryTracker flush error', { error: err instanceof Error ? err.message : String(err) });
    }
  }

  /**
   * Helper: wrap any async DB call and automatically record its metrics.
   *
   * Usage:
   *   const { data, error } = await qt.track('get_profile', 'profiles', () =>
   *     supabaseAdmin.from('profiles').select('...').eq('id', userId).single()
   *   );
   */
  async track<T extends { data?: any; error?: any; count?: number | null }>(
    queryName: string,
    tableName: string,
    fn: () => PromiseLike<T> | Promise<T>
  ): Promise<T> {
    const start = Date.now();
    // Wrap in Promise.resolve to handle PromiseLike from Supabase
    const result = await Promise.resolve(fn());
    const durationMs = Date.now() - start;

    let rowCount = 0;
    if (result.data !== null && result.data !== undefined) {
      rowCount = Array.isArray(result.data) ? result.data.length : 1;
    }
    if (result.count !== undefined && result.count !== null) {
      rowCount = result.count;
    }

    this.record(queryName, tableName, durationMs, rowCount);
    return result;
  }
}

export const qt = new QueryTracker();
