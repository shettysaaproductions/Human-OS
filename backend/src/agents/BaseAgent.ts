import { supabaseAdmin } from '../lib/supabase';
import { Job } from '../services/QueueService';
import { logger } from '../lib/logger';

export abstract class BaseAgent {
  protected agentName: string;

  constructor(agentName: string) {
    this.agentName = agentName;
  }

  /**
   * Checks if a specific message has already been processed by this agent.
   */
  protected async isIdempotent(messageId: string): Promise<boolean> {
    const { data, error } = await supabaseAdmin
      .from('processed_jobs')
      .select('id')
      .eq('agent_name', this.agentName)
      .eq('message_id', messageId)
      .maybeSingle();
      
    if (error) {
      logger.warn(`Idempotency check failed for ${this.agentName}`, { error: error.message });
      // If we fail to check, assume not processed to attempt work, but it might fail on UNIQUE constraint later.
      return false; 
    }
    
    return !!data;
  }

  /**
   * Marks a message as processed.
   */
  protected async markProcessed(messageId: string): Promise<void> {
    await supabaseAdmin
      .from('processed_jobs')
      .insert({
        agent_name: this.agentName,
        message_id: messageId
      });
  }

  /**
   * The core extraction logic to be implemented by child classes.
   * Return the number of memories/records created for logging.
   */
  protected abstract execute(job: Job): Promise<number>;

  /**
   * The public wrapper that QueueService will call.
   * Handles idempotency, timing, logging, and error handling.
   */
  public async processJob(job: Job): Promise<void> {
    const messageId = job.payload.messageId;
    if (!messageId) {
      throw new Error(`Job payload missing messageId for agent ${this.agentName}`);
    }

    const alreadyProcessed = await this.isIdempotent(messageId);
    if (alreadyProcessed) {
      logger.info(`Agent ${this.agentName} skipping already processed message ${messageId}`);
      return;
    }

    const startTime = Date.now();
    try {
      const recordsCreated = await this.execute(job);
      await this.markProcessed(messageId);
      
      const executionTime = Date.now() - startTime;
      
      // Log Metrics
      await supabaseAdmin.from('agent_metrics').insert({
        agent_name: this.agentName,
        execution_time_ms: executionTime,
        status: 'success',
        tokens_used: 0 // Will hook up to real token counting later
      });

      logger.info(`Agent ${this.agentName} completed successfully`, { 
        jobId: job.id, 
        messageId,
        executionTimeMs: executionTime,
        recordsCreated
      });
    } catch (err) {
      const executionTime = Date.now() - startTime;
      
      // Log Failure Metrics
      await supabaseAdmin.from('agent_metrics').insert({
        agent_name: this.agentName,
        execution_time_ms: executionTime,
        status: 'failed',
        tokens_used: 0
      });

      logger.error(`Agent ${this.agentName} failed`, { 
        jobId: job.id, 
        messageId,
        executionTimeMs: executionTime,
        error: err instanceof Error ? err.message : String(err)
      });
      throw err; // Throwing so QueueService handles retry/DLQ
    }
  }
}
