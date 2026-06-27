import { supabaseAdmin } from '../lib/supabase';
import { Job } from '../services/QueueService';
import { logger } from '../lib/logger';
import { cache, CACHE_NS, CACHE_TTL } from '../lib/cache';
import { qt } from '../lib/queryTracker';

// Buffered agent metrics — flushed every 15 seconds
interface MetricRecord {
  agent_name: string;
  execution_time_ms: number;
  status: 'success' | 'failed';
  tokens_used: number;
  created_at: string;
}

const metricsBuffer: MetricRecord[] = [];
let metricsFlushTimer: NodeJS.Timeout | null = null;

function ensureMetricsFlush() {
  if (metricsFlushTimer) return;
  metricsFlushTimer = setInterval(async () => {
    if (metricsBuffer.length === 0) return;
    const batch = metricsBuffer.splice(0, metricsBuffer.length);
    try {
      await supabaseAdmin.from('agent_metrics').insert(batch);
    } catch (err) {
      logger.warn('Failed to flush agent_metrics batch', { error: err instanceof Error ? err.message : String(err) });
    }
  }, 15_000);
  if (metricsFlushTimer.unref) metricsFlushTimer.unref();
}

function bufferMetric(record: MetricRecord): void {
  metricsBuffer.push(record);
}

export abstract class BaseAgent {
  protected agentName: string;

  constructor(agentName: string) {
    this.agentName = agentName;
    ensureMetricsFlush();
  }

  /**
   * Checks if a specific message has already been processed by this agent.
   * Uses in-memory cache to avoid redundant DB reads.
   */
  protected async isIdempotent(messageId: string): Promise<boolean> {
    const cacheKey = `idempotency:${this.agentName}:${messageId}`;
    const cached = cache.get<boolean>(cacheKey);
    if (cached === true) {
      logger.debug(`Idempotency cache hit for ${this.agentName}:${messageId}`);
      return true;
    }

    const { data, error } = await qt.track('idempotency_check', 'processed_jobs', () =>
      supabaseAdmin
        .from('processed_jobs')
        .select('id')
        .eq('agent_name', this.agentName)
        .eq('message_id', messageId)
        .maybeSingle()
    );

    if (error) {
      logger.warn(`Idempotency check failed for ${this.agentName}`, { error: error.message });
      return false;
    }

    const alreadyDone = !!data;
    if (alreadyDone) {
      // Cache positive result so subsequent calls don't hit DB
      cache.set(cacheKey, true, CACHE_TTL.IDEMPOTENCY_MS, CACHE_NS.IDEMPOTENCY);
    }
    return alreadyDone;
  }

  /**
   * Marks a message as processed.
   */
  protected async markProcessed(messageId: string): Promise<void> {
    await qt.track('mark_processed', 'processed_jobs', () =>
      supabaseAdmin
        .from('processed_jobs')
        .insert({ agent_name: this.agentName, message_id: messageId })
    );

    // Cache the positive result immediately
    const cacheKey = `idempotency:${this.agentName}:${messageId}`;
    cache.set(cacheKey, true, CACHE_TTL.IDEMPOTENCY_MS, CACHE_NS.IDEMPOTENCY);
  }

  protected abstract execute(job: Job): Promise<number>;

  /**
   * The public wrapper that QueueService will call.
   * Handles idempotency, timing, batched metrics, and error handling.
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

      // Buffer metric — don't await
      bufferMetric({
        agent_name: this.agentName,
        execution_time_ms: executionTime,
        status: 'success',
        tokens_used: 0,
        created_at: new Date().toISOString(),
      });

      logger.info(`Agent ${this.agentName} completed successfully`, {
        jobId: job.id,
        messageId,
        executionTimeMs: executionTime,
        recordsCreated,
      });
    } catch (err) {
      const executionTime = Date.now() - startTime;

      bufferMetric({
        agent_name: this.agentName,
        execution_time_ms: executionTime,
        status: 'failed',
        tokens_used: 0,
        created_at: new Date().toISOString(),
      });

      logger.error(`Agent ${this.agentName} failed`, {
        jobId: job.id,
        messageId,
        executionTimeMs: executionTime,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }
}
