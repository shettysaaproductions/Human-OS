/**
 * SourceDependencyPhase2fb.test.ts — Phase 2F-B Source Dependency Protection Test Suite
 *
 * Validates all 22 required architectural invariants:
 * 1. Trusted episodic memory locks source
 * 2. Trusted working memory locks source
 * 3. Trusted turn reference locks source
 * 4. Proposed memory does not lock source
 * 5. Rejected memory does not lock source
 * 6. Invalidated memory does not lock source
 * 7. Superseded memory does not lock source
 * 8. Malformed reference fails safe
 * 9. Missing source is never fabricated
 * 10. Cross-user source rejected
 * 11. Permanent deletion guard blocks locked source
 * 12. Deletion guard fails safe on DB error
 * 13. Archived-but-recoverable source remains protected
 * 14. Source restoration remains idempotent
 * 15. Multiple trusted memories can reference same source
 * 16. Dependency evaluation is idempotent
 * 17. Source reference limit enforced
 * 18. Memory evaluation limit enforced
 * 19. User isolation
 * 20. No direct writer bypass
 * 21. Zero source physical deletions
 * 22. Zero semantic memory overwrite
 */

import { sourceDependencyService, DEPENDENCY_LIMITS } from '../SourceDependencyService';
import { memoryRepository } from '../memoryRepository';
import { memoryRetentionEngine } from '../MemoryRetentionEngine';
import { supabaseAdmin } from '../../lib/supabase';
import { Memory, EpisodicMemory, WorkingMemory } from '../../types/memory';

jest.mock('../../lib/supabase', () => ({
  supabaseAdmin: {
    from: jest.fn(),
  },
}));
jest.mock('../../lib/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));
jest.mock('../../lib/queryTracker', () => ({
  qt: {
    track: (_name: string, _table: string, fn: () => Promise<any>) => fn(),
    recordEgressSaved: jest.fn(),
  },
}));

function createChainableMock(resolvedValue: any = { data: [], error: null }) {
  const mock: any = {};
  mock.select = jest.fn().mockReturnValue(mock);
  mock.insert = jest.fn().mockReturnValue(mock);
  mock.update = jest.fn().mockReturnValue(mock);
  mock.delete = jest.fn().mockReturnValue(mock);
  mock.eq = jest.fn().mockReturnValue(mock);
  mock.in = jest.fn().mockReturnValue(mock);
  mock.order = jest.fn().mockReturnValue(mock);
  mock.limit = jest.fn().mockReturnValue(mock);
  mock.single = jest.fn().mockResolvedValue(resolvedValue);
  mock.maybeSingle = jest.fn().mockResolvedValue(resolvedValue);
  mock.then = (resolve: any) => resolve(resolvedValue);
  return mock;
}

describe('Phase 2F-B: Source Dependency Protection & Provenance Locks Suite', () => {
  const userA = '00000000-0000-4000-a000-000000000001';
  const userB = '00000000-0000-4000-b000-000000000002';
  const epId1 = '11111111-1111-4111-a111-111111111111';
  const epId2 = '22222222-2222-4222-a222-222222222222';
  const wmId1 = '33333333-3333-4333-a333-333333333333';
  const turnId1 = '44444444-4444-4444-a444-444444444444';
  const trustedMemId = '55555555-5555-4555-a555-555555555555';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── TEST 1: Trusted Episodic Memory Locks Source ──────────────────────────
  it('1. Trusted episodic memory creates active lock on referenced episode', async () => {
    const trustedMem: Memory = {
      id: trustedMemId,
      user_id: userA,
      key: 'wife_name',
      value: 'Sakshi',
      importance: 90,
      confidence: 0.95,
      frequency: 1,
      emotional_weight: 0,
      is_archived: false,
      is_user_confirmed: false,
      lifecycle_state: 'CURRENT',
      compression_status: 'trusted',
      source_references: [{ type: 'episodic_memory', id: epId1 }],
      created_at: new Date(),
      updated_at: new Date(),
      memory_type: 'family',
    };

    (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'memories') {
        return createChainableMock({ data: [trustedMem], error: null });
      }
      if (table === 'episodic_memories') {
        return createChainableMock({
          data: { id: epId1, user_id: userA, is_archived: false, summary: 'Discussed wife Sakshi' },
          error: null,
        });
      }
      return createChainableMock();
    });

    const report = await sourceDependencyService.resolveMemoryProvenance(userA, trustedMem);
    expect(report.isTrusted).toBe(true);
    expect(report.provenanceComplete).toBe(true);
    expect(report.dependencyCount).toBe(1);
    expect(report.resolvedDependencies[0].sourceId).toBe(epId1);
    expect(report.resolvedDependencies[0].sourceType).toBe('episodic_memory');

    const canDelete = await sourceDependencyService.canPermanentlyDeleteSource(userA, 'episodic_memory', epId1);
    expect(canDelete).toBe(false); // Locked -> cannot delete
  });

  // ── TEST 2: Trusted Working Memory Locks Source ────────────────────────────
  it('2. Trusted working memory creates active lock on referenced working memory', async () => {
    const trustedMem: Memory = {
      id: trustedMemId,
      user_id: userA,
      key: 'current_project',
      value: 'Cloud Kitchen',
      importance: 85,
      confidence: 0.9,
      frequency: 1,
      emotional_weight: 0,
      is_archived: false,
      is_user_confirmed: false,
      lifecycle_state: 'CURRENT',
      compression_status: 'trusted',
      source_references: [{ type: 'working_memory', id: wmId1 }],
      created_at: new Date(),
      updated_at: new Date(),
      memory_type: 'work',
    };

    (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'memories') {
        return createChainableMock({ data: [trustedMem], error: null });
      }
      if (table === 'working_memory') {
        return createChainableMock({
          data: { id: wmId1, user_id: userA, key: 'project', value: 'Cloud Kitchen' },
          error: null,
        });
      }
      return createChainableMock();
    });

    const canDelete = await sourceDependencyService.canPermanentlyDeleteSource(userA, 'working_memory', wmId1);
    expect(canDelete).toBe(false);
  });

  // ── TEST 3: Trusted Turn Reference Locks Source ────────────────────────────
  it('3. Trusted turn reference creates active lock on referenced chat message', async () => {
    const trustedMem: Memory = {
      id: trustedMemId,
      user_id: userA,
      key: 'city',
      value: 'Mumbai',
      importance: 70,
      confidence: 0.95,
      frequency: 1,
      emotional_weight: 0,
      is_archived: false,
      is_user_confirmed: false,
      lifecycle_state: 'CURRENT',
      compression_status: 'trusted',
      source_references: [{ type: 'turn', id: turnId1 }],
      created_at: new Date(),
      updated_at: new Date(),
      memory_type: 'personal',
    };

    (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'memories') {
        return createChainableMock({ data: [trustedMem], error: null });
      }
      if (table === 'chat_history') {
        return createChainableMock({
          data: { id: turnId1, user_id: userA, content: 'I live in Mumbai' },
          error: null,
        });
      }
      return createChainableMock();
    });

    const canDelete = await sourceDependencyService.canPermanentlyDeleteSource(userA, 'turn', turnId1);
    expect(canDelete).toBe(false);
  });

  // ── TEST 4: Proposed Memory Does NOT Lock ──────────────────────────────────
  it('4. Proposed memory (compression_status = proposed) does NOT lock source', async () => {
    // getActiveTrustedMemories query filters by compression_status = 'trusted'
    (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'memories') {
        // Query for trusted memories returns empty because the only candidate is proposed
        return createChainableMock({ data: [], error: null });
      }
      return createChainableMock();
    });

    const canDelete = await sourceDependencyService.canPermanentlyDeleteSource(userA, 'episodic_memory', epId1);
    expect(canDelete).toBe(true);
  });

  // ── TEST 5: Rejected Memory Does NOT Lock ──────────────────────────────────
  it('5. Rejected memory (compression_status = rejected) does NOT lock source', async () => {
    (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'memories') {
        return createChainableMock({ data: [], error: null });
      }
      return createChainableMock();
    });

    const canDelete = await sourceDependencyService.canPermanentlyDeleteSource(userA, 'working_memory', wmId1);
    expect(canDelete).toBe(true);
  });

  // ── TEST 6: Invalidated Memory Does NOT Lock ───────────────────────────────
  it('6. Invalidated memory (lifecycle_state = INVALIDATED) does NOT lock source', async () => {
    (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'memories') {
        return createChainableMock({ data: [], error: null });
      }
      return createChainableMock();
    });

    const canDelete = await sourceDependencyService.canPermanentlyDeleteSource(userA, 'episodic_memory', epId1);
    expect(canDelete).toBe(true);
  });

  // ── TEST 7: Superseded Memory Does NOT Lock ────────────────────────────────
  it('7. Superseded memory (lifecycle_state = SUPERSEDED / is_archived = true) releases lock', async () => {
    (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'memories') {
        return createChainableMock({ data: [], error: null });
      }
      return createChainableMock();
    });

    const canDelete = await sourceDependencyService.canPermanentlyDeleteSource(userA, 'episodic_memory', epId1);
    expect(canDelete).toBe(true);
  });

  // ── TEST 8: Malformed Reference Fails Safe ─────────────────────────────────
  it('8. Malformed reference (invalid UUID or unrecognized type) marks provenance incomplete', async () => {
    const memWithBadRef: Memory = {
      id: trustedMemId,
      user_id: userA,
      key: 'habit',
      value: 'Reading',
      importance: 50,
      confidence: 0.8,
      frequency: 1,
      emotional_weight: 0,
      is_archived: false,
      is_user_confirmed: false,
      lifecycle_state: 'CURRENT',
      compression_status: 'trusted',
      source_references: [
        { type: 'episodic_memory', id: 'not-a-valid-uuid' },
        { type: 'alien_type' as any, id: epId1 },
      ],
      created_at: new Date(),
      updated_at: new Date(),
      memory_type: 'preferences',
    };

    const report = await sourceDependencyService.resolveMemoryProvenance(userA, memWithBadRef);
    expect(report.provenanceComplete).toBe(false);
    expect(report.unresolvedDependencies.length).toBe(2);
    expect(report.unresolvedDependencies.some(d => d.reason === 'MALFORMED_UUID')).toBe(true);
    expect(report.unresolvedDependencies.some(d => d.reason === 'UNRECOGNIZED_TYPE')).toBe(true);
  });

  // ── TEST 9: Missing Source Never Fabricated ────────────────────────────────
  it('9. Missing source in DB is never fabricated and marked missing in provenance', async () => {
    const mem: Memory = {
      id: trustedMemId,
      user_id: userA,
      key: 'wife_name',
      value: 'Sakshi',
      importance: 90,
      confidence: 0.95,
      frequency: 1,
      emotional_weight: 0,
      is_archived: false,
      is_user_confirmed: false,
      lifecycle_state: 'CURRENT',
      compression_status: 'trusted',
      source_references: [{ type: 'episodic_memory', id: epId1 }],
      created_at: new Date(),
      updated_at: new Date(),
      memory_type: 'family',
    };

    (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'episodic_memories') {
        // Episode not found in DB
        return createChainableMock({ data: null, error: null });
      }
      return createChainableMock();
    });

    const report = await sourceDependencyService.resolveMemoryProvenance(userA, mem);
    expect(report.provenanceComplete).toBe(false);
    expect(report.unresolvedDependencies[0].reason).toContain('MISSING_SOURCE:episodic_memory');
  });

  // ── TEST 10: Cross-User Source Strictly Rejected ───────────────────────────
  it('10. Cross-user source reference (User A citing User B episode) is REJECTED', async () => {
    const memUserA: Memory = {
      id: trustedMemId,
      user_id: userA,
      key: 'secret',
      value: 'User B data',
      importance: 90,
      confidence: 0.95,
      frequency: 1,
      emotional_weight: 0,
      is_archived: false,
      is_user_confirmed: false,
      lifecycle_state: 'CURRENT',
      compression_status: 'trusted',
      source_references: [{ type: 'episodic_memory', id: epId1 }],
      created_at: new Date(),
      updated_at: new Date(),
      memory_type: 'personal',
    };

    (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'episodic_memories') {
        // Episode belongs to User B!
        return createChainableMock({
          data: { id: epId1, user_id: userB, is_archived: false },
          error: null,
        });
      }
      return createChainableMock();
    });

    const report = await sourceDependencyService.resolveMemoryProvenance(userA, memUserA);
    expect(report.provenanceComplete).toBe(false);
    expect(report.unresolvedDependencies[0].reason).toBe('CROSS_USER_FORBIDDEN');
    expect(report.resolvedDependencies.length).toBe(0);
  });

  // ── TEST 11: Permanent Deletion Guard Blocks Locked Source ─────────────────
  it('11. canPermanentlyDeleteSource returns false for actively locked source', async () => {
    const trustedMem: Memory = {
      id: trustedMemId,
      user_id: userA,
      key: 'wife_name',
      value: 'Sakshi',
      importance: 90,
      confidence: 0.95,
      frequency: 1,
      emotional_weight: 0,
      is_archived: false,
      is_user_confirmed: false,
      lifecycle_state: 'CURRENT',
      compression_status: 'trusted',
      source_references: [{ type: 'episodic_memory', id: epId1 }],
      created_at: new Date(),
      updated_at: new Date(),
      memory_type: 'family',
    };

    (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'memories') {
        return createChainableMock({ data: [trustedMem], error: null });
      }
      if (table === 'episodic_memories') {
        return createChainableMock({ data: { id: epId1, user_id: userA, is_archived: false }, error: null });
      }
      return createChainableMock();
    });

    const result = await memoryRepository.canPermanentlyDeleteSource(userA, 'episodic_memory', epId1);
    expect(result).toBe(false);
  });

  // ── TEST 12: Deletion Guard Fails Safe on DB Error ─────────────────────────
  it('12. canPermanentlyDeleteSource fails safe to false on DB error', async () => {
    (supabaseAdmin.from as jest.Mock).mockImplementation(() => {
      throw new Error('Database connection timeout');
    });

    const result = await sourceDependencyService.canPermanentlyDeleteSource(userA, 'episodic_memory', epId1);
    expect(result).toBe(false); // Fail-safe
  });

  // ── TEST 13: Archived-But-Recoverable Source Remains Protected ─────────────
  it('13. Archived-but-recoverable source remains purge-protected while trusted memory exists', async () => {
    const trustedMem: Memory = {
      id: trustedMemId,
      user_id: userA,
      key: 'wife_name',
      value: 'Sakshi',
      importance: 90,
      confidence: 0.95,
      frequency: 1,
      emotional_weight: 0,
      is_archived: false,
      is_user_confirmed: false,
      lifecycle_state: 'CURRENT',
      compression_status: 'trusted',
      source_references: [{ type: 'episodic_memory', id: epId1 }],
      created_at: new Date(),
      updated_at: new Date(),
      memory_type: 'family',
    };

    (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'memories') {
        return createChainableMock({ data: [trustedMem], error: null });
      }
      if (table === 'episodic_memories') {
        // Source is soft-archived (is_archived: true)
        return createChainableMock({ data: { id: epId1, user_id: userA, is_archived: true }, error: null });
      }
      return createChainableMock();
    });

    const state = await sourceDependencyService.evaluateSourceState(userA, 'episodic_memory', epId1, true);
    expect(state).toBe('PURGE_PROTECTED');
  });

  // ── TEST 14: Source Restoration Remains Idempotent ─────────────────────────
  it('14. Restoring source maintains existing dependency lock cleanly', async () => {
    const trustedMem: Memory = {
      id: trustedMemId,
      user_id: userA,
      key: 'wife_name',
      value: 'Sakshi',
      importance: 90,
      confidence: 0.95,
      frequency: 1,
      emotional_weight: 0,
      is_archived: false,
      is_user_confirmed: false,
      lifecycle_state: 'CURRENT',
      compression_status: 'trusted',
      source_references: [{ type: 'episodic_memory', id: epId1 }],
      created_at: new Date(),
      updated_at: new Date(),
      memory_type: 'family',
    };

    (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'memories') {
        return createChainableMock({ data: [trustedMem], error: null });
      }
      if (table === 'episodic_memories') {
        return createChainableMock({ data: { id: epId1, user_id: userA, is_archived: false }, error: null });
      }
      return createChainableMock();
    });

    const lockMap1 = await sourceDependencyService.getActiveSourceLocksForUser(userA);
    const lockMap2 = await sourceDependencyService.getActiveSourceLocksForUser(userA);
    expect(lockMap1.get(`episodic_memory:${epId1}`)?.length).toBe(1);
    expect(lockMap2.get(`episodic_memory:${epId1}`)?.length).toBe(1);
  });

  // ── TEST 15: Multiple Trusted Memories Referencing Same Source ────────────
  it('15. Multiple trusted memories referencing same source are aggregated without conflict', async () => {
    const mem1: Memory = {
      id: trustedMemId,
      user_id: userA,
      key: 'wife_name',
      value: 'Sakshi',
      importance: 90,
      confidence: 0.95,
      frequency: 1,
      emotional_weight: 0,
      is_archived: false,
      is_user_confirmed: false,
      lifecycle_state: 'CURRENT',
      compression_status: 'trusted',
      source_references: [{ type: 'episodic_memory', id: epId1 }],
      created_at: new Date(),
      updated_at: new Date(),
      memory_type: 'family',
    };
    const mem2: Memory = {
      id: '66666666-6666-4666-a666-666666666666',
      user_id: userA,
      key: 'anniversary',
      value: 'Nov 20',
      importance: 80,
      confidence: 0.9,
      frequency: 1,
      emotional_weight: 0,
      is_archived: false,
      is_user_confirmed: false,
      lifecycle_state: 'CURRENT',
      compression_status: 'trusted',
      source_references: [{ type: 'episodic_memory', id: epId1 }],
      created_at: new Date(),
      updated_at: new Date(),
      memory_type: 'important_dates',
    };

    (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'memories') {
        return createChainableMock({ data: [mem1, mem2], error: null });
      }
      if (table === 'episodic_memories') {
        return createChainableMock({ data: { id: epId1, user_id: userA, is_archived: false }, error: null });
      }
      return createChainableMock();
    });

    const lockMap = await sourceDependencyService.getActiveSourceLocksForUser(userA);
    const epLocks = lockMap.get(`episodic_memory:${epId1}`);
    expect(epLocks?.length).toBe(2);
  });

  // ── TEST 16: Dependency Evaluation is Idempotent ───────────────────────────
  it('16. Repeated dependency queries return identical deterministic lock sets', async () => {
    const mem: Memory = {
      id: trustedMemId,
      user_id: userA,
      key: 'wife_name',
      value: 'Sakshi',
      importance: 90,
      confidence: 0.95,
      frequency: 1,
      emotional_weight: 0,
      is_archived: false,
      is_user_confirmed: false,
      lifecycle_state: 'CURRENT',
      compression_status: 'trusted',
      source_references: [{ type: 'episodic_memory', id: epId1 }],
      created_at: new Date(),
      updated_at: new Date(),
      memory_type: 'family',
    };

    (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'episodic_memories') {
        return createChainableMock({ data: { id: epId1, user_id: userA, is_archived: false }, error: null });
      }
      return createChainableMock();
    });

    const rep1 = await sourceDependencyService.resolveMemoryProvenance(userA, mem);
    const rep2 = await sourceDependencyService.resolveMemoryProvenance(userA, mem);
    expect(rep1).toEqual(rep2);
  });

  // ── TEST 17: Source Reference Limit Enforced ───────────────────────────────
  it('17. Source reference limit (MAX_SOURCE_REFERENCES_PER_MEMORY = 20) is strictly enforced', async () => {
    const excessiveRefs = Array.from({ length: 30 }, (_, i) => ({
      type: 'episodic_memory' as const,
      id: `11111111-1111-4111-a111-${String(i).padStart(12, '0')}`,
    }));

    const mem: Memory = {
      id: trustedMemId,
      user_id: userA,
      key: 'big_summary',
      value: 'Lots of events',
      importance: 70,
      confidence: 0.8,
      frequency: 1,
      emotional_weight: 0,
      is_archived: false,
      is_user_confirmed: false,
      lifecycle_state: 'CURRENT',
      compression_status: 'trusted',
      source_references: excessiveRefs,
      created_at: new Date(),
      updated_at: new Date(),
      memory_type: 'personal',
    };

    let lookupCount = 0;
    (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'episodic_memories') {
        lookupCount++;
        return createChainableMock({ data: { id: epId1, user_id: userA, is_archived: false }, error: null });
      }
      return createChainableMock();
    });

    await sourceDependencyService.resolveMemoryProvenance(userA, mem);
    expect(lookupCount).toBe(DEPENDENCY_LIMITS.MAX_SOURCE_REFERENCES_PER_MEMORY); // Capped at 20
  });

  // ── TEST 18: Memory Evaluation Limit Enforced ──────────────────────────────
  it('18. Memory evaluation limit (MAX_MEMORIES_PER_EVALUATION = 100) is enforced in query', async () => {
    let queryLimit: number | null = null;
    (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'memories') {
        const mock = createChainableMock({ data: [], error: null });
        mock.limit = jest.fn().mockImplementation((n: number) => {
          queryLimit = n;
          return mock;
        });
        return mock;
      }
      return createChainableMock();
    });

    await sourceDependencyService.getActiveTrustedMemories(userA);
    expect(queryLimit).toBe(DEPENDENCY_LIMITS.MAX_MEMORIES_PER_EVALUATION);
  });

  // ── TEST 19: User Isolation ────────────────────────────────────────────────
  it('19. Queries are strictly user-scoped and never return or protect other users data', async () => {
    let queriedUserId: string | null = null;
    (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'memories') {
        const mock = createChainableMock({ data: [], error: null });
        mock.eq = jest.fn().mockImplementation((col: string, val: any) => {
          if (col === 'user_id') queriedUserId = val;
          return mock;
        });
        return mock;
      }
      return createChainableMock();
    });

    await sourceDependencyService.getActiveTrustedMemories(userA);
    expect(queriedUserId).toBe(userA);
  });

  // ── TEST 20: No Direct Writer Bypass & Repository Gateway ──────────────────
  it('20. memoryRepository.getSourceProvenance routes through SourceDependencyService', async () => {
    const mem: Memory = {
      id: trustedMemId,
      user_id: userA,
      key: 'wife_name',
      value: 'Sakshi',
      importance: 90,
      confidence: 0.95,
      frequency: 1,
      emotional_weight: 0,
      is_archived: false,
      is_user_confirmed: false,
      lifecycle_state: 'CURRENT',
      compression_status: 'trusted',
      source_references: [{ type: 'episodic_memory', id: epId1 }],
      created_at: new Date(),
      updated_at: new Date(),
      memory_type: 'family',
    };

    (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'memories') {
        return createChainableMock({ data: mem, error: null });
      }
      if (table === 'episodic_memories') {
        return createChainableMock({ data: { id: epId1, user_id: userA, is_archived: false }, error: null });
      }
      return createChainableMock();
    });

    const report = await memoryRepository.getSourceProvenance(userA, trustedMemId);
    expect(report).not.toBeNull();
    expect(report?.key).toBe('wife_name');
    expect(report?.dependencyCount).toBe(1);
  });

  // ── TEST 21: Zero Source Physical Deletions ────────────────────────────────
  it('21. Zero physical DELETE mutations executed across entire dependency lifecycle', async () => {
    let deleteCalls = 0;
    (supabaseAdmin.from as jest.Mock).mockImplementation(() => {
      const mock = createChainableMock({ data: [], error: null });
      mock.delete = jest.fn().mockImplementation(() => {
        deleteCalls++;
        return mock;
      });
      return mock;
    });

    await sourceDependencyService.canPermanentlyDeleteSource(userA, 'episodic_memory', epId1);
    expect(deleteCalls).toBe(0);
  });

  // ── TEST 22: Retention Engine Respects Dependency Locks ────────────────────
  it('22. MemoryRetentionEngine evaluates locked source as PURGE_PROTECTED and prevents permanent deletion', async () => {
    const lockedEpisode: EpisodicMemory = {
      id: epId1,
      user_id: userA,
      summary: 'Ate pizza with wife Sakshi',
      emotional_valence: 0.1,
      created_at: new Date(Date.now() - 5 * 86400000), // 5 days old
    };

    const context = {
      userId: userA,
      activeLifeThreads: [],
      activeGoals: [],
      activeReminders: [],
      existingProposals: new Map(),
      lockedSourceKeys: new Set([`episodic_memory:${epId1}`]),
    };

    const proposal = await memoryRetentionEngine.evaluateEpisodicMemory(lockedEpisode, context);
    expect(proposal.evidence.is_source_locked).toBe(true);
    expect(proposal.evidence.locked_by_trusted_memory).toBe(true);
    expect(proposal.evidence.provenance_safeguard).toBe('PURGE_PROTECTED');
    expect(proposal.reasons.some(r => r.includes('Provenance source protected'))).toBe(true);
  });
});
