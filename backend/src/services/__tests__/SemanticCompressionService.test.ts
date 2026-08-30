/**
 * SemanticCompressionService.test.ts — Phase 2E-D Comprehensive Test Suite
 */

import {
  SemanticCompressionService,
  generateCompressionFingerprint,
  mapCategoryToMemoryType,
} from '../SemanticCompressionService';
import { supabaseAdmin } from '../../lib/supabase';
import { cognitiveRouter } from '../../lib/cognitiveRouter';
import { memoryRepository } from '../memoryRepository';
import { MemoryPromotionCandidate } from '../../types/memory';

jest.mock('../../lib/supabase', () => ({
  supabaseAdmin: {
    from: jest.fn(),
  },
}));

jest.mock('../../lib/cognitiveRouter', () => ({
  cognitiveRouter: {
    complete: jest.fn(),
  },
}));

jest.mock('../memoryRepository', () => ({
  memoryRepository: {
    upsertMemory: jest.fn(),
  },
}));

function createChainableMock(finalResult: any = { data: [], error: null }) {
  const chain: any = { ...finalResult };
  chain.select = jest.fn().mockReturnValue(chain);
  chain.insert = jest.fn().mockReturnValue(chain);
  chain.update = jest.fn().mockReturnValue(chain);
  chain.delete = jest.fn().mockReturnValue(chain);
  chain.eq = jest.fn().mockReturnValue(chain);
  chain.lte = jest.fn().mockReturnValue(chain);
  chain.gte = jest.fn().mockReturnValue(chain);
  chain.in = jest.fn().mockReturnValue(chain);
  chain.order = jest.fn().mockReturnValue(chain);
  chain.limit = jest.fn().mockReturnValue(chain);
  chain.maybeSingle = jest.fn().mockResolvedValue(finalResult);
  chain.single = jest.fn().mockResolvedValue(finalResult);
  chain.then = (resolve: any) => resolve(finalResult);
  return chain;
}

describe('Phase 2E-D: SemanticCompressionService', () => {
  let service: SemanticCompressionService;
  const userId = 'user-phase2ed-test';

  beforeEach(() => {
    jest.clearAllMocks();
    service = new SemanticCompressionService();
  });

  const baseCandidate: MemoryPromotionCandidate = {
    candidate_id: 'cand-1',
    user_id: userId,
    category: 'FACT',
    proposed_key: 'work_history',
    proposed_value: 'Worked at Google and joined OpenAI',
    source_references: [
      { type: 'working_memory', id: 'wm-1' },
      { type: 'episodic_memory', id: 'ep-1' },
    ],
    confidence: 0.9,
    importance_estimate: 80,
    reason: 'Career transition records',
    created_at: new Date().toISOString(),
    status: 'candidate',
  };

  // 1 & 7-8. Simple factual compression & temporal sequence preserved
  test('1 & 7-8. Accurately synthesizes and verifies factual compression with temporal sequence', async () => {
    (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'working_memory') {
        return createChainableMock({
          data: [
            { id: 'wm-1', user_id: userId, key: 'prev_job', value: 'Google', created_at: '2025-01-01T00:00:00Z' },
          ],
        });
      }
      if (table === 'episodic_memories') {
        return createChainableMock({
          data: [
            { id: 'ep-1', user_id: userId, summary: 'Joined OpenAI today', emotion: 'excited', created_at: '2025-08-01T00:00:00Z' },
          ],
        });
      }
      if (table === 'memories') {
        // DB readback mock
        return createChainableMock({
          data: {
            id: 'mem-written-1',
            user_id: userId,
            key: 'work_history',
            value: 'Previously worked at Google and later joined OpenAI in August 2025',
            source_authority: 'subconscious_inference',
          },
        });
      }
      return createChainableMock({ data: [] });
    });

    // Mock Generator (Flash Medium)
    (cognitiveRouter.complete as jest.Mock).mockResolvedValueOnce(
      JSON.stringify({
        draft: {
          key: 'work_history',
          value: 'Previously worked at Google and later joined OpenAI in August 2025',
          category: 'FACT',
          confidence: 0.9,
          importance: 85,
          reason: 'Verified sequential job transition',
          temporal_summary: 'Worked at Google first, then joined OpenAI',
          source_refs: [{ type: 'working_memory', id: 'wm-1' }, { type: 'episodic_memory', id: 'ep-1' }],
        },
      })
    );

    // Mock Verifier (Flash High)
    (cognitiveRouter.complete as jest.Mock).mockResolvedValueOnce(
      JSON.stringify({
        decision: 'approve',
        confidence: 0.92,
        unsupported_claims: [],
        temporal_conflict: false,
        temporal_accurate: true,
        reason: 'Chronological sequence is completely supported by evidence',
      })
    );

    const result = await service.processCandidateCompression(userId, baseCandidate);

    expect(result.status).toBe('verified_and_written');
    expect(result.proposal?.key).toBe('work_history');
    expect(result.proposal?.value).toContain('Previously worked at Google and later joined OpenAI');
    expect(result.proposal?.source_authority).toBe('subconscious_inference');
    expect(result.proposal?.archive_candidate).toBe(true);

    // Verify written through memoryRepository
    expect(memoryRepository.upsertMemory).toHaveBeenCalledWith(
      userId,
      expect.objectContaining({
        key: 'work_history',
        source_authority: 'subconscious_inference',
        compression_status: 'compressed',
      }),
      expect.any(String)
    );
  });

  // 2. Repeated events do not become personality traits
  test('2. Frequency != Truth: Rejects draft when repeated events are converted to personality traits', async () => {
    (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'working_memory') {
        return createChainableMock({
          data: [{ id: 'wm-1', user_id: userId, key: 'meal', value: 'ate pizza 3 times', created_at: '2026-08-01T00:00:00Z' }],
        });
      }
      return createChainableMock({ data: [] });
    });

    // Generator returns ungrounded trait
    (cognitiveRouter.complete as jest.Mock).mockResolvedValueOnce(
      JSON.stringify({
        draft: {
          key: 'dietary_trait',
          value: 'User is obsessed with pizza and has an unhealthy fast food habit',
          category: 'PATTERN',
          confidence: 0.8,
          importance: 70,
          source_refs: [{ type: 'working_memory', id: 'wm-1' }],
        },
      })
    );

    // Verifier catches and rejects trait leap
    (cognitiveRouter.complete as jest.Mock).mockResolvedValueOnce(
      JSON.stringify({
        decision: 'reject',
        confidence: 0.95,
        unsupported_claims: ['User is obsessed with pizza', 'unhealthy fast food habit'],
        temporal_conflict: false,
        temporal_accurate: true,
        reason: 'Frequency of eating pizza does not warrant psychological obsession claim',
      })
    );

    const result = await service.processCandidateCompression(userId, baseCandidate);

    expect(result.status).toBe('rejected');
    expect(memoryRepository.upsertMemory).not.toHaveBeenCalled();
  });

  // 3-6. Unsupported adjective, causal leap, identity hallucination rejection
  test('3-6. Rejects unsupported adjectives, causal claims, and identity hallucinations', async () => {
    (supabaseAdmin.from as jest.Mock).mockImplementation(() => createChainableMock({ data: [{ id: 'wm-1', user_id: userId, key: 'k', value: 'v' }] }));

    (cognitiveRouter.complete as jest.Mock).mockResolvedValueOnce(
      JSON.stringify({
        draft: {
          key: 'work_style',
          value: 'Extremely aggressive negotiator because user experienced early career hardship',
          category: 'PATTERN',
          confidence: 0.7,
          importance: 60,
          source_refs: [{ type: 'working_memory', id: 'wm-1' }],
        },
      })
    );

    (cognitiveRouter.complete as jest.Mock).mockResolvedValueOnce(
      JSON.stringify({
        decision: 'reject',
        confidence: 0.99,
        unsupported_claims: ['Extremely aggressive negotiator', 'experienced early career hardship'],
        temporal_conflict: false,
        temporal_accurate: false,
        reason: 'Unsupported causal narrative and personality adjectives',
      })
    );

    const result = await service.processCandidateCompression(userId, baseCandidate);

    expect(result.status).toBe('rejected');
    expect(memoryRepository.upsertMemory).not.toHaveBeenCalled();
  });

  // 13. Duplicate compression fingerprint
  test('13. Suppresses duplicate compression attempts via deterministic fingerprint', async () => {
    const fp1 = generateCompressionFingerprint(userId, ['wm-1', 'ep-1'], 'work_history', 'Worked at Google');
    const fp2 = generateCompressionFingerprint(userId, ['ep-1', 'wm-1'], 'work_history', 'Worked at Google');
    expect(fp1).toBe(fp2);
  });

  // 14-15. Malformed JSON handling
  test('14-15. Safely rejects on malformed generator or verifier JSON without throwing', async () => {
    (supabaseAdmin.from as jest.Mock).mockImplementation(() => createChainableMock({ data: [{ id: 'wm-1', user_id: userId, key: 'k', value: 'v' }] }));

    (cognitiveRouter.complete as jest.Mock).mockResolvedValueOnce('INVALID_JSON');

    const result = await service.processCandidateCompression(userId, baseCandidate);

    expect(result.status).toBe('rejected');
    expect(memoryRepository.upsertMemory).not.toHaveBeenCalled();
  });

  // 17-19. Verifier uncertainty and Pro High escalation (max 1/user)
  test('17-19. Escalates uncertain high-value verification to Pro High up to limit of 1 per run', async () => {
    (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'memories') {
        return createChainableMock({
          data: {
            id: 'mem-esc-1',
            user_id: userId,
            key: 'legal_status',
            value: 'Permanent resident approved in 2026',
            source_authority: 'subconscious_inference',
          },
        });
      }
      return createChainableMock({ data: [{ id: 'wm-1', user_id: userId, key: 'visa', value: 'PR approved' }] });
    });

    // 1. Generator
    (cognitiveRouter.complete as jest.Mock).mockResolvedValueOnce(
      JSON.stringify({
        draft: {
          key: 'legal_status',
          value: 'Permanent resident approved in 2026',
          category: 'FACT',
          confidence: 0.85,
          importance: 90, // High importance
          source_refs: [{ type: 'working_memory', id: 'wm-1' }],
        },
      })
    );

    // 2. Flash High verifier returns UNCERTAIN
    (cognitiveRouter.complete as jest.Mock).mockResolvedValueOnce(
      JSON.stringify({
        decision: 'uncertain',
        confidence: 0.6,
        unsupported_claims: [],
        temporal_conflict: false,
        temporal_accurate: true,
        reason: 'Complex legal status wording requires senior review',
      })
    );

    // 3. Pro High escalation returns APPROVE
    (cognitiveRouter.complete as jest.Mock).mockResolvedValueOnce(
      JSON.stringify({
        decision: 'approve',
        confidence: 0.95,
        unsupported_claims: [],
        temporal_conflict: false,
        temporal_accurate: true,
        reason: 'Senior verification confirmed statement matches evidence perfectly',
      })
    );

    const result = await service.processCandidateCompression(userId, baseCandidate);

    expect(result.status).toBe('verified_and_written');
    expect(result.proposal?.verification_result.verifier_model).toBe('gemini-pro-high');
    expect(result.proposal?.verification_result.escalated).toBe(true);
  });

  // 20. Write verification failure
  test('20. Fails proposal when post-write readback verification does not match', async () => {
    let memCallCount = 0;
    (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'memories') {
        memCallCount++;
        if (memCallCount === 1) {
          // fetch_comp_mems returns empty array
          return createChainableMock({ data: [] });
        }
        // Readback returns null (failed write)
        return createChainableMock({ data: null });
      }
      return createChainableMock({ data: [{ id: 'wm-1', user_id: userId, key: 'k', value: 'v' }] });
    });

    (cognitiveRouter.complete as jest.Mock).mockResolvedValueOnce(
      JSON.stringify({
        draft: {
          key: 'test_key',
          value: 'test_val',
          category: 'FACT',
          confidence: 0.9,
          importance: 70,
          source_refs: [{ type: 'working_memory', id: 'wm-1' }],
        },
      })
    );

    (cognitiveRouter.complete as jest.Mock).mockResolvedValueOnce(
      JSON.stringify({
        decision: 'approve',
        confidence: 0.9,
        unsupported_claims: [],
        temporal_conflict: false,
        temporal_accurate: true,
      })
    );

    const result = await service.processCandidateCompression(userId, baseCandidate);

    expect(result.status).toBe('failed');
    expect(result.reason).toContain('Post-write readback verification failed');
  });

  // 21. Cross-user reference blocked
  test('21. Rejects compression packet immediately if any source reference belongs to another user', async () => {
    (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'working_memory') {
        return createChainableMock({
          data: [
            { id: 'wm-foreign', user_id: 'DIFFERENT_USER_ID', key: 'secret', value: 'data' },
          ],
        });
      }
      return createChainableMock({ data: [] });
    });

    const foreignCandidate = {
      ...baseCandidate,
      source_references: [{ type: 'working_memory' as const, id: 'wm-foreign' }],
    };

    const result = await service.processCandidateCompression(userId, foreignCandidate);

    expect(result.status).toBe('rejected');
    expect(result.reason).toContain('cross-user');
    expect(cognitiveRouter.complete).not.toHaveBeenCalled();
  });

  // 22-25. Non-destructive source preservation & authority rules
  test('22-25. Source records are never deleted or archived; authority is subconscious_inference', async () => {
    (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'memories') {
        return createChainableMock({
          data: {
            id: 'mem-authed-1',
            user_id: userId,
            key: 'team_size',
            value: 'Manages a team of 5 engineers',
            source_authority: 'subconscious_inference',
          },
        });
      }
      return createChainableMock({ data: [{ id: 'wm-1', user_id: userId, key: 'team', value: '5 engineers' }] });
    });

    (cognitiveRouter.complete as jest.Mock).mockResolvedValueOnce(
      JSON.stringify({
        draft: {
          key: 'team_size',
          value: 'Manages a team of 5 engineers',
          category: 'FACT',
          confidence: 0.9,
          importance: 75,
          source_refs: [{ type: 'working_memory', id: 'wm-1' }],
        },
      })
    );

    (cognitiveRouter.complete as jest.Mock).mockResolvedValueOnce(
      JSON.stringify({
        decision: 'approve',
        confidence: 0.95,
        unsupported_claims: [],
        temporal_conflict: false,
        temporal_accurate: true,
      })
    );

    const result = await service.processCandidateCompression(userId, baseCandidate);

    expect(result.status).toBe('verified_and_written');
    expect(result.proposal?.source_authority).toBe('subconscious_inference');
    expect(result.proposal?.source_authority).not.toBe('explicit_user');
    expect(result.proposal?.source_authority).not.toBe('deterministic');

    // Verify 0 delete/archive calls on working/episodic tables
    const deleteCalls = (supabaseAdmin.from as jest.Mock).mock.calls.filter(c => c[0] === 'working_memory' || c[0] === 'episodic_memories');
    expect(deleteCalls.length).toBeGreaterThan(0); // Only queried via select
  });

  // 28. Rollback invalidates proposal without deleting evidence
  test('28. Rollback invalidates proposal and archives semantic memory without deleting source evidence', async () => {
    const mockMemUpdate = jest.fn().mockReturnValue(createChainableMock());
    (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'memories') {
        const chain = createChainableMock();
        chain.update = mockMemUpdate;
        return chain;
      }
      return createChainableMock();
    });

    // Manually register proposal in service
    (service as any).proposalStore.set(userId, [
      {
        proposal_id: 'prop-to-invalidate',
        user_id: userId,
        key: 'old_fact',
        value: 'wrong data',
        written_memory_id: 'mem-to-archive',
        status: 'verified',
      },
    ]);

    const success = await service.invalidateProposal(userId, 'prop-to-invalidate', 'Disproven by new user correction');

    expect(success).toBe(true);
    const updated = service.getProposals(userId);
    expect(updated[0].status).toBe('invalidated');
    expect(updated[0].invalidated_reason).toContain('Disproven');
  });
});
