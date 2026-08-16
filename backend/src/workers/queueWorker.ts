import { memoryQueue, reflectionQueue } from '../services/QueueService';
import { consolidatedMemoryAgent } from '../agents/ConsolidatedMemoryAgent';
import { shortTermMemoryAgent } from '../agents/ShortTermMemoryAgent';
import { reflectionAgent } from '../agents/ReflectionAgent';
import { logger } from '../lib/logger';

const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 5_000; // 5s base backoff

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function processWithBackoff(job: any, processor: (job: any) => Promise<void>, jobName: string) {
  let attempt = 0;
  while (attempt <= MAX_RETRIES) {
    try {
      await processor(job);
      return; // Success
    } catch (err: any) {
      const isRateLimited = err.status === 429 ||
        (err.message && (err.message.includes('rate limit') || err.message.includes('429')) ||
         err.message.includes('RPM') || err.message.includes('bucket'));

      attempt++;
      if (attempt > MAX_RETRIES) {
        logger.error(`[QueueWorker] ${jobName} failed after ${MAX_RETRIES} retries`, {
          jobId: job.id,
          error: err.message
        });
        throw err;
      }

      if (isRateLimited) {
        // Exponential backoff with jitter for rate limits
        const backoff = BASE_BACKOFF_MS * Math.pow(2, attempt - 1) + Math.random() * 2000;
        logger.warn(`[QueueWorker] ${jobName} rate limited, backing off ${Math.round(backoff)}ms (attempt ${attempt}/${MAX_RETRIES})`, {
          jobId: job.id
        });
        await sleep(backoff);
      } else {
        // For non-rate-limit errors, short delay then retry
        logger.warn(`[QueueWorker] ${jobName} error, retrying in 2s (attempt ${attempt}/${MAX_RETRIES})`, {
          jobId: job.id,
          error: err.message
        });
        await sleep(2000);
      }
    }
  }
}

export function startWorkers() {
  logger.info('Starting Background Queue Workers...');

  memoryQueue.process(async (job) => {
    switch (job.job_type) {
      case 'extract_all_memories':
        await processWithBackoff(job, consolidatedMemoryAgent.processJob.bind(consolidatedMemoryAgent), 'extract_all_memories');
        break;
      case 'extract_short_term':
        await processWithBackoff(job, shortTermMemoryAgent.processJob.bind(shortTermMemoryAgent), 'extract_short_term');
        break;
      // Legacy job types - kept for backward compatibility during transition
      case 'extract_semantic':
      case 'extract_working_memory':
      case 'extract_episodic':
      case 'extract_kg':
      case 'extract_emotional':
      case 'extract_milestone':
        logger.info(`Legacy job type ${job.job_type} received, routing to consolidated agent`);
        await processWithBackoff(job, consolidatedMemoryAgent.processJob.bind(consolidatedMemoryAgent), job.job_type);
        break;
      default:
        logger.warn(`Unknown job type received: ${job.job_type}`);
    }
  });

  reflectionQueue.process(async (job) => {
    switch (job.job_type) {
      case 'daily_reflection':
        await processWithBackoff(job, reflectionAgent.processJob.bind(reflectionAgent), 'daily_reflection');
        break;
      default:
        logger.warn(`Unknown reflection job type: ${job.job_type}`);
    }
  });
}
