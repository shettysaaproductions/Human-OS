/**
 * WatchtowerProactiveIntegrationPhase3cd.test.ts — Phase 3C-D Watchtower Proactive Integration Unit Tests
 */

import {
  WatchtowerProactiveIntegrationService,
  watchtowerProactiveIntegrationService,
} from '../WatchtowerProactiveIntegrationService';
import { contextualTimingEngine } from '../ContextualTimingEngine';
import { universalBurdenEngine } from '../UniversalBurdenEngine';
import { proactiveGate } from '../ProactiveGate';

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

describe('Phase 3C-D: Watchtower -> Contextual Timing -> ProactiveGate Integration', () => {
  const user1 = '00000000-0000-4000-a000-000000000001';
  const user2 = '00000000-0000-4000-a000-000000000002';

  beforeEach(() => {
    mockAttentionDb = [];
    mockTimingLogsDb = [];
    mockOutreachDb = [];
    mockProfilesDb = [
      { id: user1, timezone: 'Asia/Kolkata', preferred_name: 'Alice' },
      { id: user2, timezone: 'Asia/Kolkata', preferred_name: 'Bob' },
    ];
    mockPresenceDb = [
      { user_id: user1, status: 'online' },
      { user_id: user2, status: 'online' },
    ];
    mockChatDb = [];
    mockSessionsDb = [];
    jest.clearAllMocks();
  });

  it('1. PROACTIVE_ELIGIBLE decision proceeds through ProactiveGate and commits', async () => {
    mockAttentionDb = [
      {
        id: 'att_flight_1',
        user_id: user1,
        target_type: 'reminder',
        target_id: 'rem_1',
        attention_class: 'ACTIONABLE',
        status: 'READY',
        scores: { importance: 80, urgency: 75, compositeScore: 80 },
        evidence: { data: { text: 'Flight check-in open' } },
        reason: 'flight checkin',
        fingerprint: 'fp_flight_1',
        expires_at: new Date(Date.now() + 3600000).toISOString(),
      },
    ];

    const res = await watchtowerProactiveIntegrationService.evaluateAndDispatchProactiveOpportunities(user1);
    expect(res.evaluatedDecisionsCount).toBe(1);
    expect(res.eligibleDecisionsCount).toBe(1);
    expect(res.burdenAllowedCount).toBe(1);
    expect(res.gateAllowedCount).toBe(1);
    expect(res.dispatchedOpportunitiesCount).toBe(1);
    expect(res.handoffs[0].dispatched).toBe(true);

    // Verify attention status updated to ACTED
    expect(mockAttentionDb[0].status).toBe('ACTED');
  });

  it('2. DEFER (e.g. Active Chat collision) never reaches ProactiveGate dispatch', async () => {
    mockChatDb = [
      { user_id: user1, role: 'user', content: 'Debugging Python code', created_at: new Date().toISOString() },
    ];
    mockSessionsDb = [
      { user_id: user1, current_topic: 'python_debugging', last_message_at: new Date().toISOString() },
    ];

    mockAttentionDb = [
      {
        id: 'att_gym_1',
        user_id: user1,
        target_type: 'life_thread',
        target_id: 'lt_gym',
        attention_class: 'ACTIONABLE',
        status: 'READY',
        evidence: { data: { text: 'Gym routine' } },
        reason: 'gym reminder',
        fingerprint: 'fp_gym_1',
        expires_at: new Date(Date.now() + 3600000).toISOString(),
      },
    ];

    const res = await watchtowerProactiveIntegrationService.evaluateAndDispatchProactiveOpportunities(user1);
    expect(res.evaluatedDecisionsCount).toBe(1);
    expect(res.eligibleDecisionsCount).toBe(0); // SOON / DEFER due to active turn
    expect(res.dispatchedOpportunitiesCount).toBe(0);
    expect(res.blockedOpportunitiesCount).toBe(1);
  });

  it('3. SUPPRESS (e.g. Handled / Already Told) never reaches ProactiveGate dispatch', async () => {
    mockAttentionDb = [
      {
        id: 'att_handled_1',
        user_id: user1,
        target_type: 'reminder',
        target_id: 'rem_2',
        attention_class: 'ACTIONABLE',
        status: 'READY',
        scores: { alreadyHandledPenalty: 95 },
        reason: 'handled reminder',
        fingerprint: 'fp_handled_1',
        expires_at: new Date(Date.now() + 3600000).toISOString(),
      },
    ];

    const res = await watchtowerProactiveIntegrationService.evaluateAndDispatchProactiveOpportunities(user1);
    expect(res.eligibleDecisionsCount).toBe(0);
    expect(res.dispatchedOpportunitiesCount).toBe(0);
  });

  it('4. EXPIRED decisions never reach ProactiveGate dispatch', async () => {
    mockAttentionDb = [
      {
        id: 'att_exp_1',
        user_id: user1,
        target_type: 'reminder',
        target_id: 'rem_exp',
        attention_class: 'ACTIONABLE',
        status: 'EXPIRED',
        expires_at: new Date(Date.now() - 1000).toISOString(),
      },
    ];

    const res = await watchtowerProactiveIntegrationService.evaluateAndDispatchProactiveOpportunities(user1);
    expect(res.eligibleDecisionsCount).toBe(0);
    expect(res.dispatchedOpportunitiesCount).toBe(0);
  });

  it('5. Internal Guardian signals NEVER become user messages', async () => {
    mockAttentionDb = [
      {
        id: 'att_sig_1',
        user_id: user1,
        target_type: 'guardian_signal',
        target_id: 'sig_w003',
        attention_class: 'ACTIONABLE',
        status: 'READY',
        reason: 'internal provenance warning',
        expires_at: new Date(Date.now() + 3600000).toISOString(),
      },
    ];

    const res = await watchtowerProactiveIntegrationService.evaluateAndDispatchProactiveOpportunities(user1);
    expect(res.eligibleDecisionsCount).toBe(0);
    expect(res.dispatchedOpportunitiesCount).toBe(0);
  });

  it('6. UniversalBurdenEngine limit prevents dispatch even if timing is NOW', async () => {
    // Saturated 24h budget (3 autonomous touches already recorded, but all >60m ago)
    const now = Date.now();
    mockOutreachDb = [
      { user_id: user1, outreach_type: 'agenda_followup', user_replied: true, replied_at: new Date().toISOString(), created_at: new Date(now - 70 * 60 * 1000).toISOString() },
      { user_id: user1, outreach_type: 'engagement_checkin', user_replied: true, replied_at: new Date().toISOString(), created_at: new Date(now - 150 * 60 * 1000).toISOString() },
      { user_id: user1, outreach_type: 'life_curiosity', user_replied: true, replied_at: new Date().toISOString(), created_at: new Date(now - 300 * 60 * 1000).toISOString() },
    ];

    mockAttentionDb = [
      {
        id: 'att_thread_1',
        user_id: user1,
        target_type: 'life_thread',
        target_id: 'lt_project',
        attention_class: 'ACTIONABLE',
        status: 'READY',
        evidence: { data: { topic: 'project milestone' } },
        reason: 'project milestone',
        fingerprint: 'fp_project_1',
        expires_at: new Date(Date.now() + 3600000).toISOString(),
      },
    ];

    const res = await watchtowerProactiveIntegrationService.evaluateAndDispatchProactiveOpportunities(user1);
    expect(res.eligibleDecisionsCount).toBe(1);
    expect(res.burdenAllowedCount).toBe(0); // Blocked by universal burden cap
    expect(res.dispatchedOpportunitiesCount).toBe(0);
    expect(res.handoffs[0].burdenDecision).toBe('SUPPRESS');
    expect(res.handoffs[0].burdenReason).toBe('DAILY_BUDGET_EXHAUSTED');
  });

  it('7. Duplicate topic suppression: Multiple engines producing same topic allows only one dispatch', async () => {
    mockOutreachDb = [
      {
        user_id: user1,
        outreach_type: 'proactive',
        logical_key: 'watchtower:reminder:flight_123',
        created_at: new Date(Date.now() - 180 * 60 * 1000).toISOString(),
      },
    ];

    mockAttentionDb = [
      {
        id: 'att_flight_dup',
        user_id: user1,
        target_type: 'reminder',
        target_id: 'flight_123',
        attention_class: 'ACTIONABLE',
        status: 'READY',
        evidence: { data: { text: 'flight checkin' } },
        reason: 'flight checkin',
        fingerprint: 'fp_flight_dup',
        expires_at: new Date(Date.now() + 3600000).toISOString(),
      },
    ];

    const res = await watchtowerProactiveIntegrationService.evaluateAndDispatchProactiveOpportunities(user1);
    expect(res.burdenAllowedCount).toBe(0);
    expect(res.dispatchedOpportunitiesCount).toBe(0);
    expect(res.handoffs[0].burdenReason).toBe('DUPLICATE_TOPIC');
  });

  it('8. User stop (DISMISSED) prevents all proactive handoffs', async () => {
    mockAttentionDb = [
      {
        id: 'att_stopped_1',
        user_id: user1,
        target_type: 'reminder',
        target_id: 'rem_stop',
        attention_class: 'ACTIONABLE',
        status: 'DISMISSED',
        reason: 'stopped reminder',
        fingerprint: 'fp_stop_1',
        expires_at: new Date(Date.now() + 3600000).toISOString(),
      },
    ];

    const res = await watchtowerProactiveIntegrationService.evaluateAndDispatchProactiveOpportunities(user1);
    expect(res.eligibleDecisionsCount).toBe(0);
    expect(res.dispatchedOpportunitiesCount).toBe(0);
  });

  it('9. User later (defer_until) holds handoff in WAIT/DEFER', async () => {
    mockAttentionDb = [
      {
        id: 'att_later_1',
        user_id: user1,
        target_type: 'reminder',
        target_id: 'rem_later',
        attention_class: 'ACTIONABLE',
        status: 'READY',
        defer_until: new Date(Date.now() + 4 * 3600 * 1000).toISOString(),
        reason: 'deferred reminder',
        fingerprint: 'fp_later_1',
        expires_at: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
      },
    ];

    const res = await watchtowerProactiveIntegrationService.evaluateAndDispatchProactiveOpportunities(user1);
    expect(res.eligibleDecisionsCount).toBe(0);
    expect(res.dispatchedOpportunitiesCount).toBe(0);
  });

  it('10. Repeated heartbeat pulse is strictly idempotent (no duplicate dispatch)', async () => {
    mockAttentionDb = [
      {
        id: 'att_repeat_1',
        user_id: user1,
        target_type: 'reminder',
        target_id: 'rem_repeat',
        attention_class: 'ACTIONABLE',
        status: 'READY',
        scores: { importance: 80, urgency: 80, compositeScore: 80 },
        evidence: { data: { text: 'Repeatable action' } },
        reason: 'repeat test',
        fingerprint: 'fp_repeat_1',
        expires_at: new Date(Date.now() + 3600000).toISOString(),
      },
    ];

    // Pulse 1: Clears and marks ACTED
    const pulse1 = await watchtowerProactiveIntegrationService.evaluateAndDispatchProactiveOpportunities(user1);
    expect(pulse1.dispatchedOpportunitiesCount).toBe(1);
    expect(mockAttentionDb[0].status).toBe('ACTED');

    // Pulse 2: Attention is ACTED -> 0 dispatched
    const pulse2 = await watchtowerProactiveIntegrationService.evaluateAndDispatchProactiveOpportunities(user1);
    expect(pulse2.dispatchedOpportunitiesCount).toBe(0);
  });

  it('11. Dry-run mode validates entire pipeline without mutating ProactiveGate', async () => {
    mockAttentionDb = [
      {
        id: 'att_dry_1',
        user_id: user1,
        target_type: 'reminder',
        target_id: 'rem_dry',
        attention_class: 'ACTIONABLE',
        status: 'READY',
        scores: { importance: 80, urgency: 80, compositeScore: 80 },
        evidence: { data: { text: 'Dry run check' } },
        reason: 'dry run test',
        fingerprint: 'fp_dry_1',
        expires_at: new Date(Date.now() + 3600000).toISOString(),
      },
    ];

    const dryRes = await watchtowerProactiveIntegrationService.evaluateAndDispatchProactiveOpportunities(user1, { dryRun: true });
    expect(dryRes.eligibleDecisionsCount).toBe(1);
    expect(dryRes.burdenAllowedCount).toBe(1);
    expect(dryRes.gateAllowedCount).toBe(1);
    expect(dryRes.dispatchedOpportunitiesCount).toBe(0); // Dry-run does not dispatch
    expect(mockAttentionDb[0].status).toBe('READY'); // Status unchanged
  });

  it('12. Cross-user isolation: User 1 dispatch does not block User 2 opportunity', async () => {
    mockAttentionDb = [
      {
        id: 'att_u1',
        user_id: user1,
        target_type: 'reminder',
        target_id: 'rem_u1',
        attention_class: 'ACTIONABLE',
        status: 'READY',
        evidence: { data: { text: 'User 1 task' } },
        fingerprint: 'fp_u1',
        expires_at: new Date(Date.now() + 3600000).toISOString(),
      },
      {
        id: 'att_u2',
        user_id: user2,
        target_type: 'reminder',
        target_id: 'rem_u2',
        attention_class: 'ACTIONABLE',
        status: 'READY',
        evidence: { data: { text: 'User 2 task' } },
        fingerprint: 'fp_u2',
        expires_at: new Date(Date.now() + 3600000).toISOString(),
      },
    ];

    const resU1 = await watchtowerProactiveIntegrationService.evaluateAndDispatchProactiveOpportunities(user1);
    const resU2 = await watchtowerProactiveIntegrationService.evaluateAndDispatchProactiveOpportunities(user2);

    expect(resU1.dispatchedOpportunitiesCount).toBe(1);
    expect(resU2.dispatchedOpportunitiesCount).toBe(1);
  });
});
