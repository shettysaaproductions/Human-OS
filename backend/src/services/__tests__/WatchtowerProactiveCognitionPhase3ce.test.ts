/**
 * WatchtowerProactiveCognitionPhase3ce.test.ts — Phase 3C-E Integrated Proactive Cognition Adversarial Validation
 */

import { watchtowerProactiveIntegrationService } from '../WatchtowerProactiveIntegrationService';
import { contextualTimingEngine } from '../ContextualTimingEngine';
import { universalBurdenEngine } from '../UniversalBurdenEngine';
import { proactiveGate } from '../ProactiveGate';
import { watchtowerAttentionEngine } from '../WatchtowerAttentionEngine';

let mockAttentionDb: any[] = [];
let mockTimingLogsDb: any[] = [];
let mockOutreachDb: any[] = [];
let mockProfilesDb: any[] = [];
let mockPresenceDb: any[] = [];
let mockChatDb: any[] = [];
let mockSessionsDb: any[] = [];

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
        gt: jest.fn().mockImplementation((col: string, val: any) => {
          builder._filters[`${col}_gt`] = val;
          return builder;
        }),
        in: jest.fn().mockImplementation((col: string, vals: any[]) => {
          builder._filters[`${col}_in`] = vals;
          return builder;
        }),
        is: jest.fn().mockImplementation((col: string, val: any) => {
          builder._filters[`${col}_is`] = val;
          return builder;
        }),
        not: jest.fn().mockImplementation((col: string, op: string, val: any) => {
          builder._filters[`${col}_not`] = { op, val };
          return builder;
        }),
        order: jest.fn().mockImplementation(() => builder),
        limit: jest.fn().mockImplementation((lim: number) => {
          builder._limit = lim;
          return builder;
        }),
        maybeSingle: jest.fn().mockImplementation(() => {
          let store: any[] = [];
          if (table === 'profiles') store = mockProfilesDb;
          if (table === 'user_presence') store = mockPresenceDb;
          if (table === 'conversation_sessions') store = mockSessionsDb;
          if (table === 'chat_history') store = mockChatDb;

          let res = [...store];
          if (builder._filters['user_id']) res = res.filter(r => r.user_id === builder._filters['user_id']);
          if (builder._filters['id']) res = res.filter(r => r.id === builder._filters['id']);
          return Promise.resolve({ data: res[0] || null, error: null });
        }),
        insert: jest.fn().mockImplementation((payload: any) => {
          const rows = Array.isArray(payload) ? payload : [payload];
          if (table === 'nova_outreach_log') {
            for (const r of rows) {
              mockOutreachDb.unshift({ id: `out_${Date.now()}_${Math.random()}`, ...r });
            }
          }
          return {
            select: jest.fn().mockImplementation(() => ({
              single: jest.fn().mockResolvedValue({ data: { id: `out_${Date.now()}` }, error: null }),
            })),
            then: (resolve: any) => resolve({ data: rows, error: null }),
          };
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
        update: jest.fn().mockImplementation((payload: any) => {
          builder._payload = payload;
          if (builder._filters['id'] && table === 'watchtower_attention_decisions') {
            const idx = mockAttentionDb.findIndex(a => a.id === builder._filters['id']);
            if (idx >= 0) mockAttentionDb[idx] = { ...mockAttentionDb[idx], ...payload };
          }
          return {
            eq: jest.fn().mockImplementation((col: string, val: any) => {
              builder._filters[col] = val;
              if (col === 'id' && table === 'watchtower_attention_decisions' && builder._payload) {
                const idx = mockAttentionDb.findIndex(a => a.id === val);
                if (idx >= 0) mockAttentionDb[idx] = { ...mockAttentionDb[idx], ...builder._payload };
              }
              return Promise.resolve({ data: null, error: null });
            }),
            then: (resolve: any) => resolve({ data: null, error: null }),
          };
        }),
        then: (resolve: any) => {
          let store: any[] = [];
          if (table === 'watchtower_attention_decisions') store = mockAttentionDb;
          if (table === 'watchtower_timing_logs') store = mockTimingLogsDb;
          if (table === 'nova_outreach_log') store = mockOutreachDb;
          if (table === 'profiles') store = mockProfilesDb;
          if (table === 'user_presence') store = mockPresenceDb;
          if (table === 'chat_history') store = mockChatDb;
          if (table === 'conversation_sessions') store = mockSessionsDb;

          let res = [...store];
          if (builder._filters['user_id']) res = res.filter(r => r.user_id === builder._filters['user_id']);
          if (builder._filters['id']) res = res.filter(r => r.id === builder._filters['id']);
          if (builder._filters['status_in']) {
            res = res.filter(r => builder._filters['status_in'].includes(r.status));
          }
          if (builder._limit !== undefined) res = res.slice(0, builder._limit);
          return resolve({ data: res, error: null });
        },
      };
      return builder;
    }),
  },
}));

describe('Phase 3C-E: Final Integrated Proactive Cognition Adversarial Validation', () => {
  const user1 = '00000000-0000-4000-a000-000000000001';
  const user2 = '00000000-0000-4000-a000-000000000002';

  beforeEach(() => {
    mockAttentionDb = [];
    mockTimingLogsDb = [];
    mockOutreachDb = [];
    mockProfilesDb = [
      { id: user1, timezone: 'Asia/Kolkata', preferred_name: 'AdversarialUser1' },
      { id: user2, timezone: 'Asia/Kolkata', preferred_name: 'AdversarialUser2' },
    ];
    mockPresenceDb = [
      { user_id: user1, status: 'online' },
      { user_id: user2, status: 'online' },
    ];
    mockChatDb = [];
    mockSessionsDb = [];
    jest.clearAllMocks();
  });

  it('1. Clean user produces zero unnecessary proactive actions (0 LLM calls)', async () => {
    mockAttentionDb = [];
    const res = await watchtowerProactiveIntegrationService.evaluateAndDispatchProactiveOpportunities(user1);
    expect(res.evaluatedDecisionsCount).toBe(0);
    expect(res.eligibleDecisionsCount).toBe(0);
    expect(res.dispatchedOpportunitiesCount).toBe(0);
    expect(res.llmCallsAdded).toBe(0);
  });

  it('2. Simple Actionable Item -> Exact 1 atomic authorization', async () => {
    mockAttentionDb = [
      {
        id: 'att_act_1',
        user_id: user1,
        target_type: 'reminder',
        target_id: 'rem_flight_1',
        attention_class: 'ACTIONABLE',
        status: 'READY',
        importance: 80,
        urgency: 75,
        composite_score: 80,
        already_handled_penalty: 0,
        evidence: { data: { text: 'Flight checkin' } },
        reason: 'flight checkin open',
        fingerprint: 'fp_act_1',
        expires_at: new Date(Date.now() + 3600000).toISOString(),
      },
    ];

    const res = await watchtowerProactiveIntegrationService.evaluateAndDispatchProactiveOpportunities(user1);
    expect(res.eligibleDecisionsCount).toBe(1);
    expect(res.burdenAllowedCount).toBe(1);
    expect(res.gateAllowedCount).toBe(1);
    expect(res.dispatchedOpportunitiesCount).toBe(1);
    expect(mockAttentionDb[0].status).toBe('ACTED');
  });

  it('3. Repeated heartbeat on same window is strictly idempotent', async () => {
    mockAttentionDb = [
      {
        id: 'att_rep_1',
        user_id: user1,
        target_type: 'reminder',
        target_id: 'rem_rep_1',
        attention_class: 'ACTIONABLE',
        status: 'READY',
        importance: 80,
        urgency: 75,
        composite_score: 80,
        already_handled_penalty: 0,
        fingerprint: 'fp_rep_1',
        expires_at: new Date(Date.now() + 3600000).toISOString(),
      },
    ];

    const pulse1 = await watchtowerProactiveIntegrationService.evaluateAndDispatchProactiveOpportunities(user1);
    expect(pulse1.dispatchedOpportunitiesCount).toBe(1);
    expect(mockAttentionDb[0].status).toBe('ACTED');

    const pulse2 = await watchtowerProactiveIntegrationService.evaluateAndDispatchProactiveOpportunities(user1);
    expect(pulse2.dispatchedOpportunitiesCount).toBe(0);
  });

  it('4. Multi-engine duplicate topic: Global burden suppresses second engine outreach', async () => {
    mockOutreachDb = [
      {
        user_id: user1,
        outreach_type: 'proactive',
        logical_key: 'nace:agenda:interview_prep',
        created_at: new Date(Date.now() - 180 * 60 * 1000).toISOString(),
      },
    ];

    mockAttentionDb = [
      {
        id: 'att_interview_dup',
        user_id: user1,
        target_type: 'reminder',
        target_id: 'interview_prep',
        attention_class: 'ACTIONABLE',
        status: 'READY',
        importance: 80,
        urgency: 75,
        composite_score: 80,
        already_handled_penalty: 0,
        evidence: { data: { text: 'interview prep' } },
        reason: 'interview prep',
        fingerprint: 'fp_int_dup',
        expires_at: new Date(Date.now() + 3600000).toISOString(),
      },
    ];

    const res = await watchtowerProactiveIntegrationService.evaluateAndDispatchProactiveOpportunities(user1);
    expect(res.burdenAllowedCount).toBe(0);
    expect(res.dispatchedOpportunitiesCount).toBe(0);
    expect(res.handoffs[0].burdenReason).toBe('DUPLICATE_TOPIC');
  });

  it('5. User-requested reminder vs Autonomous proactive classification', async () => {
    const userReqDecision = await universalBurdenEngine.evaluateBurden(user1, 'USER_REQUESTED', {
      topic: 'take medication at 5pm',
    });
    const autoDecision = await universalBurdenEngine.evaluateBurden(user1, 'AUTONOMOUS_PROACTIVE', {
      topic: 'general checkin',
    });

    expect(userReqDecision.sourceClass).toBe('USER_REQUESTED');
    expect(userReqDecision.reasonCode).toBe('USER_REQUESTED_ALLOWED');
    expect(autoDecision.sourceClass).toBe('AUTONOMOUS_PROACTIVE');
  });

  it('6. User DONE response marks attention ACTED and suppresses repeated messages', async () => {
    mockAttentionDb = [
      {
        id: 'att_done_1',
        user_id: user1,
        target_type: 'reminder',
        target_id: 'rem_done',
        attention_class: 'ACTIONABLE',
        status: 'ACTED',
        already_handled_penalty: 100,
        fingerprint: 'fp_done_1',
        expires_at: new Date(Date.now() + 3600000).toISOString(),
      },
    ];

    const res = await watchtowerProactiveIntegrationService.evaluateAndDispatchProactiveOpportunities(user1);
    expect(res.eligibleDecisionsCount).toBe(0);
    expect(res.dispatchedOpportunitiesCount).toBe(0);
  });

  it('7. User LATER response holds handoff in WAIT until defer_until', async () => {
    mockAttentionDb = [
      {
        id: 'att_later_1',
        user_id: user1,
        target_type: 'reminder',
        target_id: 'rem_later',
        attention_class: 'ACTIONABLE',
        status: 'READY',
        defer_until: new Date(Date.now() + 3600000).toISOString(),
        fingerprint: 'fp_lat_1',
        expires_at: new Date(Date.now() + 24 * 3600000).toISOString(),
      },
    ];

    const res = await watchtowerProactiveIntegrationService.evaluateAndDispatchProactiveOpportunities(user1);
    expect(res.eligibleDecisionsCount).toBe(0);
    expect(res.dispatchedOpportunitiesCount).toBe(0);
  });

  it('8. User STOP response suppresses all future outreach globally', async () => {
    mockAttentionDb = [
      {
        id: 'att_stop_1',
        user_id: user1,
        target_type: 'reminder',
        target_id: 'rem_stop',
        attention_class: 'ACTIONABLE',
        status: 'DISMISSED',
        fingerprint: 'fp_stp_1',
        expires_at: new Date(Date.now() + 3600000).toISOString(),
      },
    ];

    const res = await watchtowerProactiveIntegrationService.evaluateAndDispatchProactiveOpportunities(user1);
    expect(res.eligibleDecisionsCount).toBe(0);
    expect(res.dispatchedOpportunitiesCount).toBe(0);
  });

  it('9. Ignored outreach triggers exponential backoff (60 -> 180 -> 360 -> 720m)', () => {
    expect(universalBurdenEngine.getEscalatedGapMinutes(0)).toBe(0);
    expect(universalBurdenEngine.getEscalatedGapMinutes(1)).toBe(60);
    expect(universalBurdenEngine.getEscalatedGapMinutes(2)).toBe(180);
    expect(universalBurdenEngine.getEscalatedGapMinutes(3)).toBe(360);
    expect(universalBurdenEngine.getEscalatedGapMinutes(4)).toBe(720);
  });

  it('10. Quiet hours suppresses normal actionable items', async () => {
    const quietCtx = {
      ...await contextualTimingEngine.assembleTimingContext(user1),
      isQuietHours: true,
      localHour: 3.0, // 3:00 AM
    };

    mockAttentionDb = [
      {
        id: 'att_night_1',
        user_id: user1,
        target_type: 'reminder',
        target_id: 'rem_night',
        attention_class: 'ACTIONABLE',
        status: 'READY',
        importance: 70,
        urgency: 60,
        composite_score: 65,
        fingerprint: 'fp_night_1',
        expires_at: new Date(Date.now() + 3600000).toISOString(),
      },
    ];

    const decision = contextualTimingEngine.evaluateTiming(user1, mockAttentionDb[0] as any, quietCtx);
    expect(decision.timingState).toBe('QUIET');
    expect(decision.outreachEligibility).toBe('DEFER');
    expect(decision.reasonCode).toBe('QUIET_HOURS');
  });

  it('11. Urgent deadline (<2h) in quiet hours permits explicit override', async () => {
    const quietCtx = {
      ...await contextualTimingEngine.assembleTimingContext(user1),
      isQuietHours: true,
      localHour: 3.0,
    };

    const urgentAttention: any = {
      id: 'att_urgent_night',
      userId: user1,
      targetType: 'reminder',
      targetId: 'rem_urgent',
      attentionClass: 'URGENT',
      status: 'READY',
      scores: { importance: 95, urgency: 95, deadlineProximity: 95, compositeScore: 95 },
      fingerprint: 'fp_urg_night',
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
    };

    const decision = contextualTimingEngine.evaluateTiming(user1, urgentAttention, quietCtx);
    expect(decision.timingState).toBe('NOW');
    expect(decision.outreachEligibility).toBe('PROACTIVE_ELIGIBLE');
    expect(decision.reasonCode).toBe('DEADLINE_IMMINENT');
  });

  it('12. Active conversation collision holds unrelated item in SOON/DEFER', async () => {
    mockChatDb = [
      { user_id: user1, role: 'user', content: 'talking about work stress', created_at: new Date().toISOString() },
    ];
    mockSessionsDb = [
      { user_id: user1, current_topic: 'work_stress', last_message_at: new Date().toISOString() },
    ];

    mockAttentionDb = [
      {
        id: 'att_grocery_1',
        user_id: user1,
        target_type: 'reminder',
        target_id: 'rem_grocery',
        attention_class: 'ACTIONABLE',
        status: 'READY',
        importance: 70,
        urgency: 60,
        composite_score: 65,
        evidence: { data: { text: 'Buy groceries' } },
        reason: 'buy groceries',
        fingerprint: 'fp_groc_1',
        expires_at: new Date(Date.now() + 3600000).toISOString(),
      },
    ];

    const res = await watchtowerProactiveIntegrationService.evaluateAndDispatchProactiveOpportunities(user1);
    expect(res.eligibleDecisionsCount).toBe(0);
    expect(res.dispatchedOpportunitiesCount).toBe(0);
    expect(res.handoffs[0].burdenReason).toBe('ACTIVE_CONVERSATION');
  });

  it('13. Internal Guardian signals produce 0 user messages', async () => {
    mockAttentionDb = [
      {
        id: 'att_sig_test',
        user_id: user1,
        target_type: 'guardian_signal',
        target_id: 'sig_anom_w003',
        attention_class: 'URGENT',
        status: 'READY',
        reason: 'internal anomaly check',
        fingerprint: 'fp_sig_test',
        expires_at: new Date(Date.now() + 3600000).toISOString(),
      },
    ];

    const res = await watchtowerProactiveIntegrationService.evaluateAndDispatchProactiveOpportunities(user1);
    expect(res.eligibleDecisionsCount).toBe(0);
    expect(res.dispatchedOpportunitiesCount).toBe(0);
  });

  it('14. Missing context fails safe to WAIT / DEFER with LOW_CONFIDENCE', async () => {
    const noTzCtx = {
      ...await contextualTimingEngine.assembleTimingContext(user1),
      timezone: '',
    };

    const sampleAtt: any = {
      id: 'att_notz',
      userId: user1,
      targetType: 'reminder',
      targetId: 'rem_tz',
      attentionClass: 'ACTIONABLE',
      status: 'READY',
      fingerprint: 'fp_tz_1',
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
    };

    const decision = contextualTimingEngine.evaluateTiming(user1, sampleAtt, noTzCtx);
    expect(decision.timingState).toBe('WAIT');
    expect(decision.outreachEligibility).toBe('DEFER');
    expect(decision.confidence).toBe('LOW_CONFIDENCE');
    expect(decision.reasonCode).toBe('MISSING_CONTEXT');
  });

  it('15. Multi-user isolation: User 1 and User 2 run in complete isolation', async () => {
    mockAttentionDb = [
      {
        id: 'att_iso_u1',
        user_id: user1,
        target_type: 'reminder',
        target_id: 'rem_iso_1',
        attention_class: 'ACTIONABLE',
        status: 'READY',
        importance: 80,
        urgency: 75,
        composite_score: 80,
        already_handled_penalty: 0,
        fingerprint: 'fp_iso_u1',
        expires_at: new Date(Date.now() + 3600000).toISOString(),
      },
      {
        id: 'att_iso_u2',
        user_id: user2,
        target_type: 'reminder',
        target_id: 'rem_iso_2',
        attention_class: 'ACTIONABLE',
        status: 'READY',
        importance: 80,
        urgency: 75,
        composite_score: 80,
        already_handled_penalty: 0,
        fingerprint: 'fp_iso_u2',
        expires_at: new Date(Date.now() + 3600000).toISOString(),
      },
    ];

    const resU1 = await watchtowerProactiveIntegrationService.evaluateAndDispatchProactiveOpportunities(user1);
    const resU2 = await watchtowerProactiveIntegrationService.evaluateAndDispatchProactiveOpportunities(user2);

    expect(resU1.dispatchedOpportunitiesCount).toBe(1);
    expect(resU2.dispatchedOpportunitiesCount).toBe(1);
    expect(resU1.handoffs[0].userId).toBe(user1);
    expect(resU2.handoffs[0].userId).toBe(user2);
  });
});
