import { memoryRepository } from '../services/memoryRepository';
import { logger } from '../lib/logger';

export class DeterministicFactAgent {
  async processJob(job: any): Promise<void> {
    const { userId, facts, sourceMessage } = job.payload;

    if (!userId || !facts || !Array.isArray(facts)) {
      throw new Error('Invalid payload for extract_deterministic_fact');
    }

    for (const fact of facts) {
      if (!fact.key || !fact.value) continue;
      
      try {
        await memoryRepository.upsertMemory(userId, {
          type: 'family', // Most deterministic facts are family/identity
          key: fact.key,
          value: fact.value,
          importance: 8,
          confidence: 0.95,
          shouldPersist: true,
          is_protected: true, // Deterministic facts are highly reliable
          protection_source: 'TurnAnalyzer'
        }, sourceMessage || 'Direct Fact Extraction');
      } catch (err) {
        logger.error(`[DeterministicFactAgent] Failed to upsert fact`, { fact, error: err instanceof Error ? err.message : String(err) });
      }
    }
  }
}

export const deterministicFactAgent = new DeterministicFactAgent();
