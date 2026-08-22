import {
  determineUserProfile,
  resolveRoutingProfile,
} from '../nvidia';
import { MEMORY_JOB_TYPES } from '../../services/QueueService';

describe('NVIDIA routing profiles', () => {
  it('routes a reflex message to USER_FAST / Frontal', () => {
    const profile = determineUserProfile('hey');
    expect(profile).toBe('USER_FAST');
    expect(resolveRoutingProfile(profile).region).toBe('frontal');
  });

  it('routes an explicit multi-step analysis to USER_DEEP / Deep Cortex', () => {
    const profile = determineUserProfile('Analyze these two approaches step-by-step and compare their trade-offs.');
    expect(profile).toBe('USER_DEEP');
    expect(resolveRoutingProfile(profile).region).toBe('deepCortex');
  });

  it('does not escalate ordinary references to plans or projects', () => {
    expect(determineUserProfile('My project plan is going okay today.')).toBe('USER_FAST');
  });

  it('keeps extraction capabilities on the 8B model', () => {
    for (const profile of ['MEMORY', 'SUBCONSCIOUS', 'CRITICAL_ACTION', 'TIMEOUT_FALLBACK'] as const) {
      expect(resolveRoutingProfile(profile).model).toBe('meta/llama-3.1-8b-instruct');
    }
  });

  it('allows consolidated memory jobs to be claimed by memoryQueue', () => {
    expect(MEMORY_JOB_TYPES).toContain('extract_all_memories');
  });
});
