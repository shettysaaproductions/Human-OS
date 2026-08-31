/**
 * UniversalBurdenEnginePhase3cc.test.ts — Phase 3C-C Universal Burden Engine Unit Tests
 */

import {
  UniversalBurdenEngine,
  universalBurdenEngine,
} from '../UniversalBurdenEngine';
import {
  UserBurdenContext,
  UNIVERSAL_BURDEN_LIMITS,
} from '../../types/universalBurden';

let mockOutreachDb: any[] = [];
let mockChatDb: any[] = [];

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
        gte: jest.fn().mockImplementation((col: string, val: any) => {
          builder._filters[`${col}_gte`] = val;
          return builder;
        }),
        order: jest.fn().mockImplementation(() => builder),
        limit: jest.fn().mockImplementation((lim: number) => {
          builder._limit = lim;
          return builder;
        }),
        maybeSingle: jest.fn().mockImplementation(() => {
          let store: any[] = [];
          if (table === 'chat_history') store = mockChatDb;
          if (table === 'nova_outreach_log') store = mockOutreachDb;
          let res = [...store];
          if (builder._filters['user_id']) res = res.filter(r => r.user_id === builder._filters['user_id']);
          return Promise.resolve({ data: res[0] || null, error: null });
        }),
        insert: jest.fn().mockImplementation((payload: any) => {
          const rows = Array.isArray(payload) ? payload : [payload];
          if (table === 'nova_outreach_log') {
            for (const r of rows) {
              mockOutreachDb.unshift({ id: `out_${Date.now()}_${Math.random()}`, ...r });
            }
          }
          return Promise.resolve({ data: rows, error: null });
        }),
        then: (resolve: any) => {
          let store: any[] = [];
          if (table === 'nova_outreach_log') store = mockOutreachDb;
          if (table === 'chat_history') store = mockChatDb;

          let res = [...store];
          if (builder._filters['user_id']) res = res.filter(r => r.user_id === builder._filters['user_id']);
          if (builder._limit !== undefined) res = res.slice(0, builder._limit);
          return resolve({ data: res, error: null });
        },
      };
      return builder;
    }),
  },
}));

describe('Phase 3C-C: Universal User Burden Budget & Cooldown Unification', () => {
  const user1 = '00000000-0000-4000-a000-000000000001';
  const user2 = '00000000-0000-4000-a000-000000000002';

  beforeEach(() => {
    mockOutreachDb = [];
    mockChatDb = [];
    jest.clearAllMocks();
  });

  it('1. Global 24h and 1h touch accounting across multiple sources', async () => {
    const now = Date.now();
    mockOutreachDb = [
      {
        user_id: user1,
        outreach_type: 'agenda_followup',
        created_at: new Date(now - 30 * 60 * 1000).toISOString(), // 30m ago
      },
      {
        user_id: user1,
        outreach_type: 'engagement_checkin',
        created_at: new Date(now - 120 * 60 * 1000).toISOString(), // 2h ago
      },
      {
        user_id: user1,
        outreach_type: 'reminder',
        created_at: new Date(now - 300 * 60 * 1000).toISOString(), // 5h ago
      },
    ];

    const ctx = await universalBurdenEngine.getUserBurden(user1);
    expect(ctx.touchesLast24Hours).toBe(3);
    expect(ctx.touchesLast1Hour).toBe(1);
    expect(ctx.autonomousTouchesLast24Hours).toBe(2);
    expect(ctx.userRequestedTouchesLast24Hours).toBe(1);
  });

  it('2. User-requested touches bypass autonomous daily quota', async () => {
    const freshCtx: UserBurdenContext = {
      userId: user1,
      evaluatedAt: new Date().toISOString(),
      touchesLast24Hours: 2,
      touchesLast1Hour: 0,
      autonomousTouchesLast24Hours: 2,
      autonomousTouchesLast1Hour: 0,
      clarificationsLast24Hours: 0,
      userRequestedTouchesLast24Hours: 0,
      lastAutonomousTouchAt: new Date(Date.now() - 3 * 3600 * 1000).toISOString(),
      lastTouchAt: new Date(Date.now() - 3 * 3600 * 1000).toISOString(),
      consecutiveIgnoredCount: 0,
      activeTopicsInFlight: [],
    };

    const decision = await universalBurdenEngine.evaluateBurden(user1, 'USER_REQUESTED', {}, freshCtx);
    expect(decision.decision).toBe('ALLOW');
    expect(decision.reasonCode).toBe('USER_REQUESTED_ALLOWED');
  });

  it('3. Autonomous touches enforce 24h cap (Max 3)', async () => {
    const exhaustedCtx: UserBurdenContext = {
      userId: user1,
      evaluatedAt: new Date().toISOString(),
      touchesLast24Hours: 3,
      touchesLast1Hour: 0,
      autonomousTouchesLast24Hours: 3,
      autonomousTouchesLast1Hour: 0,
      clarificationsLast24Hours: 0,
      userRequestedTouchesLast24Hours: 0,
      lastAutonomousTouchAt: new Date(Date.now() - 3 * 3600 * 1000).toISOString(),
      lastTouchAt: new Date(Date.now() - 3 * 3600 * 1000).toISOString(),
      consecutiveIgnoredCount: 0,
      activeTopicsInFlight: [],
    };

    const decision = await universalBurdenEngine.evaluateBurden(user1, 'AUTONOMOUS_PROACTIVE', {}, exhaustedCtx);
    expect(decision.decision).toBe('SUPPRESS');
    expect(decision.reasonCode).toBe('DAILY_BUDGET_EXHAUSTED');
  });

  it('4. Autonomous touches enforce 1h cap (Max 1)', async () => {
    const hourlyExhaustedCtx: UserBurdenContext = {
      userId: user1,
      evaluatedAt: new Date().toISOString(),
      touchesLast24Hours: 1,
      touchesLast1Hour: 1,
      autonomousTouchesLast24Hours: 1,
      autonomousTouchesLast1Hour: 1,
      clarificationsLast24Hours: 0,
      userRequestedTouchesLast24Hours: 0,
      lastAutonomousTouchAt: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
      lastTouchAt: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
      consecutiveIgnoredCount: 0,
      activeTopicsInFlight: [],
    };

    const decision = await universalBurdenEngine.evaluateBurden(user1, 'AUTONOMOUS_PROACTIVE', {}, hourlyExhaustedCtx);
    expect(decision.decision).toBe('DEFER');
    expect(decision.reasonCode).toBe('HOURLY_BUDGET_EXHAUSTED');
  });

  it('5. Cognitive clarification enforces strict 1/day quota', async () => {
    const doubtCtx: UserBurdenContext = {
      userId: user1,
      evaluatedAt: new Date().toISOString(),
      touchesLast24Hours: 1,
      touchesLast1Hour: 0,
      autonomousTouchesLast24Hours: 1,
      autonomousTouchesLast1Hour: 0,
      clarificationsLast24Hours: 1,
      userRequestedTouchesLast24Hours: 0,
      lastAutonomousTouchAt: new Date(Date.now() - 4 * 3600 * 1000).toISOString(),
      lastTouchAt: new Date(Date.now() - 4 * 3600 * 1000).toISOString(),
      consecutiveIgnoredCount: 0,
      activeTopicsInFlight: [],
    };

    const decision = await universalBurdenEngine.evaluateBurden(user1, 'COGNITIVE_CLARIFICATION', {}, doubtCtx);
    expect(decision.decision).toBe('SUPPRESS');
    expect(decision.reasonCode).toBe('CLARIFICATION_LIMIT_REACHED');
  });

  it('6. Minimum autonomous gap (120 min) is strictly enforced', async () => {
    const minGapCtx: UserBurdenContext = {
      userId: user1,
      evaluatedAt: new Date().toISOString(),
      touchesLast24Hours: 1,
      touchesLast1Hour: 0,
      autonomousTouchesLast24Hours: 1,
      autonomousTouchesLast1Hour: 0,
      clarificationsLast24Hours: 0,
      userRequestedTouchesLast24Hours: 0,
      lastAutonomousTouchAt: new Date(Date.now() - 45 * 60 * 1000).toISOString(), // 45m ago (<120m)
      lastTouchAt: new Date(Date.now() - 45 * 60 * 1000).toISOString(),
      consecutiveIgnoredCount: 0,
      activeTopicsInFlight: [],
    };

    const decision = await universalBurdenEngine.evaluateBurden(user1, 'AUTONOMOUS_PROACTIVE', {}, minGapCtx);
    expect(decision.decision).toBe('DEFER');
    expect(decision.reasonCode).toBe('MIN_GAP_COOLDOWN');
    expect(decision.retryAfterMinutes).toBe(75);
  });

  it('7. Ignored outreach triggers escalating backoff (60 -> 180 -> 360 -> 720 min)', async () => {
    const ignoredCtx: UserBurdenContext = {
      userId: user1,
      evaluatedAt: new Date().toISOString(),
      touchesLast24Hours: 2,
      touchesLast1Hour: 0,
      autonomousTouchesLast24Hours: 2,
      autonomousTouchesLast1Hour: 0,
      clarificationsLast24Hours: 0,
      userRequestedTouchesLast24Hours: 0,
      lastAutonomousTouchAt: new Date(Date.now() - 130 * 60 * 1000).toISOString(), // 130m ago
      lastTouchAt: new Date(Date.now() - 130 * 60 * 1000).toISOString(),
      consecutiveIgnoredCount: 2, // 2 ignored -> 180 min required
      activeTopicsInFlight: [],
    };

    const decision = await universalBurdenEngine.evaluateBurden(user1, 'AUTONOMOUS_PROACTIVE', {}, ignoredCtx);
    expect(decision.decision).toBe('DEFER');
    expect(decision.reasonCode).toBe('IGNORED_BACKOFF_ACTIVE');
    expect(decision.retryAfterMinutes).toBe(50); // 180 - 130 = 50 min remaining
  });

  it('8. User stop (DISMISSED) suppresses outreach globally', async () => {
    const decision = await universalBurdenEngine.evaluateBurden(user1, 'AUTONOMOUS_PROACTIVE', {
      status: 'DISMISSED',
    });
    expect(decision.decision).toBe('SUPPRESS');
    expect(decision.reasonCode).toBe('USER_STOPPED');
  });

  it('9. User later (deferUntil) defers outreach globally', async () => {
    const futureTime = new Date(Date.now() + 3 * 3600 * 1000).toISOString();
    const decision = await universalBurdenEngine.evaluateBurden(user1, 'AUTONOMOUS_PROACTIVE', {
      deferUntil: futureTime,
    });
    expect(decision.decision).toBe('DEFER');
    expect(decision.reasonCode).toBe('USER_DEFERRED');
    expect(decision.deferUntil).toBe(futureTime);
  });

  it('10. Duplicate topic suppression: Multiple engines cannot deliver the same topic within 24h', async () => {
    const duplicateCtx: UserBurdenContext = {
      userId: user1,
      evaluatedAt: new Date().toISOString(),
      touchesLast24Hours: 1,
      touchesLast1Hour: 0,
      autonomousTouchesLast24Hours: 1,
      autonomousTouchesLast1Hour: 0,
      clarificationsLast24Hours: 0,
      userRequestedTouchesLast24Hours: 0,
      lastAutonomousTouchAt: new Date(Date.now() - 3 * 3600 * 1000).toISOString(),
      lastTouchAt: new Date(Date.now() - 3 * 3600 * 1000).toISOString(),
      consecutiveIgnoredCount: 0,
      activeTopicsInFlight: ['flight check-in', 'airline_ticket_123'],
    };

    const decision = await universalBurdenEngine.evaluateBurden(user1, 'AUTONOMOUS_PROACTIVE', {
      topic: 'flight check-in',
    }, duplicateCtx);

    expect(decision.decision).toBe('SUPPRESS');
    expect(decision.reasonCode).toBe('DUPLICATE_TOPIC');
  });

  it('11. Urgent override (<2h deadline) bypasses routine min-gap cooldown', async () => {
    const cooldownCtx: UserBurdenContext = {
      userId: user1,
      evaluatedAt: new Date().toISOString(),
      touchesLast24Hours: 1,
      touchesLast1Hour: 0,
      autonomousTouchesLast24Hours: 1,
      autonomousTouchesLast1Hour: 0,
      clarificationsLast24Hours: 0,
      userRequestedTouchesLast24Hours: 0,
      lastAutonomousTouchAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(), // 30m ago (<120m)
      lastTouchAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
      consecutiveIgnoredCount: 0,
      activeTopicsInFlight: [],
    };

    const decision = await universalBurdenEngine.evaluateBurden(user1, 'AUTONOMOUS_PROACTIVE', {
      isUrgent: true,
      deadlineMinutes: 45, // <120m
    }, cooldownCtx);

    expect(decision.decision).toBe('ALLOW');
    expect(decision.reasonCode).toBe('URGENT_OVERRIDE_ALLOWED');
  });

  it('12. Internal-only system signals consume 0 user-facing budget', async () => {
    const fullCtx: UserBurdenContext = {
      userId: user1,
      evaluatedAt: new Date().toISOString(),
      touchesLast24Hours: 5,
      touchesLast1Hour: 2,
      autonomousTouchesLast24Hours: 5,
      autonomousTouchesLast1Hour: 2,
      clarificationsLast24Hours: 1,
      userRequestedTouchesLast24Hours: 0,
      lastAutonomousTouchAt: new Date().toISOString(),
      lastTouchAt: new Date().toISOString(),
      consecutiveIgnoredCount: 3,
      activeTopicsInFlight: [],
    };

    const decision = await universalBurdenEngine.evaluateBurden(user1, 'SYSTEM_REQUIRED', {
      isInternalOnly: true,
    }, fullCtx);

    expect(decision.decision).toBe('ALLOW');
    expect(decision.reasonCode).toBe('INTERNAL_SIGNAL_ALLOWED');
  });

  it('13. Cross-user isolation: User 1 touches do not constrain User 2', async () => {
    mockOutreachDb = [
      {
        user_id: user1,
        outreach_type: 'agenda_followup',
        created_at: new Date().toISOString(),
      },
      {
        user_id: user1,
        outreach_type: 'agenda_followup',
        created_at: new Date().toISOString(),
      },
      {
        user_id: user1,
        outreach_type: 'agenda_followup',
        created_at: new Date().toISOString(),
      },
    ];

    const ctxUser1 = await universalBurdenEngine.getUserBurden(user1);
    const ctxUser2 = await universalBurdenEngine.getUserBurden(user2);

    expect(ctxUser1.autonomousTouchesLast24Hours).toBe(3);
    expect(ctxUser2.autonomousTouchesLast24Hours).toBe(0);

    const canUser1 = await universalBurdenEngine.canInitiateOutreach(user1, 'AUTONOMOUS_PROACTIVE');
    const canUser2 = await universalBurdenEngine.canInitiateOutreach(user2, 'AUTONOMOUS_PROACTIVE');

    expect(canUser1).toBe(false);
    expect(canUser2).toBe(true);
  });

  // ── ADVERSARIAL TESTS (A through I) ──────────────────────────────────────────

  it('Adversarial Test A: NACE sends 1 message -> ReminderEngine sees global count', async () => {
    mockOutreachDb = [
      {
        user_id: user1,
        outreach_type: 'agenda_followup',
        logical_key: 'nace:agenda_123',
        created_at: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
      },
    ];

    const ctx = await universalBurdenEngine.getUserBurden(user1);
    expect(ctx.touchesLast24Hours).toBe(1);
    expect(ctx.autonomousTouchesLast24Hours).toBe(1);
  });

  it('Adversarial Test B: NACE + Reminder already used -> Doubt strictly checks 1/day clarification quota', async () => {
    const ctx: UserBurdenContext = {
      userId: user1,
      evaluatedAt: new Date().toISOString(),
      touchesLast24Hours: 2,
      touchesLast1Hour: 0,
      autonomousTouchesLast24Hours: 1,
      autonomousTouchesLast1Hour: 0,
      clarificationsLast24Hours: 1, // Already sent 1 clarification today
      userRequestedTouchesLast24Hours: 1,
      lastAutonomousTouchAt: new Date(Date.now() - 4 * 3600 * 1000).toISOString(),
      lastTouchAt: new Date(Date.now() - 4 * 3600 * 1000).toISOString(),
      consecutiveIgnoredCount: 0,
      activeTopicsInFlight: [],
    };

    const decision = await universalBurdenEngine.evaluateBurden(user1, 'COGNITIVE_CLARIFICATION', {}, ctx);
    expect(decision.decision).toBe('SUPPRESS');
    expect(decision.reasonCode).toBe('CLARIFICATION_LIMIT_REACHED');
  });

  it('Adversarial Test C: Concurrent outreach attempts only permit within budget', async () => {
    mockOutreachDb = [];
    const canFirst = await universalBurdenEngine.canInitiateOutreach(user1, 'AUTONOMOUS_PROACTIVE');
    expect(canFirst).toBe(true);

    // Record the first touch to DB
    await universalBurdenEngine.recordOutreachTouch({
      userId: user1,
      outreachType: 'agenda_followup',
      sourceClass: 'AUTONOMOUS_PROACTIVE',
      message: 'Hello',
    });

    // Immediate second attempt without gap
    const canSecond = await universalBurdenEngine.canInitiateOutreach(user1, 'AUTONOMOUS_PROACTIVE');
    expect(canSecond).toBe(false);
  });

  it('Adversarial Test D: User says STOP -> Another subsystem attempts same topic -> SUPPRESS', async () => {
    const decision = await universalBurdenEngine.evaluateBurden(user1, 'AUTONOMOUS_PROACTIVE', {
      topic: 'gym routine',
      status: 'DISMISSED',
    });
    expect(decision.decision).toBe('SUPPRESS');
    expect(decision.reasonCode).toBe('USER_STOPPED');
  });

  it('Adversarial Test E: User says LATER -> Another subsystem sees same topic -> DEFER', async () => {
    const laterTime = new Date(Date.now() + 7200000).toISOString();
    const decision = await universalBurdenEngine.evaluateBurden(user1, 'AUTONOMOUS_PROACTIVE', {
      topic: 'tax filing',
      deferUntil: laterTime,
    });
    expect(decision.decision).toBe('DEFER');
    expect(decision.reasonCode).toBe('USER_DEFERRED');
  });

  it('Adversarial Test F: Same topic from two engines -> One user-facing touch, not two', async () => {
    const activeCtx: UserBurdenContext = {
      userId: user1,
      evaluatedAt: new Date().toISOString(),
      touchesLast24Hours: 1,
      touchesLast1Hour: 0,
      autonomousTouchesLast24Hours: 1,
      autonomousTouchesLast1Hour: 0,
      clarificationsLast24Hours: 0,
      userRequestedTouchesLast24Hours: 0,
      lastAutonomousTouchAt: new Date(Date.now() - 4 * 3600 * 1000).toISOString(),
      lastTouchAt: new Date(Date.now() - 4 * 3600 * 1000).toISOString(),
      consecutiveIgnoredCount: 0,
      activeTopicsInFlight: ['nace:interview_prep'],
    };

    const decision = await universalBurdenEngine.evaluateBurden(user1, 'AUTONOMOUS_PROACTIVE', {
      logicalKey: 'nace:interview_prep',
    }, activeCtx);

    expect(decision.decision).toBe('SUPPRESS');
    expect(decision.reasonCode).toBe('DUPLICATE_TOPIC');
  });

  it('Adversarial Test G: Internal Guardian anomaly consumes 0 user burden', async () => {
    const decision = await universalBurdenEngine.evaluateBurden(user1, 'SYSTEM_REQUIRED', {
      isInternalOnly: true,
      topic: 'schema_anomaly_W001',
    });
    expect(decision.decision).toBe('ALLOW');
    expect(decision.reasonCode).toBe('INTERNAL_SIGNAL_ALLOWED');
  });

  it('Adversarial Test H: User-requested reminder has USER_REQUESTED classification', async () => {
    const decision = await universalBurdenEngine.evaluateBurden(user1, 'USER_REQUESTED', {
      topic: 'take medicine',
    });
    expect(decision.decision).toBe('ALLOW');
    expect(decision.sourceClass).toBe('USER_REQUESTED');
    expect(decision.reasonCode).toBe('USER_REQUESTED_ALLOWED');
  });

  it('Adversarial Test I: User with many attention items still bounded by global limit', async () => {
    const saturatedCtx: UserBurdenContext = {
      userId: user1,
      evaluatedAt: new Date().toISOString(),
      touchesLast24Hours: 3,
      touchesLast1Hour: 0,
      autonomousTouchesLast24Hours: 3,
      autonomousTouchesLast1Hour: 0,
      clarificationsLast24Hours: 0,
      userRequestedTouchesLast24Hours: 0,
      lastAutonomousTouchAt: new Date(Date.now() - 4 * 3600 * 1000).toISOString(),
      lastTouchAt: new Date(Date.now() - 4 * 3600 * 1000).toISOString(),
      consecutiveIgnoredCount: 0,
      activeTopicsInFlight: [],
    };

    // Even if attention engine has 10 actionable items, all are bounded
    for (let i = 0; i < 5; i++) {
      const decision = await universalBurdenEngine.evaluateBurden(user1, 'AUTONOMOUS_PROACTIVE', {
        targetId: `item_${i}`,
      }, saturatedCtx);
      expect(decision.decision).toBe('SUPPRESS');
      expect(decision.reasonCode).toBe('DAILY_BUDGET_EXHAUSTED');
    }
  });
});
