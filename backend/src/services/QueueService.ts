import { supabaseAdmin } from '../lib/supabase';
import { logger } from '../lib/logger';
import { qt } from '../lib/queryTracker';

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

export class QueueService {
  private queueName: string;
  private processor?: JobProcessor;
  private isProcessing: boolean = false;
  private maxAttempts = 3;

  constructor(queueName: string, private jobTypes?: string[]) {
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

      // Kick off processing in the background (fire-and-forget). A DB network failure here
      // must NOT become an unhandled rejection — that kills the whole server.
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
    // Start processing any pending jobs
    this.startProcessing().catch(err =>
      logger.error(`Queue ${this.queueName} startProcessing failed (process)`, { error: err instanceof Error ? err.message : String(err) })
    );
  }

  private async startProcessing() {
    if (this.isProcessing || !this.processor) return;
    this.isProcessing = true;

    try {
      // Crash-safety: requeue jobs left 'running' by a process that died mid-job. A fresh
      // poll cycle (this process just started) is the right time to reclaim them.
      const staleCutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();
      await supabaseAdmin
        .from('background_jobs')
        .update({ status: 'pending' })
        .eq('status', 'running')
        .lt('started_at', staleCutoff);

      while (true) {
        const start = Date.now();
        // Use atomic lock-free queue claiming to avoid race conditions across pods/restarts
        const { data: jobs, error } = await supabaseAdmin.rpc('claim_next_background_job', {
          p_job_types: this.jobTypes && this.jobTypes.length > 0 ? this.jobTypes : null
        });

        qt.record('poll_pending_job', 'background_jobs', Date.now() - start, jobs?.length ?? 0);

        if (error || !jobs || jobs.length === 0) {
          break;
        }

        const job = jobs[0] as Job;

        try {
          await this.processor(job);
          
          // Mark as completed
          await supabaseAdmin
            .from('background_jobs')
            .update({ status: 'completed', finished_at: new Date().toISOString() })
            .eq('id', job.id);
            
        } catch (jobError) {
          logger.error(`Job ${job.id} failed`, { error: jobError instanceof Error ? jobError.message : String(jobError) });
          await this.handleJobFailure(job, jobError instanceof Error ? jobError.message : String(jobError));
        }
      }
    } finally {
      this.isProcessing = false;
    }
  }

  private async handleJobFailure(job: Job, errorMessage: string) {
    const newAttempts = job.attempts + 1;
    
    if (newAttempts >= this.maxAttempts) {
      // Move to DLQ
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
      // Retry
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
  'extract_kg', 'extract_emotional', 'extract_milestone', 'extract_short_term'
] as const;
export const memoryQueue = new QueueService('memoryQueue', [...MEMORY_JOB_TYPES]);
export const reflectionQueue = new QueueService('reflectionQueue', ['daily_reflection']);
export const subconsciousQueue = new QueueService('subconsciousQueue', ['extract_subconscious_actions']);
