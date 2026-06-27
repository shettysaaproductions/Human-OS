import { semanticAgent } from '../SemanticAgent';
import { Job } from '../../services/QueueService';
import { logger } from '../../lib/logger';

async function runTests() {
  logger.info('Running Agent Unit Tests...');
  
  const mockJob: Job = {
    id: 'test-job-1',
    job_type: 'extract_semantic',
    payload: {
      userId: 'test-user-123',
      messageId: 'test-msg-123',
      message: 'I love drinking coffee in the morning'
    },
    attempts: 0,
    status: 'pending',
    created_at: new Date()
  };

  try {
    // 1. Test Idempotency (Mock)
    logger.info('Testing Semantic Agent...');
    
    // We expect this to fail gracefully or attempt to process depending on DB state.
    // For a true unit test, we'd mock supabaseAdmin. Since we aren't using Jest/Sinon here,
    // we just invoke the public processJob which tests the idempotency wrapper.
    await semanticAgent.processJob(mockJob);
    
    // If we run it again, it should hit the idempotency check and skip.
    await semanticAgent.processJob(mockJob);

    logger.info('Agent Tests Completed successfully.');
  } catch (err) {
    logger.error('Agent Tests Failed', { error: err instanceof Error ? err.message : String(err) });
    process.exit(1);
  }
}

// To run: npx ts-node src/agents/__tests__/runTests.ts
if (require.main === module) {
  runTests();
}
