import { memoryQueue, reflectionQueue } from '../services/QueueService';
import { semanticAgent } from '../agents/SemanticAgent';
import { workingMemoryAgent } from '../agents/WorkingMemoryAgent';
import { episodicAgent } from '../agents/EpisodicAgent';
import { kgAgent } from '../agents/KgAgent';
import { emotionalAgent } from '../agents/EmotionalAgent';
import { reflectionAgent } from '../agents/ReflectionAgent';
import { logger } from '../lib/logger';

export function startWorkers() {
  logger.info('Starting Background Queue Workers...');
  
  memoryQueue.process(async (job) => {
    // Determine which agent to run based on job_type, or just run them all if it's a generic memory extraction job.
    // For maximum isolation, we could have one job per agent, but to save LLM calls or just for structure,
    // let's say the queue receives a single 'extract_all' job, and it runs all agents sequentially or in parallel.
    // Wait, the architecture diagram requested:
    // QueueService -> Semantic, Emotional, KG, Working, Episodic, Reflection
    
    // For better isolation, chat.ts will enqueue individual jobs.
    switch (job.job_type) {
      case 'extract_semantic':
        await semanticAgent.processJob(job);
        break;
      case 'extract_working_memory':
        await workingMemoryAgent.processJob(job);
        break;
      case 'extract_episodic':
        await episodicAgent.processJob(job);
        break;
      case 'extract_kg':
        await kgAgent.processJob(job);
        break;
      case 'extract_emotional':
        await emotionalAgent.processJob(job);
        break;
      default:
        logger.warn(`Unknown job type received: ${job.job_type}`);
    }
  });

  reflectionQueue.process(async (job) => {
    switch (job.job_type) {
      case 'daily_reflection':
        await reflectionAgent.processJob(job);
        break;
      default:
        logger.warn(`Unknown reflection job type: ${job.job_type}`);
    }
  });
}
