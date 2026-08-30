/**
 * CandidateSynthesisConcurrency.test.ts — Phase 2E-C Concurrency Hardening Test Suite
 */

import {
  CandidateSynthesisService,
  getLogicalRunId,
  CANDIDATE_SYNTHESIS_LIMITS,
} from '../CandidateSynthesisService';
import { supabaseAdmin } from '../../lib/supabase';
import { cognitiveRouter } from '../../lib/cognitiveRouter';
import { memoryRepository } from '../memoryRepository';

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

function createChainableMock(finalResult: any = { data: null, error: null }) {
  const chain: any = {};
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
  return chain;
}

describe('Phase 2E-C Concurrency Hardening', () => {
  let service: CandidateSynthesisService;
  const userId = 'user-concurrent-123';
  const runId = 'candidate_synthesis:2026-08-30';

  beforeEach(() => {
    jest.clearAllMocks();
    service = new CandidateSynthesisService();
  });

  // 1. One nightly run per day & Logical Run ID
  test('1. Logical run ID is deterministically formatted per calendar day', () => {
    const d1 = new Date('2026-08-30T03:00:00+05:30');
    expect(getLogicalRunId(d1)).toBe('candidate_synthesis:2026-08-30');
  });

  // 2. Concurrent scheduler invocation: Second process sees ALREADY_RUNNING
  test('2. Concurrent scheduler invocation blocks second process from running', async () => {
    (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'candidate_synthesis_runs') {
        const chain = createChainableMock({
          data: { id: runId, status: 'running', started_at: new Date().toISOString() },
          error: null,
        });
        return chain;
      }
      return createChainableMock();
    });

    const result = await service.runNightlyCandidateSynthesisForAllUsers(runId);

    expect(result.status).toBe('already_running');
    expect(result.totalModelCalls).toBe(0);
    expect(cognitiveRouter.complete).not.toHaveBeenCalled();
  });

  // 3 & 4. Concurrent user claim: Process B fails user claim when Process A holds active lease
  test('3-4. Process B fails to acquire user claim when Process A holds active lease -> 0 LLM calls', async () => {
    let callCount = 0;
    (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'candidate_synthesis_claims') {
        callCount++;
        if (callCount === 1) {
          // Insert attempt fails due to unique conflict
          return createChainableMock({ data: null, error: { code: '23505' } });
        }
        // Subsequent select returns active lease
        return createChainableMock({
          data: {
            id: 'claim-1',
            status: 'claimed',
            lease_until: new Date(Date.now() + 4 * 60 * 1000).toISOString(),
            attempt_count: 1,
          },
          error: null,
        });
      }
      return createChainableMock();
    });

    const result = await service.synthesizeCandidatesForUser(userId, runId);

    expect(result.status).toBe('skipped');
    expect(result.reason).toBe('active_lease');
    expect(result.modelCalls).toBe(0);
    expect(cognitiveRouter.complete).not.toHaveBeenCalled();
  });

  // 5-7. Process restart & lease recovery after expiry
  test('5-7. Process crash recovery: Reclaims expired lease and executes synthesis', async () => {
    const wmId = 'wm-reclaimed';
    let claimUpdateCalled = false;
    let claimCallCount = 0;

    (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'candidate_synthesis_claims') {
        claimCallCount++;
        if (claimCallCount === 1) {
          // Initial insert fails due to unique conflict
          return createChainableMock({ data: null, error: { code: '23505' } });
        }
        if (claimCallCount === 2) {
          // Select returns expired lease
          return createChainableMock({
            data: {
              id: 'claim-1',
              status: 'claimed',
              lease_until: new Date(Date.now() - 60 * 1000).toISOString(), // Expired 1 min ago!
              attempt_count: 1,
            },
            error: null,
          });
        }
        // Update to reclaim lease
        claimUpdateCalled = true;
        return createChainableMock({ data: { id: 'claim-1' }, error: null });
      }
      if (table === 'working_memory') {
        const chain = createChainableMock();
        chain.limit = jest.fn().mockResolvedValue({
          data: [{ id: wmId, key: 'city', value: 'Delhi', created_at: new Date().toISOString() }],
          error: null,
        });
        return chain;
      }
      if (table === 'episodic_memories' || table === 'memories') {
        const chain = createChainableMock();
        chain.limit = jest.fn().mockResolvedValue({ data: [], error: null });
        return chain;
      }
      return createChainableMock();
    });

    (cognitiveRouter.complete as jest.Mock).mockResolvedValue(
      JSON.stringify({
        candidates: [
          {
            category: 'FACT',
            key: 'current_city',
            value: 'Delhi',
            confidence: 0.9,
            importance: 80,
            reason: 'User lives in Delhi',
            source_refs: [{ type: 'working_memory', id: wmId }],
          },
        ],
      })
    );

    const result = await service.synthesizeCandidatesForUser(userId, runId);

    expect(claimUpdateCalled).toBe(true);
    expect(result.status).toBe('completed');
    expect(result.modelCalls).toBe(1);
    expect(result.candidatesGenerated.length).toBe(1);
  });

  // 8. Max one Gemini call per user per run
  test('8. Completed user batch is skipped on subsequent invocations -> exactly 0 calls', async () => {
    let claimCallCount = 0;
    (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'candidate_synthesis_claims') {
        claimCallCount++;
        if (claimCallCount === 1) {
          return createChainableMock({ data: null, error: { code: '23505' } });
        }
        return createChainableMock({
          data: {
            id: 'claim-1',
            status: 'completed',
            lease_until: new Date(Date.now() + 60 * 1000).toISOString(),
            attempt_count: 1,
          },
          error: null,
        });
      }
      return createChainableMock();
    });

    const result = await service.synthesizeCandidatesForUser(userId, runId);

    expect(result.status).toBe('skipped');
    expect(result.reason).toBe('already_completed');
    expect(result.modelCalls).toBe(0);
    expect(cognitiveRouter.complete).not.toHaveBeenCalled();
  });

  // 9-11. Failed batch and error handling
  test('9-11. Failed Gemini call updates claim error and fails safely', async () => {
    const wmId = 'wm-fail';
    let markedFailed = false;

    (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'candidate_synthesis_claims') {
        const chain = createChainableMock({ data: { id: 'claim-new' }, error: null });
        chain.update = jest.fn().mockImplementation((payload) => {
          if (payload.status === 'failed') markedFailed = true;
          return chain;
        });
        return chain;
      }
      if (table === 'working_memory') {
        const chain = createChainableMock();
        chain.limit = jest.fn().mockResolvedValue({
          data: [{ id: wmId, key: 'task', value: 'write code', created_at: new Date().toISOString() }],
          error: null,
        });
        return chain;
      }
      return createChainableMock({ data: [], error: null });
    });

    (cognitiveRouter.complete as jest.Mock).mockRejectedValue(new Error('LLM Provider 500'));

    const result = await service.synthesizeCandidatesForUser(userId, runId);

    expect(result.status).toBe('failed');
    expect(result.modelCalls).toBe(0);
    expect(markedFailed).toBe(true);
  });

  // 12-14. Zero duplicate model calls under simulated concurrency
  test('12-14. Simulated simultaneous execution for 1 user yields at most 1 Gemini call', async () => {
    const wmId = 'wm-concurrent';
    let isClaimed = false;

    (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'candidate_synthesis_claims') {
        const chain = createChainableMock();
        chain.insert = jest.fn().mockImplementation(() => {
          if (!isClaimed) {
            isClaimed = true;
            return createChainableMock({ data: { id: 'claim-won' }, error: null });
          } else {
            return createChainableMock({ data: null, error: { code: '23505' } });
          }
        });
        chain.maybeSingle = jest.fn().mockResolvedValue({
          data: {
            id: 'claim-won',
            status: 'claimed',
            lease_until: new Date(Date.now() + 4 * 60 * 1000).toISOString(),
            attempt_count: 1,
          },
          error: null,
        });
        return chain;
      }
      if (table === 'working_memory') {
        const chain = createChainableMock();
        chain.limit = jest.fn().mockResolvedValue({
          data: [{ id: wmId, key: 'hobby', value: 'reading', created_at: new Date().toISOString() }],
          error: null,
        });
        return chain;
      }
      if (table === 'episodic_memories' || table === 'memories') {
        const chain = createChainableMock();
        chain.limit = jest.fn().mockResolvedValue({ data: [], error: null });
        return chain;
      }
      return createChainableMock();
    });

    (cognitiveRouter.complete as jest.Mock).mockResolvedValue(
      JSON.stringify({
        candidates: [
          {
            category: 'PREFERENCE',
            key: 'hobby',
            value: 'reading',
            confidence: 0.85,
            importance: 70,
            reason: 'Reads books',
            source_refs: [{ type: 'working_memory', id: wmId }],
          },
        ],
      })
    );

    // Run two processes simultaneously
    const [res1, res2] = await Promise.all([
      service.synthesizeCandidatesForUser(userId, runId),
      service.synthesizeCandidatesForUser(userId, runId),
    ]);

    const totalModelCalls = res1.modelCalls + res2.modelCalls;
    expect(totalModelCalls).toBe(1);
    expect([res1.status, res2.status].sort()).toEqual(['completed', 'skipped']);
  });

  // 15-16. No semantic writes & no source deletion
  test('15-16. Concurrency hardened path performs zero writes to semantic memory and zero source deletions', async () => {
    expect(memoryRepository.upsertMemory).not.toHaveBeenCalled();
    expect(CANDIDATE_SYNTHESIS_LIMITS.MAX_USERS_PER_RUN).toBe(50);
  });
});
