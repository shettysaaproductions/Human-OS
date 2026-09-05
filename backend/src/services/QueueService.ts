import { supabaseAdmin } from '../lib/supabase';
import { logger } from '../lib/logger';
import { qt } from '../lib/queryTracker';
import { canRunNvidia, reserveNvidiaCapacity, releaseNvidiaCapacity, RoutingProfile } from '../lib/nvidia';

export interface JobOptions {
  attempts?: number;
  // BullMQ compatible options can be added here
}

export interface Job {
  id: string;
  job_type: string;
  payload: any;
  attempts: number;
  status: 'pending' | 'running' | 'completed' | 'failed';
  created_at: Date;
  started_at?: Date;
  finished_at?: Date;
}

type JobProcessor = (job: Job) => Promise<void>;

function isAccountTombstoneViolation(error: unknown): boolean {
  if (error instanceof Error) return error.message.includes('ACCOUNT_TOMBSTONE_VIOLATION');
  if (typeof error === 'object' && error !== null && 'message' in error) {
    return String((error as { message?: unknown }).message ?? '').includes('ACCOUNT_TOMBSTONE_VIOLATION');
  }
  return String(error ?? '').includes('ACCOUNT_TOMBSTONE_VIOLATION');
}

export class QueueService {
  private queueName: string;
  private processor?: JobProcessor;
  private isProcessing: boolean = false;
  private activeJobs: number = 0;
  private maxConcurrency: number = 5;
  private maxAttempts = 3;

  constructor(queueName: string, private jobTypes?: string[], private defaultProfile: RoutingProfile = 'PROACTIVE') {
    this.queueName = queueName;
  }

  /**
   * Adds a job to the queue
   */
  async add(name: string, data: any, _opts?: JobOptions): Promise<Job | null> {
    try {
      const { data: job, error } = await supabaseAdmin
        .from('background_jobs')
        .insert({
          job_type: name,
          payload: data,
          attempts: 0,
          status: 'pending'
        })
        .select('*')
        .single();

      if (error) throw error;

      this.startProcessing().catch(err =>
        logger.error(`Queue ${this.queueName} startProcessing failed`, { error: err instanceof Error ? err.message : String(err) })
      );

      return job as Job;
    } catch (err) {
      logger.error(`Failed to add job to queue ${this.queueName}`, { error: err instanceof Error ? err.message : JSON.stringify(err) });
      return null;
    }
  }

  /**
   * Registers a processor for this queue
   */
  process(processor: JobProcessor) {
    this.processor = processor;
    this.startProcessing().catch(err =>
      logger.error(`Queue ${this.queueName} startProcessing failed (process)`, { error: err instanceof Error ? err.message : String(err) })
    );
  }

  private async startProcessing() {
    if (this.isProcessing || !this.processor) return;
    this.isProcessing = true;

    try {
      const staleCutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();
      await supabaseAdmin
        .from('background_jobs')
        .update({ status: 'pending' })
        .eq('status', 'running')
        .lt('started_at', staleCutoff);

      const poll = async () => {
        if (!this.processor) {
          this.isProcessing = false;
          return;
        }

        if (this.activeJobs >= this.maxConcurrency) {
          setTimeout(poll, 1000);
          return;
        }

        if (!canRunNvidia(this.defaultProfile, 1)) {
          setTimeout(poll, 5000);
          return;
        }

        const start = Date.now();
        const { data: jobs, error } = await supabaseAdmin.rpc('claim_next_background_job', {
          p_job_types: this.jobTypes && this.jobTypes.length > 0 ? this.jobTypes : null
        });

        qt.record('poll_pending_job', 'background_jobs', Date.now() - start, jobs?.length ?? 0);

        if (error || !jobs || jobs.length === 0) {
          this.isProcessing = false;
          return;
        }

        const job = jobs[0] as Job;
        this.activeJobs++;

        this.processJob(job).finally(() => {
          this.activeJobs--;
          if (!this.isProcessing) {
            this.startProcessing().catch(err => logger.error(`Queue restart failed`, { error: err }));
          }
        });
        
        setImmediate(poll);
      };

      poll();
    } catch (err) {
      logger.error(`Queue ${this.queueName} startProcessing failed`, { error: err instanceof Error ? err.message : String(err) });
      this.isProcessing = false;
    }
  }

  private async processJob(job: Job) {
    if (!this.processor) return;
    
    reserveNvidiaCapacity(this.defaultProfile);
    try {
      await this.processor(job);
      const { error: completionError } = await supabaseAdmin
        .from('background_jobs')
        .update({ status: 'completed', finished_at: new Date().toISOString() })
        .eq('id', job.id);

      if (completionError) {
        if (isAccountTombstoneViolation(completionError)) {
          await this.discardTombstonedJob(job);
          return;
        }
        throw completionError;
      }
    } catch (jobError: any) {
      const errorMessage = jobError instanceof Error ? jobError.message : String(jobError);
      if (isAccountTombstoneViolation(jobError)) {
        await this.discardTombstonedJob(job);
        return;
      }
      logger.error(`Job ${job.id} failed`, { error: errorMessage });
      const isPermanent = jobError?.isPermanent === true || 
                          jobError?.name === 'SchemaValidationError' || 
                          jobError?.name === 'ZodError' ||
                          errorMessage.includes('missing messageId') ||
                          errorMessage.includes('Schema validation failed') ||
                          errorMessage.includes('Invalid payload for');
      await this.handleJobFailure(job, errorMessage, isPermanent);
    } finally {
      releaseNvidiaCapacity(this.defaultProfile);
    }
  }

  private async discardTombstonedJob(job: Job): Promise<void> {
    const { error } = await supabaseAdmin
      .from('background_jobs')
      .delete()
      .eq('id', job.id);

    if (error) {
      logger.error(`Failed to discard tombstoned job ${job.id}`, {
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    logger.info(`Discarded job ${job.id} for tombstoned account`);
  }

  private async handleJobFailure(job: Job, errorMessage: string, isPermanent = false) {
    if (isAccountTombstoneViolation(errorMessage)) {
      await this.discardTombstonedJob(job);
      return;
    }

    const newAttempts = isPermanent ? this.maxAttempts : job.attempts + 1;
    
    if (newAttempts >= this.maxAttempts || isPermanent) {
      await supabaseAdmin
        .from('background_jobs')
        .update({ status: 'failed', error: errorMessage, attempts: newAttempts, finished_at: new Date().toISOString() })
        .eq('id', job.id);
        
      await supabaseAdmin
        .from('failed_jobs')
        .insert({
          job_id: job.id,
          job_type: job.job_type,
          payload: job.payload,
          error: errorMessage
        });
    } else {
      await supabaseAdmin
        .from('background_jobs')
        .update({ status: 'pending', error: errorMessage, attempts: newAttempts })
        .eq('id', job.id);
    }
  }

  async getJob(id: string): Promise<Job | null> {
    const { data } = await supabaseAdmin
      .from('background_jobs')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    return data as Job | null;
  }
}

// Global Exported Queues
export const MEMORY_JOB_TYPES = [
  'extract_all_memories', 'extract_semantic', 'extract_working_memory', 'extract_episodic',
  'extract_kg', 'extract_emotional', 'extract_milestone', 'extract_short_term', 'extract_deterministic_fact'
] as const;
export const memoryQueue = new QueueService('memoryQueue', [...MEMORY_JOB_TYPES], 'MEMORY');
export const reflectionQueue = new QueueService('reflectionQueue', ['daily_reflection'], 'USER_DEEP');
export const subconsciousQueue = new QueueService('subconsciousQueue', [
  'extract_subconscious_actions',
  'extract_life_threads',
  'suppress_life_thread',
  'session_start_cognition',
  'session_end_proactive_check',
], 'SUBCONSCIOUS');

export const maintenanceQueue = new QueueService('maintenanceQueue', [
  'compact_chat_history', 'compact_episodes', 'reconcile_facts', 
  'cleanup_completed_jobs', 'cleanup_failed_jobs', 'compress_long_term_memory', 'health_snapshot'
], 'PROACTIVE');
