/**
 * DatabaseHealthService
 * 
 * Centralized health monitor for the Supabase connection.
 * Tracks: connectivity, cache ratios, egress estimates, slow queries, and alerts.
 * 
 * Call check() to get a HealthReport.
 * Call isDegraded() to check if the system should enter degraded mode.
 */

import { supabaseAdmin } from '../lib/supabase';
import { cache, CACHE_NS, CACHE_TTL } from '../lib/cache';
import { qt } from '../lib/queryTracker';
import { config } from '../config';
import { logger } from '../lib/logger';

export type DbStatus = 'online' | 'degraded' | 'offline';

export interface Alert {
  type: 'database_offline' | 'quota_warning' | 'queue_backlog' | 'cache_miss_rate_high';
  message: string;
  severity: 'critical' | 'warning' | 'info';
  timestamp: string;
}

export interface HealthReport {
  status: DbStatus;
  latency_ms: number;
  cache: {
    hits: number;
    misses: number;
    size: number;
    hit_rate: number;
    miss_rate: number;
  };
  egress: {
    estimated_mb_since_start: number;
    warning_threshold_mb: number;
    pct_used: number;
  };
  queue: {
    pending: number;
    failed: number;
  };
  alerts: Alert[];
  checked_at: string;
}

class DatabaseHealthService {
  private consecutiveFailures = 0;
  private alertHistory: Alert[] = [];
  private _status: DbStatus = 'online';

  get status(): DbStatus {
    return this._status;
  }

  isDegraded(): boolean {
    return this._status !== 'online' || config.db.degradedMode;
  }

  /**
   * Run a full health check. Results are cached for 30s.
   */
  async check(): Promise<HealthReport> {
    const cached = cache.get<HealthReport>('db_health');
    if (cached) return cached;

    const startTime = Date.now();
    const alerts: Alert[] = [];

    // ── 1. Connectivity check ──────────────────────────────────────
    let latencyMs = 0;
    try {
      const pingStart = Date.now();
      const { error } = await supabaseAdmin.from('profiles').select('id').limit(1);
      latencyMs = Date.now() - pingStart;

      if (error) throw error;
      this.consecutiveFailures = 0;
      this._status = 'online';
    } catch (err) {
      this.consecutiveFailures++;
      latencyMs = Date.now() - startTime;
      logger.error('DB health check ping failed', { failures: this.consecutiveFailures, error: err instanceof Error ? err.message : String(err) });

      if (this.consecutiveFailures >= 3) {
        this._status = 'offline';
        this.addAlert(alerts, {
          type: 'database_offline',
          message: `Supabase is unreachable. ${this.consecutiveFailures} consecutive failures.`,
          severity: 'critical'
        });
      } else {
        this._status = 'degraded';
      }
    }

    // ── 2. Cache stats ──────────────────────────────────────────────
    const cacheStats = cache.stats();
    if (cacheStats.missRate > 0.7 && (cacheStats.hits + cacheStats.misses) > 50) {
      this.addAlert(alerts, {
        type: 'cache_miss_rate_high',
        message: `Cache miss rate is ${(cacheStats.missRate * 100).toFixed(1)}% — cache may be misconfigured.`,
        severity: 'warning'
      });
    }

    // ── 3. Egress estimate ──────────────────────────────────────────
    const egressMb = qt.estimatedEgressMb();
    const thresholdMb = config.db.egressWarningThresholdMb;
    const pctUsed = parseFloat(((egressMb / thresholdMb) * 100).toFixed(1));
    if (egressMb >= thresholdMb) {
      this.addAlert(alerts, {
        type: 'quota_warning',
        message: `Estimated egress ${egressMb.toFixed(1)}MB exceeds warning threshold of ${thresholdMb}MB.`,
        severity: 'critical'
      });
    }

    // ── 4. Queue backlog check ──────────────────────────────────────
    let pendingJobs = 0;
    let failedJobs = 0;
    if (this._status === 'online') {
      try {
        const [{ count: pending }, { count: failed }] = await Promise.all([
          supabaseAdmin.from('background_jobs').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
          supabaseAdmin.from('failed_jobs').select('*', { count: 'exact', head: true })
        ]);
        pendingJobs = pending ?? 0;
        failedJobs = failed ?? 0;

        if (pendingJobs > 50) {
          this.addAlert(alerts, {
            type: 'queue_backlog',
            message: `Queue backlog is high: ${pendingJobs} pending jobs.`,
            severity: 'warning'
          });
        }
      } catch (_) {
        // Non-fatal — queue stats are best-effort
      }
    }

    const report: HealthReport = {
      status: this._status,
      latency_ms: latencyMs,
      cache: {
        hits: cacheStats.hits,
        misses: cacheStats.misses,
        size: cacheStats.size,
        hit_rate: cacheStats.hitRate,
        miss_rate: cacheStats.missRate,
      },
      egress: {
        estimated_mb_since_start: egressMb,
        warning_threshold_mb: thresholdMb,
        pct_used: pctUsed,
      },
      queue: { pending: pendingJobs, failed: failedJobs },
      alerts,
      checked_at: new Date().toISOString(),
    };

    // Cache result for 30s
    cache.set('db_health', report, CACHE_TTL.DB_HEALTH_MS, CACHE_NS.DB_HEALTH);

    // Persist alerts to history (last 50)
    this.alertHistory = [...alerts, ...this.alertHistory].slice(0, 50);

    return report;
  }

  getAlertHistory(): Alert[] {
    return this.alertHistory;
  }

  private addAlert(list: Alert[], alert: Omit<Alert, 'timestamp'>): void {
    const full: Alert = { ...alert, timestamp: new Date().toISOString() };
    list.push(full);
    logger.warn(`[ALERT] ${alert.type}: ${alert.message}`, { severity: alert.severity });
  }
}

export const dbHealthService = new DatabaseHealthService();
