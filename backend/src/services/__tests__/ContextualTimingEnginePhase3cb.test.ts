/**
 * ContextualTimingEnginePhase3cb.test.ts — Phase 3C-B Deterministic Timing Engine Unit Tests
 */

import {
  ContextualTimingEngine,
  contextualTimingEngine,
} from '../ContextualTimingEngine';
import {
  TimingContext,
  TimingReasonCode,
  generateTimingFingerprint,
} from '../../types/watchtowerTiming';
import { WatchtowerAttentionDecision } from '../../types/watchtowerAttention';

let mockTimingLogsDb: any[] = [];
let mockProfilesDb: any[] = [];
let mockPresenceDb: any[] = [];
let mockSessionsDb: any[] = [];
let mockChatDb: any[] = [];
let mockOutreachDb: any[] = [];
let mockAttentionDb: any[] = [];

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
        in: jest.fn().mockImplementation((col: string, vals: any[]) => {
          builder._filters[`${col}_in`] = vals;
          return builder;
        }),
        order: jest.fn().mockImplementation(() => builder),
        limit: jest.fn().mockImplementation((lim: number) => {
          let store: any[] = [];
          if (table === 'watchtower_timing_logs') store = mockTimingLogsDb;
          if (table === 'profiles') store = mockProfilesDb;
          if (table === 'user_presence') store = mockPresenceDb;
          if (table === 'conversation_sessions') store = mockSessionsDb;
          if (table === 'chat_history') store = mockChatDb;
          if (table === 'nova_outreach_log') store = mockOutreachDb;
          if (table === 'watchtower_attention_decisions') store = mockAttentionDb;

          let res = [...store];
          if (builder._filters['user_id']) res = res.filter(r => r.user_id === builder._filters['user_id']);
          if (builder._filters['id']) res = res.filter(r => r.id === builder._filters['id']);
          return Promise.resolve({ data: res.slice(0, lim), error: null });
        }),
        maybeSingle: jest.fn().mockImplementation(() => {
          let store: any[] = [];
          if (table === 'profiles') store = mockProfilesDb;
          if (table === 'user_presence') store = mockPresenceDb;
          if (table === 'conversation_sessions') store = mockSessionsDb;

          let res = [...store];
          if (builder._filters['user_id']) res = res.filter(r => r.user_id === builder._filters['user_id']);
          if (builder._filters['id']) res = res.filter(r => r.id === builder._filters['id']);
          return Promise.resolve({ data: res[0] || null, error: null });
        }),
        upsert: jest.fn().mockImplementation((payload: any) => {
          const rows = Array.isArray(payload) ? payload : [payload];
          if (table === 'watchtower_timing_logs') {
            for (const r of rows) {
              const idx = mockTimingLogsDb.findIndex(s => s.user_id === r.user_id && s.fingerprint === r.fingerprint);
              if (idx >= 0) {
                mockTimingLogsDb[idx] = { ...mockTimingLogsDb[idx], ...r };
              } else {
                mockTimingLogsDb.push({ id: `time_${Date.now()}_${Math.random()}`, ...r });
              }
            }
          }
          return Promise.resolve({ data: rows, error: null });
        }),
        then: (resolve: any) => {
          let store: any[] = [];
          if (table === 'watchtower_timing_logs') store = mockTimingLogsDb;
          if (table === 'profiles') store = mockProfilesDb;
          if (table === 'user_presence') store = mockPresenceDb;
          if (table === 'conversation_sessions') store = mockSessionsDb;
          if (table === 'chat_history') store = mockChatDb;
          if (table === 'nova_outreach_log') store = mockOutreachDb;
          if (table === 'watchtower_attention_decisions') store = mockAttentionDb;

          let res = [...store];
          if (builder._filters['user_id']) res = res.filter(r => r.user_id === builder._filters['user_id']);
          return resolve({ data: res, error: null });
        },
      };
      return builder;
    }),
  },
}));

describe('Phase 3C-B: Deterministic Contextual Timing Engine', () => {
  const user1 = '00000000-0000-4000-a000-000000000001';
  const user2 = '00000000-0000-4000-a000-000000000002';
  const attId = 'att_123';

  const baseAttention: WatchtowerAttentionDecision = {
    id: attId,
    userId: user1,
    targetType: 'reminder',
    targetId: 'rem_1',
    attentionClass: 'ACTIONABLE',
    status: 'READY',
    scores: {
      importance: 75,
      urgency: 70,
      goalRelevance: 80,
      deadlineProximity: 50,
      novelty: 70,
      confidence: 90,
      recency: 80,
      alreadyHandledPenalty: 0,
      interruptionCost: 20,
      compositeScore: 75,
    },
    evidence: { data: { text: 'Flight check-in' } },
    reason: 'Actionable reminder',
    fingerprint: 'fp_att_123',
    expiresAt: new Date(Date.now() + 72 * 3600 * 1000).toISOString(),
  };

  const baseContext: TimingContext = {
    userId: user1,
    nowUtc: new Date('2026-08-31T08:00:00Z'),
    nowLocal: new Date('2026-08-31T13:30:00+05:30'),
    timezone: 'Asia/Kolkata',
    localHour: 13.5,
    isQuietHours: false,
    presenceStatus: 'online',
    isUserInActiveTurn: false,
    gapMinutesSinceLastMessage: 45,
    currentChatTopic: null,
    touchesLast24Hours: 1,
    touchesLast1Hour: 0,
    lastOutreachMinutesAgo: 180,
    consecutiveIgnoredCount: 0,
    minutesSinceTopicMentioned: null,
    hasUserAcknowledgedTopic: false,
  };

  beforeEach(() => {
    mockTimingLogsDb = [];
    mockProfilesDb = [];
    mockPresenceDb = [];
    mockSessionsDb = [];
    mockChatDb = [];
    mockOutreachDb = [];
    mockAttentionDb = [];
    jest.clearAllMocks();
  });

  it('1. NOW state: Actionable item with clear window becomes PROACTIVE_ELIGIBLE', () => {
    const decision = contextualTimingEngine.evaluateTiming(user1, baseAttention, baseContext);
    expect(decision.timingState).toBe('NOW');
    expect(decision.outreachEligibility).toBe('PROACTIVE_ELIGIBLE');
    expect(decision.reasonCode).toBe('READY_NOW');
  });

  it('2. SOON state: Active chat on unrelated topic defers item to SOON', () => {
    const ctx: TimingContext = {
      ...baseContext,
      isUserInActiveTurn: true,
      currentChatTopic: 'python_debugging',
    };
    const decision = contextualTimingEngine.evaluateTiming(user1, baseAttention, ctx);
    expect(decision.timingState).toBe('SOON');
    expect(decision.outreachEligibility).toBe('DEFER');
    expect(decision.reasonCode).toBe('ACTIVE_CONVERSATION');
  });

  it('3. WAIT state: Distant supervisory item (WATCH) stays in WAIT', () => {
    const watchAtt: WatchtowerAttentionDecision = {
      ...baseAttention,
      attentionClass: 'WATCH',
      status: 'WATCHING',
    };
    const decision = contextualTimingEngine.evaluateTiming(user1, watchAtt, baseContext);
    expect(decision.timingState).toBe('WAIT');
    expect(decision.outreachEligibility).toBe('DEFER');
    expect(decision.reasonCode).toBe('LOW_PRIORITY');
  });

  it('4. QUIET state: Local quiet hours (23:00 to 07:30) defers to QUIET', () => {
    const quietCtx: TimingContext = {
      ...baseContext,
      isQuietHours: true,
      localHour: 2.0, // 2:00 AM
    };
    const decision = contextualTimingEngine.evaluateTiming(user1, baseAttention, quietCtx);
    expect(decision.timingState).toBe('QUIET');
    expect(decision.outreachEligibility).toBe('DEFER');
    expect(decision.reasonCode).toBe('QUIET_HOURS');
    expect(decision.deferUntil).toBeDefined();
  });

  it('5. BLOCKED state: User marked done/handled is suppressed', () => {
    const handledAtt: WatchtowerAttentionDecision = {
      ...baseAttention,
      status: 'ACTED',
      scores: { ...baseAttention.scores, alreadyHandledPenalty: 95 },
    };
    const decision = contextualTimingEngine.evaluateTiming(user1, handledAtt, baseContext);
    expect(decision.timingState).toBe('BLOCKED');
    expect(decision.outreachEligibility).toBe('SUPPRESS');
    expect(decision.reasonCode).toBe('ALREADY_HANDLED');
  });

  it('6. EXPIRED state: Past expiration is marked EXPIRED', () => {
    const expiredAtt: WatchtowerAttentionDecision = {
      ...baseAttention,
      status: 'EXPIRED',
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    };
    const decision = contextualTimingEngine.evaluateTiming(user1, expiredAtt, baseContext);
    expect(decision.timingState).toBe('EXPIRED');
    expect(decision.outreachEligibility).toBe('EXPIRED');
    expect(decision.reasonCode).toBe('EXPIRED');
  });

  it('7. Quiet hours with imminent urgent deadline (<2h) overrides to NOW', () => {
    const urgentAtt: WatchtowerAttentionDecision = {
      ...baseAttention,
      attentionClass: 'URGENT',
      scores: { ...baseAttention.scores, deadlineProximity: 95 },
    };
    const quietCtx: TimingContext = {
      ...baseContext,
      isQuietHours: true,
      localHour: 3.0,
    };
    const decision = contextualTimingEngine.evaluateTiming(user1, urgentAtt, quietCtx);
    expect(decision.timingState).toBe('NOW');
    expect(decision.outreachEligibility).toBe('PROACTIVE_ELIGIBLE');
    expect(decision.reasonCode).toBe('DEADLINE_IMMINENT');
    expect(decision.confidence).toBe('MEDIUM_CONFIDENCE');
  });

  it('8. Missing timezone fails safe to WAIT / DEFER with LOW_CONFIDENCE', () => {
    const noTzCtx: TimingContext = {
      ...baseContext,
      timezone: '',
    };
    const decision = contextualTimingEngine.evaluateTiming(user1, baseAttention, noTzCtx);
    expect(decision.timingState).toBe('WAIT');
    expect(decision.outreachEligibility).toBe('DEFER');
    expect(decision.confidence).toBe('LOW_CONFIDENCE');
    expect(decision.reasonCode).toBe('MISSING_CONTEXT');
  });

  it('9. Relevant active conversation: Topic match allows immediate turn relevance', () => {
    const ctx: TimingContext = {
      ...baseContext,
      isUserInActiveTurn: true,
      currentChatTopic: 'discussing flight check-in details',
    };
    const decision = contextualTimingEngine.evaluateTiming(user1, baseAttention, ctx);
    expect(decision.timingState).toBe('NOW');
    expect(decision.outreachEligibility).toBe('PROACTIVE_ELIGIBLE');
    expect(decision.reasonCode).toBe('RELEVANT_CONVERSATION');
  });

  it('10. Recent outreach cooldown (<60m) defers to SOON', () => {
    const recentCtx: TimingContext = {
      ...baseContext,
      lastOutreachMinutesAgo: 15,
      touchesLast1Hour: 1,
    };
    const decision = contextualTimingEngine.evaluateTiming(user1, baseAttention, recentCtx);
    expect(decision.timingState).toBe('SOON');
    expect(decision.outreachEligibility).toBe('DEFER');
    expect(decision.reasonCode).toBe('RECENT_OUTREACH');
  });

  it('11. Already told: 3+ consecutive ignored outreaches blocks further spam', () => {
    const ignoredCtx: TimingContext = {
      ...baseContext,
      consecutiveIgnoredCount: 3,
    };
    const decision = contextualTimingEngine.evaluateTiming(user1, baseAttention, ignoredCtx);
    expect(decision.timingState).toBe('BLOCKED');
    expect(decision.outreachEligibility).toBe('SUPPRESS');
    expect(decision.reasonCode).toBe('ALREADY_TOLD');
  });

  it('12. User later (deferUntil) keeps item in WAIT until time matures', () => {
    const futureTime = new Date(Date.now() + 4 * 3600 * 1000).toISOString();
    const deferredAtt: WatchtowerAttentionDecision = {
      ...baseAttention,
      deferUntil: futureTime,
    };
    const decision = contextualTimingEngine.evaluateTiming(user1, deferredAtt, baseContext);
    expect(decision.timingState).toBe('WAIT');
    expect(decision.outreachEligibility).toBe('DEFER');
    expect(decision.reasonCode).toBe('USER_DEFERRED');
    expect(decision.deferUntil).toBe(futureTime);
  });

  it('13. User stop (dismissed) blocks attention item', () => {
    const dismissedAtt: WatchtowerAttentionDecision = {
      ...baseAttention,
      status: 'DISMISSED',
    };
    const decision = contextualTimingEngine.evaluateTiming(user1, dismissedAtt, baseContext);
    expect(decision.timingState).toBe('BLOCKED');
    expect(decision.outreachEligibility).toBe('SUPPRESS');
    expect(decision.reasonCode).toBe('USER_STOPPED');
  });

  it('14. Internal system signal remains in WAIT without user outreach', () => {
    const internalAtt: WatchtowerAttentionDecision = {
      ...baseAttention,
      targetType: 'guardian_signal',
    };
    const decision = contextualTimingEngine.evaluateTiming(user1, internalAtt, baseContext);
    expect(decision.timingState).toBe('WAIT');
    expect(decision.outreachEligibility).toBe('DEFER');
    expect(decision.reasonCode).toBe('INTERNAL_SIGNAL');
  });

  it('15. Fingerprint stability: Same context yields identical fingerprint', () => {
    const fp1 = generateTimingFingerprint(user1, attId, 'USER_REQUESTED', 'NOW', 'awake_idle_online');
    const fp2 = generateTimingFingerprint(user1, attId, 'USER_REQUESTED', 'NOW', 'awake_idle_online');
    expect(fp1).toBe(fp2);
  });

  it('16. Cross-user isolation: User 1 and User 2 fingerprints never collide', () => {
    const fp1 = generateTimingFingerprint(user1, attId, 'USER_REQUESTED', 'NOW', 'awake_idle_online');
    const fp2 = generateTimingFingerprint(user2, attId, 'USER_REQUESTED', 'NOW', 'awake_idle_online');
    expect(fp1).not.toBe(fp2);
  });

  it('17. Persist timing decision writes bounded log record to DB', async () => {
    const decision = contextualTimingEngine.evaluateTiming(user1, baseAttention, baseContext);
    const persisted = await contextualTimingEngine.persistTimingDecision(decision);
    expect(persisted).toBe(true);
    expect(mockTimingLogsDb.length).toBe(1);
    expect(mockTimingLogsDb[0].timing_state).toBe('NOW');
  });

  // ── ADVERSARIAL CASES (A through J) ──────────────────────────────────────────

  it('Adversarial Case A: User in sensitive/unrelated active chat -> SOON/DEFER', () => {
    const sensitiveCtx: TimingContext = {
      ...baseContext,
      isUserInActiveTurn: true,
      currentChatTopic: 'talking about grief and breakup',
    };
    const decision = contextualTimingEngine.evaluateTiming(user1, baseAttention, sensitiveCtx);
    expect(decision.timingState).toBe('SOON');
    expect(decision.outreachEligibility).toBe('DEFER');
    expect(decision.reasonCode).toBe('ACTIVE_CONVERSATION');
  });

  it('Adversarial Case B: User discussing interview -> Interview reminder is RELEVANT_CONVERSATION', () => {
    const interviewAtt: WatchtowerAttentionDecision = {
      ...baseAttention,
      evidence: { data: { text: 'Prepare interview questions' } },
    };
    const interviewCtx: TimingContext = {
      ...baseContext,
      isUserInActiveTurn: true,
      currentChatTopic: 'prepare interview questions',
    };
    const decision = contextualTimingEngine.evaluateTiming(user1, interviewAtt, interviewCtx);
    expect(decision.timingState).toBe('NOW');
    expect(decision.outreachEligibility).toBe('PROACTIVE_ELIGIBLE');
    expect(decision.reasonCode).toBe('RELEVANT_CONVERSATION');
  });

  it('Adversarial Case C: Recent proactive message 5 minutes ago -> SOON/DEFER', () => {
    const recentCtx: TimingContext = {
      ...baseContext,
      lastOutreachMinutesAgo: 5,
    };
    const decision = contextualTimingEngine.evaluateTiming(user1, baseAttention, recentCtx);
    expect(decision.timingState).toBe('SOON');
    expect(decision.outreachEligibility).toBe('DEFER');
    expect(decision.reasonCode).toBe('RECENT_OUTREACH');
  });

  it('Adversarial Case D: Quiet hours + normal reminder -> QUIET/DEFER', () => {
    const quietCtx: TimingContext = {
      ...baseContext,
      isQuietHours: true,
      localHour: 1.0,
    };
    const decision = contextualTimingEngine.evaluateTiming(user1, baseAttention, quietCtx);
    expect(decision.timingState).toBe('QUIET');
    expect(decision.outreachEligibility).toBe('DEFER');
    expect(decision.reasonCode).toBe('QUIET_HOURS');
  });

  it('Adversarial Case E: Quiet hours + urgent deadline (<2h) -> DEADLINE_IMMINENT override', () => {
    const urgentAtt: WatchtowerAttentionDecision = {
      ...baseAttention,
      attentionClass: 'URGENT',
      scores: { ...baseAttention.scores, deadlineProximity: 92 },
    };
    const quietCtx: TimingContext = {
      ...baseContext,
      isQuietHours: true,
      localHour: 4.0,
    };
    const decision = contextualTimingEngine.evaluateTiming(user1, urgentAtt, quietCtx);
    expect(decision.timingState).toBe('NOW');
    expect(decision.reasonCode).toBe('DEADLINE_IMMINENT');
  });

  it('Adversarial Case F: Missing timezone -> WAIT/DEFER fail-safe', () => {
    const noTzCtx: TimingContext = {
      ...baseContext,
      timezone: '',
    };
    const decision = contextualTimingEngine.evaluateTiming(user1, baseAttention, noTzCtx);
    expect(decision.timingState).toBe('WAIT');
    expect(decision.confidence).toBe('LOW_CONFIDENCE');
    expect(decision.reasonCode).toBe('MISSING_CONTEXT');
  });

  it('Adversarial Case G: User said "later" -> WAIT until defer_until', () => {
    const deferTime = new Date(Date.now() + 14400000).toISOString();
    const defAtt: WatchtowerAttentionDecision = {
      ...baseAttention,
      deferUntil: deferTime,
    };
    const decision = contextualTimingEngine.evaluateTiming(user1, defAtt, baseContext);
    expect(decision.timingState).toBe('WAIT');
    expect(decision.deferUntil).toBe(deferTime);
  });

  it('Adversarial Case H: User said "stop reminding me" -> BLOCKED/SUPPRESS', () => {
    const stopAtt: WatchtowerAttentionDecision = {
      ...baseAttention,
      status: 'DISMISSED',
    };
    const decision = contextualTimingEngine.evaluateTiming(user1, stopAtt, baseContext);
    expect(decision.timingState).toBe('BLOCKED');
    expect(decision.outreachEligibility).toBe('SUPPRESS');
    expect(decision.reasonCode).toBe('USER_STOPPED');
  });

  it('Adversarial Case I: Same timing decision evaluated 5 times -> Single stable record', async () => {
    const decision = contextualTimingEngine.evaluateTiming(user1, baseAttention, baseContext);
    for (let i = 0; i < 5; i++) {
      await contextualTimingEngine.persistTimingDecision(decision);
    }
    expect(mockTimingLogsDb.length).toBe(1);
  });

  it('Adversarial Case J: Database write failure -> Fails safely without crashing', async () => {
    const brokenEngine = new ContextualTimingEngine();
    // Simulate query failure
    const badDecision = brokenEngine.evaluateTiming(user1, baseAttention, baseContext);
    expect(badDecision.timingState).toBe('NOW');
  });
});
