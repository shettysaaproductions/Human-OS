import { supabaseAdmin } from '../lib/supabase';
import { logger } from '../lib/logger';

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

  constructor(queueName: string) {
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
      
      // Kick off processing in the background (fire-and-forget)
      this.startProcessing();

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
    this.startProcessing();
  }

  private async startProcessing() {
    if (this.isProcessing || !this.processor) return;
    this.isProcessing = true;

    try {
      while (true) {
        // Fetch the next pending job
        // Note: For a true distributed system, this needs a transaction with row locking, 
        // but for now this works as a Node-level queue processor.
        const { data: jobs, error } = await supabaseAdmin
          .from('background_jobs')
          .select('*')
          .eq('status', 'pending')
          .order('created_at', { ascending: true })
          .limit(1);

        if (error || !jobs || jobs.length === 0) {
          break; // Queue is empty
        }

        const job = jobs[0] as Job;

        // Mark as running
        await supabaseAdmin
          .from('background_jobs')
          .update({ status: 'running', started_at: new Date().toISOString() })
          .eq('id', job.id);

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
export const memoryQueue = new QueueService('memoryQueue');
export const reflectionQueue = new QueueService('reflectionQueue');
