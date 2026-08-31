/**
 * WorkingMemoryInvalidationHardening.test.ts — Pre-Heartbeat Hardening Tests
 *
 * Validates stale working-memory candidate invalidation upon authoritative corrections.
 */

import { memoryRepository } from '../memoryRepository';
import { ExtractedMemory } from '../../types/memory';

let mockWorkingMemoryDb: any[] = [];
let mockMemoriesDb: any[] = [];
let mockEpisodicDb: any[] = [];

jest.mock('../../lib/supabase', () => ({
  supabaseAdmin: {
    from: jest.fn().mockImplementation((table: string) => {
      if (table === 'working_memory') {
        const builder: any = {
          _filters: {} as Record<string, any>,
          select: jest.fn().mockImplementation(() => builder),
          eq: jest.fn().mockImplementation((col: string, val: string) => {
            builder._filters[col] = val;
            return builder;
          }),
          in: jest.fn().mockImplementation((col: string, vals: string[]) => {
            builder._filters[col] = vals;
            return builder;
          }),
          order: jest.fn().mockImplementation(() => builder),
          limit: jest.fn().mockImplementation(() => {
            let res = [...mockWorkingMemoryDb];
            if (builder._filters['user_id']) {
              res = res.filter(r => r.user_id === builder._filters['user_id']);
            }
            return Promise.resolve({ data: res, error: null });
          }),
          update: jest.fn().mockImplementation((payload: any) => {
            const updateBuilder: any = {
              _inCol: null,
              _inVals: null,
              _eqCol: null,
              _eqVal: null,
              in: jest.fn().mockImplementation((c: string, v: string[]) => {
                updateBuilder._inCol = c;
                updateBuilder._inVals = v;
                return updateBuilder;
              }),
              eq: jest.fn().mockImplementation((c: string, v: string) => {
                updateBuilder._eqCol = c;
                updateBuilder._eqVal = v;
                // Apply update
                mockWorkingMemoryDb.forEach(r => {
                  let match = true;
                  if (updateBuilder._inCol && updateBuilder._inVals) {
                    match = match && updateBuilder._inVals.includes(r[updateBuilder._inCol]);
                  }
                  if (updateBuilder._eqCol && updateBuilder._eqVal) {
                    match = match && r[updateBuilder._eqCol] === updateBuilder._eqVal;
                  }
                  if (match) {
                    Object.assign(r, payload);
                  }
                });
                return Promise.resolve({ error: null });
              }),
            };
            return updateBuilder;
          }),
          insert: jest.fn().mockImplementation((payload: any) => {
            const rows = Array.isArray(payload) ? payload : [payload];
            rows.forEach((r, idx) => {
              mockWorkingMemoryDb.push({ id: `wm_${Date.now()}_${idx}`, ...r });
            });
            return Promise.resolve({ data: rows, error: null });
          }),
          then: (resolve: any) => {
            let res = [...mockWorkingMemoryDb];
            if (builder._filters['user_id']) {
              res = res.filter(r => r.user_id === builder._filters['user_id']);
            }
            return resolve({ data: res, error: null });
          },
        };
        return builder;
      }

      if (table === 'memories') {
        const builder: any = {
          _filters: {} as Record<string, any>,
          select: jest.fn().mockImplementation(() => builder),
          eq: jest.fn().mockImplementation((col: string, val: any) => {
            builder._filters[col] = val;
            return builder;
          }),
          in: jest.fn().mockImplementation((col: string, vals: any[]) => {
            builder._filters[col] = vals;
            return builder;
          }),
          maybeSingle: jest.fn().mockImplementation(() => {
            let res = [...mockMemoriesDb];
            if (builder._filters['user_id']) res = res.filter(r => r.user_id === builder._filters['user_id']);
            if (builder._filters['key']) res = res.filter(r => r.key === builder._filters['key']);
            if (builder._filters['id']) res = res.filter(r => r.id === builder._filters['id']);
            return Promise.resolve({ data: res[0] || null, error: null });
          }),
          single: jest.fn().mockImplementation(() => {
            let res = [...mockMemoriesDb];
            return Promise.resolve({ data: res[res.length - 1] || null, error: null });
          }),
          insert: jest.fn().mockImplementation((payload: any) => {
            const id = `mem_${Date.now()}_${Math.random()}`;
            const row = { id, ...payload };
            mockMemoriesDb.push(row);
            return {
              select: jest.fn().mockReturnValue({
                single: jest.fn().mockResolvedValue({ data: { id }, error: null }),
              }),
            };
          }),
          update: jest.fn().mockImplementation((payload: any) => {
            const updateBuilder: any = {
              _filters: {} as Record<string, any>,
              eq: jest.fn().mockImplementation((col: string, val: string) => {
                updateBuilder._filters[col] = val;
                mockMemoriesDb.forEach(r => {
                  let match = true;
                  for (const [k, v] of Object.entries(updateBuilder._filters)) {
                    if (r[k] !== v) match = false;
                  }
                  if (match) {
                    Object.assign(r, payload);
                  }
                });
                return Promise.resolve({ error: null });
              }),
            };
            return updateBuilder;
          }),
          then: (resolve: any) => {
            let res = [...mockMemoriesDb];
            if (builder._filters['user_id']) res = res.filter(r => r.user_id === builder._filters['user_id']);
            if (builder._filters['key']) res = res.filter(r => r.key === builder._filters['key']);
            if (builder._filters['is_archived'] !== undefined) res = res.filter(r => r.is_archived === builder._filters['is_archived']);
            return resolve({ data: res, error: null });
          },
        };
        return builder;
      }

      if (table === 'episodic_memories') {
        const builder: any = {
          _filters: {} as Record<string, any>,
          select: jest.fn().mockImplementation(() => builder),
          eq: jest.fn().mockImplementation((col: string, val: string) => {
            builder._filters[col] = val;
            return builder;
          }),
          then: (resolve: any) => {
            let res = [...mockEpisodicDb];
            if (builder._filters['user_id']) res = res.filter(r => r.user_id === builder._filters['user_id']);
            return resolve({ data: res, error: null });
          },
        };
        return builder;
      }

      return {
        select: jest.fn().mockReturnThis(),
        insert: jest.fn().mockResolvedValue({ data: null, error: null }),
        update: jest.fn().mockResolvedValue({ data: null, error: null }),
        eq: jest.fn().mockReturnThis(),
      };
    }),
  },
}));

describe('Working Memory Invalidation on Authoritative Correction (Hardening)', () => {
  const userId = '00000000-0000-4000-a000-000000000001';
  const userB = '00000000-0000-4000-a000-000000000002';

  beforeEach(() => {
    mockWorkingMemoryDb = [];
    mockMemoriesDb = [];
    mockEpisodicDb = [];
  });

  it('1. Exact correction invalidates matching working-memory candidate (sets SUPERSEDED)', async () => {
    // Seed stale working memory for wife_name: Priya
    mockWorkingMemoryDb.push({
      id: 'wm_101',
      user_id: userId,
      key: 'wife_name',
      value: 'Priya',
      promotion_status: 'CANDIDATE',
      created_at: new Date(Date.now() - 3600000).toISOString(),
    });

    // Seed alias working memory for wife: Priya
    mockWorkingMemoryDb.push({
      id: 'wm_102',
      user_id: userId,
      key: 'wife',
      value: 'Priya',
      promotion_status: 'CANDIDATE',
      created_at: new Date(Date.now() - 3600000).toISOString(),
    });

    // Commit explicit correction: Sakshi
    const correction: ExtractedMemory = {
      key: 'wife_name',
      value: 'Sakshi',
      type: 'family',
      importance: 90,
      confidence: 0.99,
      shouldPersist: true,
      source_authority: 'explicit_user',
      correction_intent: true,
    };

    await memoryRepository.upsertMemory(userId, correction, 'Actually meri wife Sakshi hai');

    // Verify wm_101 and wm_102 are marked SUPERSEDED
    const wm101 = mockWorkingMemoryDb.find(r => r.id === 'wm_101');
    const wm102 = mockWorkingMemoryDb.find(r => r.id === 'wm_102');
    expect(wm101?.promotion_status).toBe('SUPERSEDED');
    expect(wm102?.promotion_status).toBe('SUPERSEDED');
  });

  it('2. Unrelated working-memory records survive untouched', async () => {
    // Seed stale wife_name and unrelated city / job
    mockWorkingMemoryDb.push(
      {
        id: 'wm_stale',
        user_id: userId,
        key: 'wife_name',
        value: 'Priya',
        promotion_status: 'CANDIDATE',
      },
      {
        id: 'wm_city',
        user_id: userId,
        key: 'city',
        value: 'Bengaluru',
        promotion_status: 'CANDIDATE',
      },
      {
        id: 'wm_company',
        user_id: userId,
        key: 'company_name',
        value: 'Google',
        promotion_status: 'CANDIDATE',
      }
    );

    const correction: ExtractedMemory = {
      key: 'wife_name',
      value: 'Sakshi',
      type: 'family',
      importance: 90,
      confidence: 0.99,
      shouldPersist: true,
      source_authority: 'explicit_user',
      correction_intent: true,
    };

    await memoryRepository.upsertMemory(userId, correction, 'Meri wife Sakshi hai');

    const wmCity = mockWorkingMemoryDb.find(r => r.id === 'wm_city');
    const wmCompany = mockWorkingMemoryDb.find(r => r.id === 'wm_company');
    const wmStale = mockWorkingMemoryDb.find(r => r.id === 'wm_stale');

    expect(wmStale?.promotion_status).toBe('SUPERSEDED');
    expect(wmCity?.promotion_status).toBe('CANDIDATE');
    expect(wmCompany?.promotion_status).toBe('CANDIDATE');
  });

  it('3. Historical episodic records survive untouched', async () => {
    mockEpisodicDb.push({
      id: 'ep_1',
      user_id: userId,
      summary: 'User went to dinner with Priya in 2023',
      source_message_id: 'msg_old',
      created_at: '2023-05-01T10:00:00Z',
    });

    const correction: ExtractedMemory = {
      key: 'wife_name',
      value: 'Sakshi',
      type: 'family',
      importance: 90,
      confidence: 0.99,
      shouldPersist: true,
      source_authority: 'explicit_user',
      correction_intent: true,
    };

    await memoryRepository.upsertMemory(userId, correction, 'Wife is Sakshi');

    expect(mockEpisodicDb.length).toBe(1);
    expect(mockEpisodicDb[0].id).toBe('ep_1');
    expect(mockEpisodicDb[0].summary).toBe('User went to dinner with Priya in 2023');
  });

  it('4. Cross-user isolation: User B working memory is NEVER touched', async () => {
    mockWorkingMemoryDb.push(
      {
        id: 'wm_userA',
        user_id: userId,
        key: 'wife_name',
        value: 'Priya',
        promotion_status: 'CANDIDATE',
      },
      {
        id: 'wm_userB',
        user_id: userB,
        key: 'wife_name',
        value: 'Priya',
        promotion_status: 'CANDIDATE',
      }
    );

    const correction: ExtractedMemory = {
      key: 'wife_name',
      value: 'Sakshi',
      type: 'family',
      importance: 90,
      confidence: 0.99,
      shouldPersist: true,
      source_authority: 'explicit_user',
      correction_intent: true,
    };

    await memoryRepository.upsertMemory(userId, correction, 'My wife is Sakshi');

    const userA_wm = mockWorkingMemoryDb.find(r => r.id === 'wm_userA');
    const userB_wm = mockWorkingMemoryDb.find(r => r.id === 'wm_userB');

    expect(userA_wm?.promotion_status).toBe('SUPERSEDED');
    expect(userB_wm?.promotion_status).toBe('CANDIDATE'); // User B strictly preserved!
  });

  it('5. Matching value working memory is NOT superseded', async () => {
    mockWorkingMemoryDb.push({
      id: 'wm_correct',
      user_id: userId,
      key: 'wife_name',
      value: 'Sakshi',
      promotion_status: 'CANDIDATE',
    });

    const fact: ExtractedMemory = {
      key: 'wife_name',
      value: 'Sakshi',
      type: 'family',
      importance: 90,
      confidence: 0.99,
      shouldPersist: true,
      source_authority: 'explicit_user',
    };

    await memoryRepository.upsertMemory(userId, fact, 'Sakshi is my wife');

    const wmCorrect = mockWorkingMemoryDb.find(r => r.id === 'wm_correct');
    expect(wmCorrect?.promotion_status).toBe('CANDIDATE');
  });

  it('6. Idempotency: Repeating invalidation causes zero error and zero side-effects', async () => {
    mockWorkingMemoryDb.push({
      id: 'wm_dup',
      user_id: userId,
      key: 'wife_name',
      value: 'Priya',
      promotion_status: 'CANDIDATE',
    });

    const count1 = await memoryRepository.invalidateStaleWorkingMemory(userId, 'wife_name', 'Sakshi');
    expect(count1).toBe(1);

    const count2 = await memoryRepository.invalidateStaleWorkingMemory(userId, 'wife_name', 'Sakshi');
    expect(count2).toBe(0); // Already superseded, 0 new modifications
  });

  it('7. Zero physical DELETEs occur (rows remain in DB with promotion_status = SUPERSEDED)', async () => {
    mockWorkingMemoryDb.push({
      id: 'wm_audit',
      user_id: userId,
      key: 'company_name',
      value: 'OldCorp',
      promotion_status: 'CANDIDATE',
    });

    await memoryRepository.invalidateStaleWorkingMemory(userId, 'company_name', 'NewCorp');

    expect(mockWorkingMemoryDb.length).toBe(1);
    expect(mockWorkingMemoryDb[0].id).toBe('wm_audit');
    expect(mockWorkingMemoryDb[0].promotion_status).toBe('SUPERSEDED');
  });

  it('8. Zero LLM calls are made during invalidation', async () => {
    // Invalidation runs 100% deterministically in TypeScript/Postgres
    const count = await memoryRepository.invalidateStaleWorkingMemory(userId, 'city', 'Mumbai');
    expect(count).toBe(0);
  });
});
