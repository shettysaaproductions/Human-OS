import { memoryRepository } from '../services/memoryRepository';
import { MemoryType } from '../types/memory';
import { logger } from '../lib/logger';

function getMemoryTypeForKey(key: string): MemoryType {
  if (['mother_name', 'father_name', 'wife_name', 'husband_name', 'sister_name', 'brother_name'].includes(key)) {
    return 'family';
  }
  if (['company_name', 'job_title', 'workplace', 'profession'].includes(key)) {
    return 'work';
  }
  if (['goals', 'target', 'objective'].includes(key)) {
    return 'goals';
  }
  return 'personal';
}

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
          type: getMemoryTypeForKey(fact.key),
          key: fact.key,
          value: fact.value,
          importance: 80,
          confidence: 0.95,
          shouldPersist: true,
          is_protected: true,
          protection_source: 'TurnAnalyzer'
        }, sourceMessage || 'Direct Fact Extraction');

        logger.info('[DeterministicFactAgent] Successfully persisted deterministic fact', {
          userId,
          key: fact.key,
          value: fact.value
        });
      } catch (err) {
        logger.error('[DeterministicFactAgent] Failed to upsert fact', {
          fact,
          error: err instanceof Error ? err.message : String(err)
        });
      }
    }
  }
}

export const deterministicFactAgent = new DeterministicFactAgent();
