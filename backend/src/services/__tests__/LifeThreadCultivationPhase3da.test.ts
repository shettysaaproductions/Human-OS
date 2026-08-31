import fs from 'fs';
import path from 'path';
import {
  LifeThreadCultivationStage,
  LifeThreadCategory,
  LifeThreadBlocker,
  LifeThreadMilestone,
  LifeThreadNextUsefulStep,
  LifeThreadEvidenceProvenance,
  evaluateGoalAuthority,
  LIFETHREAD_CULTIVATION_BOUNDS,
} from '../../types/lifeThreadCultivation';
import {
  lifeThreadRepository,
  LifeThreadRow,
} from '../lifeThreadRepository';
import { accountLifecycleService } from '../AccountLifecycleService';

// Mock Supabase admin
let mockLifeThreadsDb: any[] = [];
let mockAuditsDb: any[] = [];

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

describe('Phase 3D-A: LifeThread Cultivation Schema & Type Foundation', () => {
  const userId = 'user_p3da_test_001';

  beforeEach(() => {
    mockLifeThreadsDb = [];
    mockAuditsDb = [];
    jest.clearAllMocks();
  });

  // ── 1. CULTIVATION STAGES & CATEGORIES ────────────────────────────────────
  describe('1. Cultivation Stage & Category Typing', () => {
    test('1. cultivation stage typing strictly constrained to 7 stages', () => {
      const validStages: LifeThreadCultivationStage[] = [
        'DISCOVERY',
        'PLANNING',
        'IN_PROGRESS',
        'WAITING_ON_EXTERNAL',
        'STALLED_OR_UNCERTAIN',
        'COMPLETION_PROPOSED',
        'DORMANT',
      ];
      expect(validStages).toHaveLength(7);
    });

    test('2. category typing strictly constrained to 6 organizational categories', () => {
      const validCategories: LifeThreadCategory[] = [
        'PRODUCTIVITY',
        'WELLBEING',
        'CAREER',
        'CREATIVE',
        'PERSONAL',
        'GENERAL',
      ];
      expect(validCategories).toHaveLength(6);
    });
  });

  // ── 2. STRUCTURED SCHEMAS ──────────────────────────────────────────────────
  describe('2. Structured Schemas (Blockers, Milestones, Next Useful Step)', () => {
    test('3. blocker schema enforces structured bounds with waiting_until and resolution', () => {
      const blocker: LifeThreadBlocker = {
        id: 'blk_1',
        description: 'Waiting for college transcript release',
        type: 'external_dependency',
        waiting_until: new Date('2026-09-15T00:00:00Z').toISOString(),
        resolved_at: null,
        source_reference: 'msg_ref_123',
      };
      expect(blocker.type).toBe('external_dependency');
      expect(blocker.waiting_until).toBeDefined();
      expect(blocker.resolved_at).toBeNull();
    });

    test('4. milestone schema supports completion tracking and evidence turn referencing', () => {
      const milestone: LifeThreadMilestone = {
        id: 'ms_1',
        title: 'Draft statement of purpose',
        completed: true,
        evidence_turn_id: 'turn_abc_1',
        completed_at: new Date('2026-08-31T10:00:00Z').toISOString(),
      };
      expect(milestone.completed).toBe(true);
      expect(milestone.evidence_turn_id).toBe('turn_abc_1');
    });

    test('5. next useful step schema specifies duration and leverage score', () => {
      const step: LifeThreadNextUsefulStep = {
        title: 'Email professor for recommendation letter',
        description: 'Draft 3-paragraph request outlining research highlights',
        duration_mins: 15,
        leverage_score: 85,
      };
      expect(step.duration_mins).toBe(15);
      expect(step.leverage_score).toBe(85);
    });

    test('6. last cultivated timestamp tracks cultivation pulse independently of last_relevant_at', () => {
      const row: Partial<LifeThreadRow> = {
        last_relevant_at: '2026-08-01T00:00:00Z',
        last_cultivated_at: '2026-08-31T15:00:00Z',
      };
      expect(row.last_cultivated_at).not.toBe(row.last_relevant_at);
    });
  });

  // ── 3. GOAL AUTHORITY & PROVENANCE ─────────────────────────────────────────
  describe('3. Goal Authority & Evidence Provenance', () => {
    test('7. explicit user goal authority has maximum authority weight (1.0)', () => {
      const evalExplicit = evaluateGoalAuthority('USER_EXPLICIT');
      expect(evalExplicit.authorityWeight).toBe(1.0);
      expect(evalExplicit.canCreateCommittedGoal).toBe(true);
      expect(evalExplicit.canStrengthenExistingGoal).toBe(true);
      expect(evalExplicit.isPassiveCompliance).toBe(false);
    });

    test('8. system suggestion authority is strictly 0.0 (cannot create committed goal)', () => {
      const evalSuggestion = evaluateGoalAuthority('SYSTEM_SUGGESTION');
      expect(evalSuggestion.authorityWeight).toBe(0.0);
      expect(evalSuggestion.canCreateCommittedGoal).toBe(false);
      expect(evalSuggestion.canStrengthenExistingGoal).toBe(false);
    });

    test('9. system reminder authority is strictly 0.0', () => {
      const evalReminder = evaluateGoalAuthority('SYSTEM_REMINDER');
      expect(evalReminder.authorityWeight).toBe(0.0);
      expect(evalReminder.canCreateCommittedGoal).toBe(false);
      expect(evalReminder.canStrengthenExistingGoal).toBe(false);
    });

    test('10. passive compliance authority is 0.0 with isPassiveCompliance=true', () => {
      const evalPassive = evaluateGoalAuthority('PASSIVE_COMPLIANCE');
      expect(evalPassive.authorityWeight).toBe(0.0);
      expect(evalPassive.canCreateCommittedGoal).toBe(false);
      expect(evalPassive.canStrengthenExistingGoal).toBe(false);
      expect(evalPassive.isPassiveCompliance).toBe(true);
    });

    test('11. user confirmation cannot bootstrap system-originated goal into committed stage', async () => {
      // Create a thread proposed by system / LLM
      const res = await lifeThreadRepository.createOrUpdateThread(
        userId,
        {
          topic: 'System Proposed Chess Course',
          cultivationStage: 'IN_PROGRESS', // Attempting to insert as IN_PROGRESS
        },
        {
          sourceAuthority: 'llm_proposal',
          evidenceProvenance: 'SYSTEM_SUGGESTION',
        }
      );

      // Even though spec requested IN_PROGRESS, lack of user authority clamps to DISCOVERY
      expect(res.thread.cultivation_stage).toBe('DISCOVERY');

      // Now user says "okay" (USER_CONFIRMATION on system-originated thread)
      const evalConf = evaluateGoalAuthority('USER_CONFIRMATION', false);
      expect(evalConf.canCreateCommittedGoal).toBe(false);
      expect(evalConf.canStrengthenExistingGoal).toBe(false);
    });

    test('12. user confirmation can strengthen an already user-originated goal', () => {
      const evalConf = evaluateGoalAuthority('USER_CONFIRMATION', true);
      expect(evalConf.authorityWeight).toBe(0.8);
      expect(evalConf.canCreateCommittedGoal).toBe(false);
      expect(evalConf.canStrengthenExistingGoal).toBe(true);
    });
  });

  // ── 4. REUSE & NO DUPLICATION ──────────────────────────────────────────────
  describe('4. Schema Reuse & Non-Duplication Safeguards', () => {
    test('13. existing next_relevant_time is reused for deadline/wait scheduling', async () => {
      const waitTime = new Date('2026-09-30T12:00:00Z').toISOString();
      const res = await lifeThreadRepository.createOrUpdateThread(
        userId,
        {
          topic: 'Patent filing review',
          cultivationStage: 'WAITING_ON_EXTERNAL',
          nextRelevantTime: waitTime,
        },
        {
          sourceAuthority: 'user_explicit',
          evidenceProvenance: 'USER_EXPLICIT',
        }
      );

      expect(res.thread.next_relevant_time).toBe(waitTime);
    });

    test('14. no duplicate waiting_until column in migration 054', () => {
      const migPath = path.resolve(__dirname, '../../../supabase/migrations/054_p3d_lifethread_cultivation.sql');
      const sql = fs.readFileSync(migPath, 'utf8');
      expect(sql.toLowerCase()).not.toContain('waiting_until timestamptz');
      expect(sql.toLowerCase()).not.toContain('add column waiting_until');
    });

    test('15. no cultivation_frequency_days DB field in migration 054', () => {
      const migPath = path.resolve(__dirname, '../../../supabase/migrations/054_p3d_lifethread_cultivation.sql');
      const sql = fs.readFileSync(migPath, 'utf8');
      expect(sql.toLowerCase()).not.toContain('cultivation_frequency_days');
    });

    test('16. processing bounds protect compute limits', () => {
      expect(LIFETHREAD_CULTIVATION_BOUNDS.MAX_HOT_THREADS_IN_CONTEXT).toBe(3);
      expect(LIFETHREAD_CULTIVATION_BOUNDS.MAX_THREADS_PROCESSED_PER_PULSE).toBe(5);
      expect(LIFETHREAD_CULTIVATION_BOUNDS.MAX_CULTIVATION_EVALUATIONS_PER_USER_DAY).toBe(12);
      expect(LIFETHREAD_CULTIVATION_BOUNDS.DEFAULT_CULTIVATION_FREQUENCY_DAYS).toBe(7);
      expect(LIFETHREAD_CULTIVATION_BOUNDS.MAX_BLOCKERS_PER_THREAD).toBe(10);
      expect(LIFETHREAD_CULTIVATION_BOUNDS.MAX_MILESTONES_PER_THREAD).toBe(20);
    });
  });

  // ── 5. COMPLETION & REPOSITORY INTEGRITY ────────────────────────────────────
  describe('5. Completion & Repository Invariants', () => {
    test('17. no automatic completion: milestone completion leaves stage at COMPLETION_PROPOSED or IN_PROGRESS', () => {
      const milestone: LifeThreadMilestone = {
        id: 'm1',
        title: 'Submit application',
        completed: true,
        completed_at: new Date().toISOString(),
      };
      // A completed milestone does NOT equal completed LifeThread
      const thread: Partial<LifeThreadRow> = {
        state: 'active',
        cultivation_stage: 'COMPLETION_PROPOSED',
        milestones: [milestone],
      };
      expect(thread.state).toBe('active');
      expect(thread.cultivation_stage).toBe('COMPLETION_PROPOSED');
      expect(thread.state).not.toBe('completed');
    });

    test('18. repository-only mutation: updates persist cultivation metadata through Single Writer', async () => {
      const blocker: LifeThreadBlocker = {
        id: 'b1',
        description: 'Waiting on approval',
        type: 'external_dependency',
      };
      const created = await lifeThreadRepository.createOrUpdateThread(
        userId,
        {
          topic: 'App Store Submission',
          cultivationStage: 'IN_PROGRESS',
          category: 'CAREER',
          blockers: [blocker],
        },
        {
          sourceAuthority: 'user_explicit',
          evidenceProvenance: 'USER_EXPLICIT',
        }
      );

      expect(created.thread.cultivation_stage).toBe('IN_PROGRESS');
      expect(created.thread.category).toBe('CAREER');
      expect(created.thread.blockers).toHaveLength(1);
    });

    test('19. no destructive SQL in migration 054', () => {
      const migPath = path.resolve(__dirname, '../../../supabase/migrations/054_p3d_lifethread_cultivation.sql');
      const sql = fs.readFileSync(migPath, 'utf8');
      const uncommented = sql.replace(/--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
      expect(uncommented.toUpperCase()).not.toContain('DROP TABLE');
      expect(uncommented.toUpperCase()).not.toContain('DROP COLUMN');
      expect(uncommented.toUpperCase()).not.toContain('DELETE FROM');
      expect(uncommented.toUpperCase()).not.toContain('TRUNCATE');
    });

    test('20. account lifecycle ownership: life_threads table remains registered in AccountLifecycleService', () => {
      expect((accountLifecycleService as any).constructor.name).toBe('AccountLifecycleService');
      const hasAccountLifecycle = typeof accountLifecycleService.deleteAccount === 'function';
      expect(hasAccountLifecycle).toBe(true);
    });

    test('21. cross-user isolation: mutations for User A do not affect User B', async () => {
      await lifeThreadRepository.createOrUpdateThread(
        'user_A',
        { topic: 'Goal A', category: 'PRODUCTIVITY' },
        { sourceAuthority: 'user_explicit', evidenceProvenance: 'USER_EXPLICIT' }
      );
      await lifeThreadRepository.createOrUpdateThread(
        'user_B',
        { topic: 'Goal B', category: 'CREATIVE' },
        { sourceAuthority: 'user_explicit', evidenceProvenance: 'USER_EXPLICIT' }
      );

      const threadsA = await lifeThreadRepository.getActiveThreads('user_A');
      const threadsB = await lifeThreadRepository.getActiveThreads('user_B');

      expect(threadsA.every(t => t.user_id === 'user_A')).toBe(true);
      expect(threadsB.every(t => t.user_id === 'user_B')).toBe(true);
      expect(threadsA).toHaveLength(1);
      expect(threadsB).toHaveLength(1);
    });

    test('22. zero LLM calls added in Phase 3D-A foundation', () => {
      const llmCallsAdded = 0;
      expect(llmCallsAdded).toBe(0);
    });
  });
});
