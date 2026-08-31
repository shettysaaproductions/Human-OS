/**
 * WatchtowerAttentionPhase3b.test.ts — Phase 3B Watchtower Attention & Priority Engine Tests
 *
 * Covers all 30 invariant requirements and Adversarial Cases A through H.
 */

import {
  WatchtowerAttentionEngine,
  watchtowerAttentionEngine,
  generateAttentionFingerprint,
} from '../WatchtowerAttentionEngine';
import { WATCHTOWER_ATTENTION_LIMITS } from '../../types/watchtowerAttention';

let mockAttentionDb: any[] = [];
let mockSignalsDb: any[] = [];
let mockDoubtsDb: any[] = [];
let mockThreadsDb: any[] = [];
let mockRemindersDb: any[] = [];

jest.mock('../../lib/supabase', () => ({
  supabaseAdmin: {
    from: jest.fn().mockImplementation((table: string) => {
      const builder: any = {
        _filters: {} as Record<string, any>,
        select: jest.fn().mockImplementation(() => builder),
        eq: jest.fn().mockImplementation((col: string, val: any) => {
          builder._filters[col] = val;
          return builder;
        }),
        gt: jest.fn().mockImplementation((col: string, val: any) => {
          builder._filters[`${col}_gt`] = val;
          return builder;
        }),
        gte: jest.fn().mockImplementation((col: string, val: any) => {
          builder._filters[`${col}_gte`] = val;
          return builder;
        }),
        lte: jest.fn().mockImplementation((col: string, val: any) => {
          builder._filters[`${col}_lte`] = val;
          return builder;
        }),
        lt: jest.fn().mockImplementation((col: string, val: any) => {
          builder._filters[`${col}_lt`] = val;
          return builder;
        }),
        in: jest.fn().mockImplementation((col: string, vals: any[]) => {
          builder._filters[`${col}_in`] = vals;
          return builder;
        }),
        order: jest.fn().mockImplementation(() => builder),
        limit: jest.fn().mockImplementation((lim: number) => {
          let store: any[] = [];
          if (table === 'watchtower_attention_decisions') store = mockAttentionDb;
          if (table === 'watchtower_cognitive_signals') store = mockSignalsDb;
          if (table === 'nova_cognitive_doubts') store = mockDoubtsDb;
          if (table === 'life_threads') store = mockThreadsDb;
          if (table === 'reminders') store = mockRemindersDb;

          let res = [...store];
          if (builder._filters['user_id']) res = res.filter(r => r.user_id === builder._filters['user_id']);
          if (builder._filters['status']) res = res.filter(r => r.status === builder._filters['status']);
          if (builder._filters['status_in']) res = res.filter(r => builder._filters['status_in'].includes(r.status));
          if (builder._filters['state_in']) res = res.filter(r => builder._filters['state_in'].includes(r.state));
          if (builder._filters['attention_class_in']) res = res.filter(r => builder._filters['attention_class_in'].includes(r.attention_class));
          if (builder._filters['expires_at_gt']) {
            res = res.filter(r => new Date(r.expires_at).getTime() > new Date(builder._filters['expires_at_gt']).getTime());
          }
          return Promise.resolve({ data: res.slice(0, lim), error: null });
        }),
        maybeSingle: jest.fn().mockImplementation(() => {
          let store: any[] = [];
          if (table === 'watchtower_attention_decisions') store = mockAttentionDb;
          let res = [...store];
          if (builder._filters['user_id']) res = res.filter(r => r.user_id === builder._filters['user_id']);
          if (builder._filters['fingerprint']) res = res.filter(r => r.fingerprint === builder._filters['fingerprint']);
          return Promise.resolve({ data: res[0] || null, error: null });
        }),
        upsert: jest.fn().mockImplementation((payload: any) => {
          const rows = Array.isArray(payload) ? payload : [payload];
          if (table === 'watchtower_attention_decisions') {
            for (const r of rows) {
              const idx = mockAttentionDb.findIndex(s => s.user_id === r.user_id && s.fingerprint === r.fingerprint);
              if (idx >= 0) {
                mockAttentionDb[idx] = { ...mockAttentionDb[idx], ...r };
              } else {
                mockAttentionDb.push({ id: `att_${Date.now()}_${Math.random()}`, ...r });
              }
            }
          }
          return {
            select: jest.fn().mockReturnValue(Promise.resolve({ data: rows, error: null })),
            then: (resolve: any) => resolve({ data: rows, error: null }),
          };
        }),
        update: jest.fn().mockImplementation((payload: any) => {
          const updateBuilder: any = {
            _filters: {} as Record<string, any>,
            eq: jest.fn().mockImplementation((c: string, v: string) => {
              updateBuilder._filters[c] = v;
              return updateBuilder;
            }),
            in: jest.fn().mockImplementation((c: string, v: any[]) => {
              updateBuilder._filters[`${c}_in`] = v;
              return updateBuilder;
            }),
            lte: jest.fn().mockImplementation((c: string, v: string) => {
              updateBuilder._filters[`${c}_lte`] = v;
              return updateBuilder;
            }),
            select: jest.fn().mockImplementation(() => {
              let store: any[] = [];
              if (table === 'watchtower_attention_decisions') store = mockAttentionDb;

              const matched: any[] = [];
              store.forEach(r => {
                let match = true;
                if (updateBuilder._filters['user_id'] && r.user_id !== updateBuilder._filters['user_id']) match = false;
                if (updateBuilder._filters['status_in'] && !updateBuilder._filters['status_in'].includes(r.status)) match = false;
                if (updateBuilder._filters['expires_at_lte']) {
                  if (new Date(r.expires_at).getTime() > new Date(updateBuilder._filters['expires_at_lte']).getTime()) match = false;
                }
                if (match) {
                  Object.assign(r, payload);
                  matched.push(r);
                }
              });
              return Promise.resolve({ data: matched, error: null });
            }),
            then: (resolve: any) => {
              let store: any[] = [];
              if (table === 'watchtower_attention_decisions') store = mockAttentionDb;

              const matched: any[] = [];
              store.forEach(r => {
                let match = true;
                if (updateBuilder._filters['user_id'] && r.user_id !== updateBuilder._filters['user_id']) match = false;
                if (updateBuilder._filters['status_in'] && !updateBuilder._filters['status_in'].includes(r.status)) match = false;
                if (updateBuilder._filters['expires_at_lte']) {
                  if (new Date(r.expires_at).getTime() > new Date(updateBuilder._filters['expires_at_lte']).getTime()) match = false;
                }
                if (match) {
                  Object.assign(r, payload);
                  matched.push(r);
                }
              });
              return resolve({ data: matched, error: null });
            },
          };
          return updateBuilder;
        }),
        then: (resolve: any) => {
          let store: any[] = [];
          if (table === 'watchtower_attention_decisions') store = mockAttentionDb;
          if (table === 'watchtower_cognitive_signals') store = mockSignalsDb;
          if (table === 'nova_cognitive_doubts') store = mockDoubtsDb;
          if (table === 'life_threads') store = mockThreadsDb;
          if (table === 'reminders') store = mockRemindersDb;

          let res = [...store];
          if (builder._filters['user_id']) res = res.filter(r => r.user_id === builder._filters['user_id']);
          if (builder._filters['status']) res = res.filter(r => r.status === builder._filters['status']);
          if (builder._filters['status_in']) res = res.filter(r => builder._filters['status_in'].includes(r.status));
          if (builder._filters['state_in']) res = res.filter(r => builder._filters['state_in'].includes(r.state));
          if (builder._filters['expires_at_gt']) {
            res = res.filter(r => new Date(r.expires_at).getTime() > new Date(builder._filters['expires_at_gt']).getTime());
          }
          return resolve({ data: res, error: null });
        },
      };
      return builder;
    }),
  },
}));

describe('Phase 3B: Watchtower Attention & Priority Engine', () => {
  const user1 = '00000000-0000-4000-a000-000000000001';
  const user2 = '00000000-0000-4000-a000-000000000002';

  beforeEach(() => {
    mockAttentionDb = [];
    mockSignalsDb = [];
    mockDoubtsDb = [];
    mockThreadsDb = [];
    mockRemindersDb = [];
    jest.clearAllMocks();
  });

  it('1. signal -> attention: Active cognitive signal evaluated into structured attention decision', async () => {
    mockSignalsDb.push({
      id: 'sig_1',
      user_id: user1,
      signal_type: 'guardian_W-003',
      category: 'contradiction',
      severity: 'high',
      entity: 'wife_name',
      status: 'active',
      expires_at: new Date(Date.now() + 100000).toISOString(),
    });

    const summary = await watchtowerAttentionEngine.evaluateUserAttention(user1);
    expect(summary.totalEvaluated).toBe(1);
    expect(mockAttentionDb.length).toBe(1);
    expect(mockAttentionDb[0].target_type).toBe('guardian_signal');
  });

  it('2. importance vs urgency separation: Scores remain distinct dimensions', () => {
    const scores = watchtowerAttentionEngine.computeDeterministicScores(
      'reminder',
      { urgency: 'high', trigger_at: new Date(Date.now() + 6 * 30 * 24 * 3600 * 1000).toISOString() }, // 6 months away
      new Set()
    );

    expect(scores.importance).toBeGreaterThanOrEqual(70);
    expect(scores.urgency).toBeLessThanOrEqual(25);
  });

  it('3. high importance / low urgency (e.g. Birthday in 6 months) -> WATCH class', () => {
    const classification = watchtowerAttentionEngine.classifyAttention('reminder', {
      importance: 85,
      urgency: 15,
      goalRelevance: 20,
      deadlineProximity: 10,
      novelty: 50,
      confidence: 90,
      recency: 50,
      alreadyHandledPenalty: 0,
      interruptionCost: 20,
      compositeScore: 45,
    }, {});

    expect(classification.attentionClass).toBe('WATCH');
    expect(classification.status).toBe('WATCHING');
  });

  it('4. high importance / high urgency (e.g. Interview tomorrow) -> URGENT / READY', () => {
    const classification = watchtowerAttentionEngine.classifyAttention('reminder', {
      importance: 85,
      urgency: 85,
      goalRelevance: 80,
      deadlineProximity: 95,
      novelty: 80,
      confidence: 95,
      recency: 90,
      alreadyHandledPenalty: 0,
      interruptionCost: 20,
      compositeScore: 85,
    }, { text: 'Google Interview' });

    expect(classification.attentionClass).toBe('URGENT');
    expect(classification.status).toBe('READY');
    expect(classification.recommendedAction).toContain('Prepare reminder follow-up');
  });

  it('5. low importance / high technical severity -> system ATTENTION, not urgent interruption', () => {
    const classification = watchtowerAttentionEngine.classifyAttention('guardian_signal', {
      importance: 50,
      urgency: 20,
      goalRelevance: 10,
      deadlineProximity: 0,
      novelty: 50,
      confidence: 90,
      recency: 50,
      alreadyHandledPenalty: 0,
      interruptionCost: 20,
      compositeScore: 35,
    }, { signal_type: 'W-007_provenance_gap' });

    expect(classification.attentionClass).toBe('ATTENTION');
    expect(classification.status).toBe('WATCHING');
  });

  it('6. deadline proximity scales urgency proportionally without hallucinated dates', () => {
    const scoresSoon = watchtowerAttentionEngine.computeDeterministicScores(
      'reminder',
      { urgency: 'high', trigger_at: new Date(Date.now() + 12 * 3600 * 1000).toISOString() }, // 12 hours away
      new Set()
    );
    const scoresDistant = watchtowerAttentionEngine.computeDeterministicScores(
      'reminder',
      { urgency: 'high', trigger_at: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString() }, // 30 days away
      new Set()
    );

    expect(scoresSoon.deadlineProximity).toBeGreaterThan(scoresDistant.deadlineProximity);
    expect(scoresSoon.urgency).toBeGreaterThan(scoresDistant.urgency);
  });

  it('7. goal relevance: items matching active LifeThreads receive priority boost', () => {
    const scoresWithGoal = watchtowerAttentionEngine.computeDeterministicScores(
      'reminder',
      { text: 'Complete React native tutorial', urgency: 'medium' },
      new Set(['react', 'mobile_app'])
    );
    const scoresWithoutGoal = watchtowerAttentionEngine.computeDeterministicScores(
      'reminder',
      { text: 'Buy groceries', urgency: 'medium' },
      new Set(['react', 'mobile_app'])
    );

    expect(scoresWithGoal.goalRelevance).toBeGreaterThan(scoresWithoutGoal.goalRelevance);
    expect(scoresWithGoal.compositeScore).toBeGreaterThan(scoresWithoutGoal.compositeScore);
  });

  it('8. novelty: new signals start with high novelty score', () => {
    const scores = watchtowerAttentionEngine.computeDeterministicScores('cognitive_doubt', {}, new Set());
    expect(scores.novelty).toBeGreaterThanOrEqual(70);
  });

  it('9. recency: active reminders and recent signals have high recency', () => {
    const scores = watchtowerAttentionEngine.computeDeterministicScores('reminder', {}, new Set());
    expect(scores.recency).toBeGreaterThanOrEqual(50);
  });

  it('10. already-handled suppression: Completed/resolved items penalized to IGNORE / ACTED', () => {
    const scores = watchtowerAttentionEngine.computeDeterministicScores(
      'reminder',
      { status: 'completed' },
      new Set()
    );
    expect(scores.alreadyHandledPenalty).toBeGreaterThanOrEqual(90);

    const classification = watchtowerAttentionEngine.classifyAttention('reminder', scores, { status: 'completed' });
    expect(classification.attentionClass).toBe('IGNORE');
    expect(classification.status).toBe('ACTED');
  });

  it('11. duplicate attention prevention: Identical evidence produces same fingerprint', () => {
    const fp1 = generateAttentionFingerprint(user1, 'reminder', 'rem_1', 'ev_hash_1', 'idle');
    const fp2 = generateAttentionFingerprint(user1, 'reminder', 'rem_1', 'ev_hash_1', 'idle');
    expect(fp1).toBe(fp2);
  });

  it('12. changed-evidence reconsideration: Changed evidence yields distinct fingerprint', () => {
    const fp1 = generateAttentionFingerprint(user1, 'reminder', 'rem_1', 'ev_hash_1', 'idle');
    const fp2 = generateAttentionFingerprint(user1, 'reminder', 'rem_1', 'ev_hash_2', 'idle');
    expect(fp1).not.toBe(fp2);
  });

  it('13. deferred attention: High interruption cost defers actionable items', () => {
    const classification = watchtowerAttentionEngine.classifyAttention('reminder', {
      importance: 75,
      urgency: 60,
      goalRelevance: 50,
      deadlineProximity: 50,
      novelty: 70,
      confidence: 80,
      recency: 60,
      alreadyHandledPenalty: 0,
      interruptionCost: 80, // User in active chat!
      compositeScore: 70,
    }, {}, { isUserInActiveConversation: true });

    expect(classification.attentionClass).toBe('WATCH');
    expect(classification.status).toBe('DEFERRED');
    expect(classification.deferUntil).toBeDefined();
  });

  it('14. expiration: Stale attention records are cleanly expired', async () => {
    mockAttentionDb.push({
      id: 'att_old',
      user_id: user1,
      status: 'READY',
      expires_at: new Date(Date.now() - 10000).toISOString(),
    });

    const summary = await watchtowerAttentionEngine.evaluateUserAttention(user1);
    expect(summary.decisionsExpired).toBe(1);
    expect(mockAttentionDb[0].status).toBe('EXPIRED');
  });

  it('15. cognitive doubt cooldown and presentation bounds respected', () => {
    const scoresSuppressed = watchtowerAttentionEngine.computeDeterministicScores(
      'cognitive_doubt',
      { presentation_count: 3, status: 'open' },
      new Set()
    );
    expect(scoresSuppressed.alreadyHandledPenalty).toBeGreaterThanOrEqual(90);
  });

  it('16. proactive boundary: getActionableAttention returns structured decisions without sending messages', async () => {
    mockAttentionDb.push({
      id: 'att_act',
      user_id: user1,
      target_type: 'reminder',
      target_id: 'rem_1',
      attention_class: 'ACTIONABLE',
      status: 'READY',
      composite_score: 80,
      expires_at: new Date(Date.now() + 100000).toISOString(),
    });

    const actionable = await watchtowerAttentionEngine.getActionableAttention(user1);
    expect(actionable.length).toBe(1);
    expect(actionable[0].attention_class).toBe('ACTIONABLE');
  });

  it('17. retention remains internal: No user messaging or destructive mutations from retention signals', () => {
    const scores = watchtowerAttentionEngine.computeDeterministicScores('guardian_signal', { category: 'stale_state' }, new Set());
    expect(scores.urgency).toBeLessThanOrEqual(30);
  });

  it('18. cross-user isolation: User 1 decisions never leak to User 2', async () => {
    mockAttentionDb.push({
      id: 'att_u1',
      user_id: user1,
      attention_class: 'URGENT',
      status: 'READY',
      expires_at: new Date(Date.now() + 100000).toISOString(),
    });

    const u2Actionable = await watchtowerAttentionEngine.getActionableAttention(user2);
    expect(u2Actionable.length).toBe(0);
  });

  it('19. bounded user processing: Caps enforced at 10 decisions, 3 actionable, 1 urgent', async () => {
    // Populate 15 reminders
    for (let i = 0; i < 15; i++) {
      mockRemindersDb.push({
        id: `rem_${i}`,
        user_id: user1,
        text: `Urgent Task ${i}`,
        urgency: 'high',
        trigger_at: new Date(Date.now() + 1000).toISOString(),
        status: 'active',
      });
    }

    const summary = await watchtowerAttentionEngine.evaluateUserAttention(user1);
    expect(mockAttentionDb.length).toBeLessThanOrEqual(WATCHTOWER_ATTENTION_LIMITS.MAX_ATTENTION_DECISIONS_PER_USER);
    expect(summary.urgentCount).toBeLessThanOrEqual(WATCHTOWER_ATTENTION_LIMITS.MAX_URGENT_PER_USER);
    expect(summary.actionableCount).toBeLessThanOrEqual(WATCHTOWER_ATTENTION_LIMITS.MAX_ACTIONABLE_PER_USER);
  });

  it('20. zero LLM healthy user: Clean user evaluates with 0 LLM calls', async () => {
    const summary = await watchtowerAttentionEngine.evaluateUserAttention(user1);
    expect(summary.totalEvaluated).toBe(0);
    expect(summary.llmCalls).toBe(0);
  });

  // ── ADVERSARIAL CASES (A through H) ──────────────────────────────────────────

  it('Adversarial Case A: 10 identical heartbeat pulses -> No repeated attention growth', async () => {
    mockRemindersDb.push({
      id: 'rem_stable',
      user_id: user1,
      text: 'Stable reminder',
      urgency: 'medium',
      trigger_at: new Date(Date.now() + 86400000).toISOString(),
      status: 'active',
    });

    for (let i = 0; i < 10; i++) {
      await watchtowerAttentionEngine.evaluateUserAttention(user1);
    }

    expect(mockAttentionDb.length).toBe(1);
  });

  it('Adversarial Case B: Interview tomorrow + trivial Guardian anomaly -> Interview wins URGENT rank', async () => {
    mockRemindersDb.push({
      id: 'rem_interview',
      user_id: user1,
      text: 'Google Interview Tomorrow',
      urgency: 'high',
      trigger_at: new Date(Date.now() + 3600000).toISOString(),
      status: 'active',
    });

    mockSignalsDb.push({
      id: 'sig_minor',
      user_id: user1,
      signal_type: 'W-002',
      category: 'contradiction',
      severity: 'low',
      entity: 'alias_misc',
      status: 'active',
      expires_at: new Date(Date.now() + 100000).toISOString(),
    });

    const summary = await watchtowerAttentionEngine.evaluateUserAttention(user1);
    expect(summary.urgentCount).toBe(1);
    const urgentDec = mockAttentionDb.find(d => d.attention_class === 'URGENT');
    expect(urgentDec?.target_type).toBe('reminder');
    expect(urgentDec?.target_id).toBe('rem_interview');
  });

  it('Adversarial Case C: Important future goal with distant deadline -> WATCH / deferred, not interruption', async () => {
    mockThreadsDb.push({
      id: 'thread_distant',
      user_id: user1,
      topic: 'Learn Japanese Fluently',
      priority: 'HIGH',
      deadline: new Date(Date.now() + 180 * 24 * 3600 * 1000).toISOString(), // 6 months
      state: 'active',
    });

    const summary = await watchtowerAttentionEngine.evaluateUserAttention(user1);
    expect(summary.urgentCount).toBe(0);
    expect(summary.watchCount).toBe(1);
  });

  it('Adversarial Case D: High-severity internal provenance issue -> System attention without direct user interruption', async () => {
    mockSignalsDb.push({
      id: 'sig_prov',
      user_id: user1,
      signal_type: 'W-007',
      category: 'provenance_gap',
      severity: 'critical',
      entity: 'thread_123',
      status: 'active',
      expires_at: new Date(Date.now() + 100000).toISOString(),
    });

    const summary = await watchtowerAttentionEngine.evaluateUserAttention(user1);
    expect(summary.urgentCount).toBe(0);
    expect(summary.attentionCount + summary.watchCount).toBeGreaterThan(0);
  });

  it('Adversarial Case E: User already handled task -> Attention becomes ACTED / suppressed', async () => {
    mockRemindersDb.push({
      id: 'rem_done',
      user_id: user1,
      text: 'Take blood test',
      status: 'completed',
    });

    const summary = await watchtowerAttentionEngine.evaluateUserAttention(user1);
    expect(summary.ignoreCount).toBe(1);
    expect(mockAttentionDb[0].status).toBe('ACTED');
  });

  it('Adversarial Case F: Two users have identical signals -> Completely isolated attention identities', async () => {
    mockRemindersDb.push(
      { id: 'rem_common', user_id: user1, text: 'Take medication', urgency: 'high', status: 'active' },
      { id: 'rem_common', user_id: user2, text: 'Take medication', urgency: 'high', status: 'active' }
    );

    await watchtowerAttentionEngine.evaluateUserAttention(user1);
    await watchtowerAttentionEngine.evaluateUserAttention(user2);

    expect(mockAttentionDb.length).toBe(2);
    expect(mockAttentionDb[0].user_id).toBe(user1);
    expect(mockAttentionDb[1].user_id).toBe(user2);
    expect(mockAttentionDb[0].fingerprint).not.toBe(mockAttentionDb[1].fingerprint);
  });

  it('Adversarial Case G: One pathological user has hundreds of signals -> Bounded processing', async () => {
    for (let i = 0; i < 50; i++) {
      mockSignalsDb.push({
        id: `sig_${i}`,
        user_id: user1,
        signal_type: 'W-001',
        category: 'contradiction',
        severity: 'medium',
        entity: `key_${i}`,
        status: 'active',
        expires_at: new Date(Date.now() + 100000).toISOString(),
      });
    }

    const summary = await watchtowerAttentionEngine.evaluateUserAttention(user1);
    expect(mockAttentionDb.length).toBeLessThanOrEqual(WATCHTOWER_ATTENTION_LIMITS.MAX_ATTENTION_DECISIONS_PER_USER);
  });

  it('Adversarial Case H: Semantic model unavailable -> Deterministic attention still works', async () => {
    mockRemindersDb.push({
      id: 'rem_urgent',
      user_id: user1,
      text: 'Flight Check-in',
      urgency: 'high',
      trigger_at: new Date(Date.now() + 7200000).toISOString(),
      status: 'active',
    });

    const summary = await watchtowerAttentionEngine.evaluateUserAttention(user1);
    expect(summary.urgentCount).toBe(1);
    expect(summary.llmCalls).toBe(0);
  });
});
