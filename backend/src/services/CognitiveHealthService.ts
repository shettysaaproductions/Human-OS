import { supabaseAdmin } from '../lib/supabase';
import { logger } from '../lib/logger';
import { qt } from '../lib/queryTracker';
import { maintenanceQueue } from './QueueService';

export interface CognitiveHealthMetrics {
  status?: 'healthy' | 'degraded';
  metric_source?: string;
  metric_source_error?: string;
  chat_history_raw_count: number | null;
  chat_history_compaction_pending_count: number | null;
  memories_active_count: number | null;
  memories_archived_count: number | null;
  jobs_pending_count: number | null;
  jobs_failed_count: number | null;
  is_maintenance_required: boolean;
  retention_lag_days: number | null;
}

export class CognitiveHealthService {
  constructor() {
    // Queue processing has been moved to queueWorker.ts
  }

  /**
   * Fast, low-impact snapshot of cognitive health
   */
  async getHealthMetrics(): Promise<CognitiveHealthMetrics> {
    const { data: metricsData, error } = await supabaseAdmin.rpc('get_cognitive_health_metrics');
    
    if (error) {
      logger.error('Failed to get cognitive health metrics', { error: error.message });
      // P0: Health Failure Must Never Return Fake Zeroes
      return {
        status: 'degraded',
        metric_source: 'unavailable',
        metric_source_error: error.message,
        chat_history_raw_count: null,
        chat_history_compaction_pending_count: null,
        memories_active_count: null,
        memories_archived_count: null,
        jobs_pending_count: null,
        jobs_failed_count: null,
        is_maintenance_required: false,
        retention_lag_days: null
      };
    }
    
    return metricsData as CognitiveHealthMetrics;
  }

  /**
   * Called via CRON or interval to enqueue necessary maintenance
   */
  async scheduleMaintenanceJobs(): Promise<void> {
    const metrics = await this.getHealthMetrics();
    
    // Hard limits
    if (metrics.jobs_pending_count !== null && metrics.jobs_pending_count > 5000) {
      logger.error('System overload: Too many pending jobs. Pausing maintenance creation.');
      return;
    }

    if (metrics.chat_history_raw_count !== null && metrics.chat_history_raw_count > 500) {
      await maintenanceQueue.add('compact_chat_history', { strategy: 'batch_500' });
    }

    // Daily cleanup jobs
    await maintenanceQueue.add('cleanup_completed_jobs', {});
  }

  // Processing logic moved to queueWorker.ts

  /**
   * Prunes successfully completed background jobs older than 24 hours
   */
  async cleanupCompletedJobs(): Promise<void> {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    
    await qt.track('cleanup_completed_jobs', 'background_jobs', () => 
      supabaseAdmin
        .from('background_jobs')
        .delete()
        .eq('status', 'completed')
        .lt('finished_at', cutoff)
    );
    
    logger.info('Cleaned up old completed jobs');
  }

  /**
   * Prunes failed jobs older than 7 days
   */
  async cleanupFailedJobs(): Promise<void> {
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    
    await qt.track('cleanup_failed_jobs', 'background_jobs', () => 
      supabaseAdmin
        .from('background_jobs')
        .delete()
        .eq('status', 'failed')
        .lt('finished_at', cutoff)
    );
    
    logger.info('Cleaned up old failed jobs');
  }
}

export const cognitiveHealthService = new CognitiveHealthService();
