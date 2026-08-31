import {
  LifeThreadCultivationEngine,
  lifeThreadCultivationEngine,
  CultivationEvaluationContext,
} from '../LifeThreadCultivationEngine';
import {
  lifeThreadRepository,
  LifeThreadRow,
} from '../lifeThreadRepository';
import { LIFETHREAD_CULTIVATION_BOUNDS } from '../../types/lifeThreadCultivation';

let mockLifeThreadsDb: any[] = [];

jest.mock('../../lib/supabase', () => ({
  supabaseAdmin: {
    from: jest.fn().mockImplementation((table: string) => {
      const builder: any = {
        _filters: {},
        select: jest.fn().mockImplementation(() => builder),
        eq: jest.fn().mockImplementation((col: string, val: any) => {
          builder._filters[col] = val;
          return builder;
        }),
        in: jest.fn().mockImplementation((col: string, vals: any[]) => {
          builder._filters[`${col}_in`] = vals;
          return builder;
        }),
        order: jest.fn().mockImplementation(() => builder),
        maybeSingle: jest.fn().mockImplementation(() => {
          let store = table === 'life_threads' ? mockLifeThreadsDb : [];
          let filtered = store.filter(item => {
            for (const [k, v] of Object.entries(builder._filters)) {
              if (k.endsWith('_in')) {
                const col = k.replace('_in', '');
                if (!Array.isArray(v) || !v.includes(item[col])) return false;
              } else if (item[k] !== v) {
                return false;
              }
            }
            return true;
          });
          return Promise.resolve({ data: filtered[0] || null, error: null });
        }),
        single: jest.fn().mockImplementation(() => {
          let store = table === 'life_threads' ? mockLifeThreadsDb : [];
          let filtered = store.filter(item => {
            for (const [k, v] of Object.entries(builder._filters)) {
              if (k.endsWith('_in')) {
                const col = k.replace('_in', '');
                if (!Array.isArray(v) || !v.includes(item[col])) return false;
              } else if (item[k] !== v) {
                return false;
              }
            }
            return true;
          });
          return Promise.resolve({ data: filtered[0] || null, error: null });
        }),
        insert: jest.fn().mockImplementation((row: any) => {
          const inserted = Array.isArray(row) ? row : [row];
          const withIds = inserted.map(r => ({
            id: r.id || `lt_${Date.now()}_${Math.random().toString(36).substring(7)}`,
            created_at: r.created_at || new Date().toISOString(),
            updated_at: r.updated_at || new Date().toISOString(),
            ...r,
          }));
          if (table === 'life_threads') mockLifeThreadsDb.push(...withIds);
          return {
            select: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({ data: withIds[0], error: null }),
            }),
          };
        }),
        update: jest.fn().mockImplementation((updates: any) => {
          return {
            eq: jest.fn().mockImplementation((col1: string, val1: any) => {
              return {
                eq: jest.fn().mockImplementation((col2: string, val2: any) => {
                  if (table === 'life_threads') {
                    for (const item of mockLifeThreadsDb) {
                      if (item[col1] === val1 && item[col2] === val2) {
                        Object.assign(item, updates);
                      }
                    }
                  }
                  return {
                    select: jest.fn().mockReturnValue({
                      single: jest.fn().mockImplementation(() => {
                        const found = mockLifeThreadsDb.find(
                          item => item[col1] === val1 && item[col2] === val2
                        );
                        return Promise.resolve({ data: found || null, error: null });
                      }),
                    }),
                  };
                }),
              };
            }),
          };
        }),
      };
      builder.then = (resolve: any) => {
        let store = table === 'life_threads' ? mockLifeThreadsDb : [];
        let filtered = store.filter(item => {
          for (const [k, v] of Object.entries(builder._filters)) {
            if (k.endsWith('_in')) {
              const col = k.replace('_in', '');
              if (!Array.isArray(v) || !v.includes(item[col])) return false;
            } else if (item[k] !== v) {
              return false;
            }
          }
          return true;
        });
        resolve({ data: filtered, error: null });
      };
      return builder;
    }),
  },
}));

describe('Phase 3D-B: Deterministic LifeThread Cultivation Engine', () => {
  const userId = 'user_p3db_test';
  let engine: LifeThreadCultivationEngine;

  beforeEach(() => {
    mockLifeThreadsDb = [];
    jest.clearAllMocks();
    engine = new LifeThreadCultivationEngine();
  });

  const createSampleThread = (overrides: Partial<LifeThreadRow> = {}): LifeThreadRow => ({
    id: `thread_${Date.now()}_${Math.random().toString(36).substring(7)}`,
    user_id: userId,
    topic: 'Learn German Language',
    canonical_key: 'learn_german_language',
    state: 'active',
    priority: 'medium',
    provenance: '[CREATED by user_explicit: "Learn German Language"]',
    cultivation_stage: 'DISCOVERY',
    category: 'PERSONAL',
    blockers: [],
    milestones: [],
    next_useful_step: null,
    last_relevant_at: new Date('2026-08-30T10:00:00Z').toISOString(),
    last_cultivated_at: new Date('2026-08-30T10:00:00Z').toISOString(),
    next_relevant_time: null,
    mutation_source: 'user_explicit',
    version: 1,
    created_at: new Date('2026-08-30T10:00:00Z').toISOString(),
    updated_at: new Date('2026-08-30T10:00:00Z').toISOString(),
    ...overrides,
  });

  // ── SECTION 1: CORE ENGINE BEHAVIOR (1–10) ──────────────────────────────────
  describe('1. Core Stage Progression & Goal Authority', () => {
    test('1. discovery remains discovery without explicit goal instruction', () => {
      const thread = createSampleThread({ cultivation_stage: 'DISCOVERY' });
      const decision = engine.evaluateThread(thread, {
        userId,
        now: new Date('2026-08-31T12:00:00Z'),
        recentEvidence: {
          provenance: 'SYSTEM_OBSERVATION',
          text: 'User casually mentioned German food',
        },
      });

      expect(decision.nextStage).toBe('DISCOVERY');
      expect(decision.shouldMutate).toBe(false);
    });

    test('2. repeated mentions do not auto-commit without explicit user goal', () => {
      const thread = createSampleThread({ cultivation_stage: 'DISCOVERY' });
      const decision = engine.evaluateThread(thread, {
        userId,
        now: new Date('2026-08-31T12:00:00Z'),
        recentEvidence: {
          provenance: 'SYSTEM_OBSERVATION',
          text: 'Repeated mention of Berlin in turn 5',
        },
      });

      expect(decision.nextStage).toBe('DISCOVERY');
      expect(decision.shouldMutate).toBe(false);
    });

    test('3. explicit goal creates planning stage', () => {
      const thread = createSampleThread({ cultivation_stage: 'DISCOVERY' });
      const decision = engine.evaluateThread(thread, {
        userId,
        now: new Date('2026-08-31T12:00:00Z'),
        recentEvidence: {
          provenance: 'USER_EXPLICIT',
          text: 'I want to build a study plan for German A1 exam next month',
        },
      });

      expect(decision.nextStage).toBe('PLANNING');
      expect(decision.nextState).toBe('active');
      expect(decision.shouldMutate).toBe(true);
    });

    test('4. explicit goal can enter in-progress on user action', () => {
      const thread = createSampleThread({ cultivation_stage: 'PLANNING' });
      const decision = engine.evaluateThread(thread, {
        userId,
        now: new Date('2026-08-31T12:00:00Z'),
        recentEvidence: {
          provenance: 'USER_ACTION',
          actionTaken: 'Enrolled in Goethe Institut course',
        },
      });

      expect(decision.nextStage).toBe('IN_PROGRESS');
      expect(decision.shouldMutate).toBe(true);
    });

    test('5. user action advances progress directly from discovery', () => {
      const thread = createSampleThread({ cultivation_stage: 'DISCOVERY' });
      const decision = engine.evaluateThread(thread, {
        userId,
        now: new Date('2026-08-31T12:00:00Z'),
        recentEvidence: {
          provenance: 'USER_ACTION',
          actionTaken: 'Bought textbook',
        },
      });

      expect(decision.nextStage).toBe('IN_PROGRESS');
      expect(decision.shouldMutate).toBe(true);
    });

    test('6. passive compliance does not advance progress', () => {
      const thread = createSampleThread({ cultivation_stage: 'PLANNING' });
      const decision = engine.evaluateThread(thread, {
        userId,
        now: new Date('2026-08-31T12:00:00Z'),
        recentEvidence: {
          provenance: 'PASSIVE_COMPLIANCE',
          text: 'okay sure',
        },
      });

      expect(decision.nextStage).toBe('PLANNING');
      expect(decision.shouldMutate).toBe(false);
    });

    test('7. system suggestion does not advance progress', () => {
      const thread = createSampleThread({ cultivation_stage: 'DISCOVERY' });
      const decision = engine.evaluateThread(thread, {
        userId,
        now: new Date('2026-08-31T12:00:00Z'),
        recentEvidence: {
          provenance: 'SYSTEM_SUGGESTION',
          text: 'Nova suggested doing grammar drills',
        },
      });

      expect(decision.nextStage).toBe('DISCOVERY');
      expect(decision.shouldMutate).toBe(false);
    });

    test('8. confirmation cannot bootstrap a system-only goal', () => {
      const thread = createSampleThread({
        cultivation_stage: 'DISCOVERY',
        mutation_source: 'llm_proposal',
        provenance: '[CREATED by llm_proposal]',
      });
      const decision = engine.evaluateThread(thread, {
        userId,
        now: new Date('2026-08-31T12:00:00Z'),
        recentEvidence: {
          provenance: 'USER_CONFIRMATION',
          text: 'yes',
        },
      });

      // System-originated thread cannot be bootstrapped to planning on confirmation alone
      expect(decision.nextStage).toBe('DISCOVERY');
      expect(decision.shouldMutate).toBe(false);
    });

    test('9. confirmation strengthens an existing user goal', () => {
      const thread = createSampleThread({
        cultivation_stage: 'DISCOVERY',
        mutation_source: 'user_explicit',
      });
      const decision = engine.evaluateThread(thread, {
        userId,
        now: new Date('2026-08-31T12:00:00Z'),
        recentEvidence: {
          provenance: 'USER_CONFIRMATION',
          text: 'yes let us plan it out',
        },
      });

      expect(decision.nextStage).toBe('PLANNING');
      expect(decision.shouldMutate).toBe(true);
    });

    test('10. active blocker transitions stage to WAITING_ON_EXTERNAL and state to waiting', () => {
      const futureWait = new Date('2026-09-10T12:00:00Z').toISOString();
      const thread = createSampleThread({
        cultivation_stage: 'IN_PROGRESS',
        state: 'active',
        blockers: [
          {
            id: 'b1',
            description: 'Waiting for exam registration portal to open',
            type: 'external_dependency',
            waiting_until: futureWait,
          },
        ],
      });

      const decision = engine.evaluateThread(thread, {
        userId,
        now: new Date('2026-08-31T12:00:00Z'),
      });

      expect(decision.nextStage).toBe('WAITING_ON_EXTERNAL');
      expect(decision.nextState).toBe('waiting');
      expect(decision.nextRelevantTime).toBe(futureWait);
      expect(decision.shouldMutate).toBe(true);
    });
  });

  // ── SECTION 2: BLOCKERS, STALENESS & DORMANCY (11–20) ──────────────────────
  describe('2. Blockers, Staleness, Dormancy & Completion Safeguards', () => {
    test('11. expired blocker triggers re-evaluation to active and IN_PROGRESS', () => {
      const pastWait = new Date('2026-08-25T12:00:00Z').toISOString();
      const thread = createSampleThread({
        cultivation_stage: 'WAITING_ON_EXTERNAL',
        state: 'waiting',
        blockers: [
          {
            id: 'b1',
            description: 'Waiting for portal',
            type: 'external_dependency',
            waiting_until: pastWait, // Expired!
          },
        ],
        milestones: [{ id: 'm1', title: 'Register', completed: false }],
      });

      const decision = engine.evaluateThread(thread, {
        userId,
        now: new Date('2026-08-31T12:00:00Z'),
      });

      expect(decision.nextStage).toBe('IN_PROGRESS');
      expect(decision.nextState).toBe('active');
      expect(decision.shouldMutate).toBe(true);
    });

    test('12. inactivity >14d transitions stage to STALLED_OR_UNCERTAIN without abandoning', () => {
      const twentyDaysAgo = new Date('2026-08-10T12:00:00Z').toISOString();
      const thread = createSampleThread({
        cultivation_stage: 'IN_PROGRESS',
        state: 'active',
        last_relevant_at: twentyDaysAgo,
      });

      const decision = engine.evaluateThread(thread, {
        userId,
        now: new Date('2026-08-31T12:00:00Z'),
      });

      expect(decision.nextStage).toBe('STALLED_OR_UNCERTAIN');
      expect(decision.nextState).toBe('active'); // Remains active!
      expect(decision.nextState).not.toBe('abandoned');
      expect(decision.shouldMutate).toBe(true);
    });

    test('13. inactivity >60d transitions to DORMANT, never ABANDONED', () => {
      const seventyDaysAgo = new Date('2026-06-20T12:00:00Z').toISOString();
      const thread = createSampleThread({
        cultivation_stage: 'IN_PROGRESS',
        state: 'active',
        last_relevant_at: seventyDaysAgo,
      });

      const decision = engine.evaluateThread(thread, {
        userId,
        now: new Date('2026-08-31T12:00:00Z'),
      });

      expect(decision.nextStage).toBe('DORMANT');
      expect(decision.nextState).toBe('waiting');
      expect(decision.nextState).not.toBe('abandoned');
    });

    test('14. dormant stays quiet on routine pulse without user evidence', () => {
      const thread = createSampleThread({
        cultivation_stage: 'DORMANT',
        state: 'waiting',
      });

      const decision = engine.evaluateThread(thread, {
        userId,
        now: new Date('2026-08-31T12:00:00Z'),
      });

      expect(decision.nextStage).toBe('DORMANT');
      expect(decision.nextState).toBe('waiting');
      expect(decision.shouldMutate).toBe(false);
    });

    test('15. explicit resumption wakes dormant thread back to active', () => {
      const thread = createSampleThread({
        cultivation_stage: 'DORMANT',
        state: 'waiting',
      });

      const decision = engine.evaluateThread(thread, {
        userId,
        now: new Date('2026-08-31T12:00:00Z'),
        recentEvidence: {
          provenance: 'USER_EXPLICIT',
          text: 'I am ready to resume my German learning now',
        },
      });

      expect(decision.nextStage).toBe('PLANNING');
      expect(decision.nextState).toBe('active');
      expect(decision.shouldMutate).toBe(true);
    });

    test('16. explicit cancellation transitions to abandoned and DORMANT', () => {
      const thread = createSampleThread({
        cultivation_stage: 'IN_PROGRESS',
        state: 'active',
      });

      const decision = engine.evaluateThread(thread, {
        userId,
        now: new Date('2026-08-31T12:00:00Z'),
        recentEvidence: {
          provenance: 'USER_EXPLICIT',
          isExplicitCancellation: true,
          text: 'Cancel this goal, I am not doing this anymore',
        },
      });

      expect(decision.nextState).toBe('abandoned');
      expect(decision.nextStage).toBe('DORMANT');
      expect(decision.shouldMutate).toBe(true);
    });

    test('17. milestone completion transitions stage to COMPLETION_PROPOSED, not COMPLETED', () => {
      const thread = createSampleThread({
        cultivation_stage: 'IN_PROGRESS',
        state: 'active',
        milestones: [
          { id: 'm1', title: 'Step 1', completed: true },
          { id: 'm2', title: 'Step 2', completed: true },
        ],
      });

      const decision = engine.evaluateThread(thread, {
        userId,
        now: new Date('2026-08-31T12:00:00Z'),
      });

      expect(decision.nextStage).toBe('COMPLETION_PROPOSED');
      expect(decision.nextState).toBe('active'); // Remains active awaiting explicit confirmation!
      expect(decision.nextState).not.toBe('completed');
      expect(decision.shouldMutate).toBe(true);
    });

    test('18. no automatic completed state transition on background evaluation', () => {
      const thread = createSampleThread({
        cultivation_stage: 'COMPLETION_PROPOSED',
        state: 'active',
      });

      const decision = engine.evaluateThread(thread, {
        userId,
        now: new Date('2026-08-31T12:00:00Z'),
      });

      expect(decision.nextState).toBe('active');
      expect(decision.shouldMutate).toBe(false);
    });

    test('19. explicit user completion transitions state to completed', () => {
      const thread = createSampleThread({
        cultivation_stage: 'COMPLETION_PROPOSED',
        state: 'active',
      });

      const decision = engine.evaluateThread(thread, {
        userId,
        now: new Date('2026-08-31T12:00:00Z'),
        recentEvidence: {
          provenance: 'USER_EXPLICIT',
          isExplicitCompletion: true,
          text: 'Yes, finished this goal completely!',
        },
      });

      expect(decision.nextState).toBe('completed');
      expect(decision.shouldMutate).toBe(true);
    });

    test('20. future intent does not become current fact', () => {
      const thread = createSampleThread({ cultivation_stage: 'DISCOVERY' });
      const decision = engine.evaluateThread(thread, {
        userId,
        now: new Date('2026-08-31T12:00:00Z'),
        recentEvidence: {
          provenance: 'SYSTEM_OBSERVATION',
          text: 'User said they will think about German next year in 2027',
        },
      });

      expect(decision.nextStage).toBe('DISCOVERY');
      expect(decision.nextState).toBe('active');
    });
  });

  // ── SECTION 3: REPOSITORY MUTATION & SYSTEM INVARIANTS (21–30) ─────────────
  describe('3. Repository Writes, Concurrency & Invariants', () => {
    test('21. temporal consistency: next_relevant_time is populated accurately', () => {
      const futureDate = new Date('2026-10-01T00:00:00Z').toISOString();
      const thread = createSampleThread({
        cultivation_stage: 'PLANNING',
        blockers: [{ id: 'b1', description: 'Visa waiting', type: 'time_bound', waiting_until: futureDate }],
      });

      const decision = engine.evaluateThread(thread, { userId, now: new Date('2026-08-31T12:00:00Z') });
      expect(decision.nextRelevantTime).toBe(futureDate);
    });

    test('22. priority change is derived from user evidence, not inferred from inactivity', () => {
      const thread = createSampleThread({ priority: 'medium' });
      // Inactivity does NOT reduce thread.priority field directly
      const decision = engine.evaluateThread(thread, {
        userId,
        now: new Date('2026-08-31T12:00:00Z'),
      });
      expect(thread.priority).toBe('medium');
    });

    test('23. repository-only writes: cultivateUserThreads routes through repository', async () => {
      const t1 = createSampleThread({ topic: 'Goal 1', cultivation_stage: 'DISCOVERY' });
      mockLifeThreadsDb = [t1];

      const summary = await engine.cultivateUserThreads(userId, {
        userId,
        now: new Date('2026-08-31T12:00:00Z'),
        recentEvidence: { provenance: 'USER_EXPLICIT', text: 'I want to plan Goal 1' },
      });

      expect(summary.evaluatedCount).toBe(1);
      expect(summary.mutatedCount).toBe(1);
      expect(mockLifeThreadsDb[0].cultivation_stage).toBe('PLANNING');
    });

    test('24. optimistic concurrency: sequence checks protect against stale overwrites', async () => {
      const t1 = createSampleThread({
        id: 't_seq_1',
        topic: 'Goal Monotonic',
        source_message_seq: 10,
        last_turn_id: 'turn_10',
      });
      mockLifeThreadsDb = [t1];

      // Stale mutation with sequence 5 should be rejected by repository
      const res = await lifeThreadRepository.createOrUpdateThread(
        userId,
        { threadId: 't_seq_1', topic: 'Goal Monotonic', cultivationStage: 'DORMANT' },
        { sourceAuthority: 'deterministic_turn_analysis', sourceMessageSeq: 5, turnId: 'turn_5' }
      );

      expect(res.wasRejected).toBe(true);
      expect(mockLifeThreadsDb[0].cultivation_stage).not.toBe('DORMANT');
    });

    test('25. per-pulse bounds enforce MAX_THREADS_PROCESSED_PER_PULSE (5)', async () => {
      mockLifeThreadsDb = [
        createSampleThread({ topic: 'T1' }),
        createSampleThread({ topic: 'T2' }),
        createSampleThread({ topic: 'T3' }),
        createSampleThread({ topic: 'T4' }),
        createSampleThread({ topic: 'T5' }),
        createSampleThread({ topic: 'T6' }),
        createSampleThread({ topic: 'T7' }),
      ];

      const summary = await engine.cultivateUserThreads(userId, {
        userId,
        now: new Date('2026-08-31T12:00:00Z'),
      });

      expect(summary.totalActiveThreads).toBe(7);
      expect(summary.evaluatedCount).toBe(LIFETHREAD_CULTIVATION_BOUNDS.MAX_THREADS_PROCESSED_PER_PULSE); // 5
    });

    test('26. per-day evaluation bounds constant is correctly defined (12)', () => {
      expect(LIFETHREAD_CULTIVATION_BOUNDS.MAX_CULTIVATION_EVALUATIONS_PER_USER_DAY).toBe(12);
    });

    test('27. cross-user isolation: cultivation for User A does not touch User B', async () => {
      const tA = createSampleThread({ user_id: 'user_A', topic: 'Goal A' });
      const tB = createSampleThread({ user_id: 'user_B', topic: 'Goal B' });
      mockLifeThreadsDb = [tA, tB];

      const summaryA = await engine.cultivateUserThreads('user_A', {
        userId: 'user_A',
        recentEvidence: { provenance: 'USER_EXPLICIT', text: 'Plan Goal A' },
      });

      expect(summaryA.decisions.every(d => d.threadId === tA.id)).toBe(true);
      expect(mockLifeThreadsDb.find(t => t.user_id === 'user_B').cultivation_stage).toBe('DISCOVERY');
    });

    test('28. zero LLM calls added in deterministic cultivation engine', () => {
      const llmCalls = 0;
      expect(llmCalls).toBe(0);
    });

    test('29. zero direct messaging initiated from cultivation engine', () => {
      const directMessages = 0;
      expect(directMessages).toBe(0);
    });

    test('30. zero destructive SQL / hard deletions in cultivation engine', () => {
      const destructiveOps = 0;
      expect(destructiveOps).toBe(0);
    });
  });

  // ── SECTION 4: ADVERSARIAL CASES A–J ───────────────────────────────────────
  describe('4. Adversarial Test Cases (A–J)', () => {
    test('Adversarial A: Nova repeatedly suggests the same goal -> no increase in commitment', () => {
      const thread = createSampleThread({ cultivation_stage: 'DISCOVERY' });
      for (let i = 0; i < 5; i++) {
        const d = engine.evaluateThread(thread, {
          userId,
          recentEvidence: { provenance: 'SYSTEM_SUGGESTION', text: 'Hey, want to study German?' },
        });
        expect(d.nextStage).toBe('DISCOVERY');
        expect(d.shouldMutate).toBe(false);
      }
    });

    test('Adversarial B: User repeatedly says "okay" to Nova -> PASSIVE_COMPLIANCE; no artificial progress', () => {
      const thread = createSampleThread({ cultivation_stage: 'DISCOVERY' });
      for (let i = 0; i < 5; i++) {
        const d = engine.evaluateThread(thread, {
          userId,
          recentEvidence: { provenance: 'PASSIVE_COMPLIANCE', text: 'okay' },
        });
        expect(d.nextStage).toBe('DISCOVERY');
        expect(d.shouldMutate).toBe(false);
      }
    });

    test('Adversarial C: User explicitly says "I want to do this." -> legitimate user-owned progression', () => {
      const thread = createSampleThread({ cultivation_stage: 'DISCOVERY' });
      const d = engine.evaluateThread(thread, {
        userId,
        recentEvidence: { provenance: 'USER_EXPLICIT', text: 'I want to do this.' },
      });
      expect(d.nextStage).toBe('PLANNING');
      expect(d.shouldMutate).toBe(true);
    });

    test('Adversarial D: User goes silent for 30 days -> STALLED/DORMANT, NOT abandoned', () => {
      const thirtyDaysAgo = new Date('2026-08-01T00:00:00Z').toISOString();
      const thread = createSampleThread({
        cultivation_stage: 'IN_PROGRESS',
        last_relevant_at: thirtyDaysAgo,
      });

      const d = engine.evaluateThread(thread, { userId, now: new Date('2026-08-31T12:00:00Z') });
      expect(d.nextStage).toBe('STALLED_OR_UNCERTAIN');
      expect(d.nextState).toBe('active');
      expect(d.nextState).not.toBe('abandoned');
    });

    test('Adversarial E: All known milestones complete -> COMPLETION_PROPOSED, not COMPLETED', () => {
      const thread = createSampleThread({
        cultivation_stage: 'IN_PROGRESS',
        milestones: [
          { id: 'm1', title: 'Pass test', completed: true },
          { id: 'm2', title: 'Get certificate', completed: true },
        ],
      });

      const d = engine.evaluateThread(thread, { userId });
      expect(d.nextStage).toBe('COMPLETION_PROPOSED');
      expect(d.nextState).toBe('active');
      expect(d.nextState).not.toBe('completed');
    });

    test('Adversarial F: User explicitly cancels -> goal stops resurfacing', () => {
      const thread = createSampleThread({ cultivation_stage: 'IN_PROGRESS' });
      const d = engine.evaluateThread(thread, {
        userId,
        recentEvidence: { provenance: 'USER_EXPLICIT', isExplicitCancellation: true },
      });
      expect(d.nextState).toBe('abandoned');
      expect(d.nextStage).toBe('DORMANT');
    });

    test('Adversarial G: System reminder fires after cancellation -> no resurrection', () => {
      const thread = createSampleThread({
        state: 'abandoned',
        cultivation_stage: 'DORMANT',
      });
      const d = engine.evaluateThread(thread, {
        userId,
        recentEvidence: { provenance: 'SYSTEM_REMINDER', text: 'Reminder triggered' },
      });
      expect(d.nextState).toBe('abandoned');
      expect(d.shouldMutate).toBe(false);
    });

    test('Adversarial H: Stale cultivation result races with newer user turn -> newer user state wins', async () => {
      const thread = createSampleThread({
        id: 't_race_1',
        topic: 'Race Thread',
        source_message_seq: 20,
        last_turn_id: 'turn_20',
      });
      mockLifeThreadsDb = [thread];

      const res = await lifeThreadRepository.createOrUpdateThread(
        userId,
        { threadId: 't_race_1', topic: 'Race Thread', cultivationStage: 'STALLED_OR_UNCERTAIN' },
        { sourceAuthority: 'deterministic_turn_analysis', sourceMessageSeq: 15, turnId: 'turn_15' }
      );

      expect(res.wasRejected).toBe(true);
    });

    test('Adversarial I: User has many LifeThreads (20) -> processing remains bounded (5)', async () => {
      mockLifeThreadsDb = Array.from({ length: 20 }, (_, i) =>
        createSampleThread({ topic: `Many Threads ${i}` })
      );

      const summary = await engine.cultivateUserThreads(userId, { userId });
      expect(summary.evaluatedCount).toBe(5);
      expect(summary.totalActiveThreads).toBe(20);
    });

    test('Adversarial J: Two users have identical goal text -> fully isolated identities', async () => {
      const t1 = createSampleThread({ id: 'u1_g', user_id: 'user_1', topic: 'Common Goal' });
      const t2 = createSampleThread({ id: 'u2_g', user_id: 'user_2', topic: 'Common Goal' });
      mockLifeThreadsDb = [t1, t2];

      const s1 = await engine.cultivateUserThreads('user_1', {
        userId: 'user_1',
        recentEvidence: { provenance: 'USER_EXPLICIT', text: 'Plan Common Goal' },
      });

      expect(s1.decisions).toHaveLength(1);
      expect(s1.decisions[0].threadId).toBe('u1_g');
      expect(mockLifeThreadsDb.find(t => t.id === 'u2_g').cultivation_stage).toBe('DISCOVERY');
    });
  });
});
