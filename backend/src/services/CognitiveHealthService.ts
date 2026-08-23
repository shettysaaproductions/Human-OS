import { supabaseAdmin } from '../lib/supabase';
import { logger } from '../lib/logger';
import { qt } from '../lib/queryTracker';
import { maintenanceQueue, Job } from './QueueService';

export interface CognitiveHealthMetrics {
  chat_history_raw_count: number;
  chat_history_compaction_pending_count: number;
  memories_active_count: number;
  memories_archived_count: number;
  jobs_pending_count: number;
  jobs_failed_count: number;
  is_maintenance_required: boolean;
  retention_lag_days: number;
}

export class CognitiveHealthService {
  constructor() {
    this.registerMaintenanceProcessor();
  }

  /**
   * Fast, low-impact snapshot of cognitive health
   */
  async getHealthMetrics(): Promise<CognitiveHealthMetrics> {
    const { data: metricsData, error } = await supabaseAdmin.rpc('get_cognitive_health_metrics');
    
    if (error) {
      logger.error('Failed to get cognitive health metrics', { error: error.message });
      // Fallback
      return {
        chat_history_raw_count: 0,
        chat_history_compaction_pending_count: 0,
        memories_active_count: 0,
        memories_archived_count: 0,
        jobs_pending_count: 0,
        jobs_failed_count: 0,
        is_maintenance_required: false,
        retention_lag_days: 0
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
    if (metrics.jobs_pending_count > 5000) {
      logger.error('System overload: Too many pending jobs. Pausing maintenance creation.');
      return;
    }

    if (metrics.chat_history_raw_count > 500) {
      await maintenanceQueue.add('compact_chat_history', { strategy: 'batch_500' });
    }

    // Daily cleanup jobs
    await maintenanceQueue.add('cleanup_completed_jobs', {});
  }

  private registerMaintenanceProcessor() {
    maintenanceQueue.process(async (job: Job) => {
      logger.info(`Starting maintenance job: ${job.job_type}`, { jobId: job.id });
      
      switch (job.job_type) {
        case 'cleanup_completed_jobs':
          await this.cleanupCompletedJobs();
          break;
        case 'cleanup_failed_jobs':
          await this.cleanupFailedJobs();
          break;
        case 'compact_chat_history':
          // Handled by ChatHistoryPruningService, but routed through here
          const { ChatHistoryPruningService } = require('./ChatHistoryPruningService');
          await ChatHistoryPruningService.processCompaction(job.payload);
          break;
        default:
          logger.warn(`Unknown maintenance job type: ${job.job_type}`);
      }
    });
  }

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
