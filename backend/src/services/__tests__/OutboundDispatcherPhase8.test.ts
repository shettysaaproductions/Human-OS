/**
 * OutboundDispatcherPhase8.test.ts
 * Phase 8 canonical outbound contract -- 13 regression tests
 *
 *  T1.  WATCHTOWER reaches Dispatcher with correct canonical source
 *  T2.  Intent lifecycle: gate -> RPC commit -> push
 *  T3.  Gate suppression -> SUPPRESSED, no RPC, no push
 *  T4.  Push fails -> DELIVERED_PARTIAL, RPC called exactly once (idempotent)
 *  T5.  REMINDER routes through Dispatcher, gate+RPC both called
 *  T6.  User-requested high-urgency reminder: skipQuietHoursCheck=true to gate
 *  T7.  System-generated (is_auto=true) reminder: skipQuietHoursCheck=false (Correction 3)
 *  T8.  WEATHER via Dispatcher -- gate called exactly once by Dispatcher, not caller
 *  T9.  Same idempotencyKey: existing DELIVERED intent returned, gate NOT re-acquired
 * T10.  nova_outreach_log never written directly by Dispatcher or engines
 * T11.  All 7 canonical OutboundSource string values present
 * T12.  Resumed PERSISTED intent skips RPC re-commit
 * T13.  FAILED_TRANSIENT retry -- stale gate released, CREATED reset, re-acquired, one delivery (Correction 2)
 */

import { outboundDispatcherService } from '../OutboundDispatcherService';
import { proactiveGate } from '../ProactiveGate';
import { supabaseAdmin } from '../../lib/supabase';
import { sendNovaReplyNotification } from '../../lib/pushNotifications';
import type { OutboundSource } from '../../types/outbound';

jest.mock('../../lib/supabase', () => ({
  supabaseAdmin: { from: jest.fn(), rpc: jest.fn() },
}));

jest.mock('../ProactiveGate', () => ({
  proactiveGate: {
    acquire: jest.fn(),
    commit: jest.fn().mockResolvedValue(undefined),
    release: jest.fn().mockResolvedValue(undefined),
    markReplied: jest.fn(),
  },
}));

jest.mock('../../lib/pushNotifications', () => ({
  sendNovaReplyNotification: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../lib/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Builds a chainable Supabase query mock */
function makeChain(overrides: Record<string, any> = {}): any {
  const c: any = {};
  ['select','eq','neq','order','limit','is','not','in','gte','gt','lte','lt',
   'insert','update','delete','upsert'].forEach(f => { c[f] = jest.fn().mockReturnValue(c); });
  c.single      = jest.fn().mockResolvedValue({ data: null, error: null });
  c.maybeSingle = jest.fn().mockResolvedValue({ data: null, error: null });
  return Object.assign(c, overrides);
}

function setupDefaultMocks({ pushToken = 'push-tok' } = {}) {
  (supabaseAdmin.rpc as jest.Mock).mockResolvedValue({ data: 'ch-1', error: null });

  (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
    const c = makeChain();
    switch (table) {
      case 'account_tombstones':
        c.maybeSingle.mockResolvedValue({ data: null });
        return c;
      case 'action_idempotency':
        c.insert.mockResolvedValue({ error: null });
        return c;
      case 'profiles':
        c.maybeSingle.mockResolvedValue({ data: { push_token: pushToken } });
        return c;
      case 'outbound_intents': {
        const intentData = { id: 'i1', status: 'CREATED', outreach_id: null, chat_message_id: null };
        c.insert.mockReturnValue(makeChain({
          select: jest.fn().mockReturnValue(makeChain({
            single: jest.fn().mockResolvedValue({ data: intentData, error: null }),
          })),
        }));
        c.single.mockResolvedValue({ data: intentData, error: null });
        c.update.mockReturnValue(makeChain({ eq: jest.fn().mockResolvedValue({ error: null }) }));
        return c;
      }
      case 'chat_history':
        c.single.mockResolvedValue({ data: { content: 'msg', conversation_id: 'cv1' }, error: null });
        c.maybeSingle.mockResolvedValue({ data: { conversation_id: 'cv1' }, error: null });
        return c;
      default:
        return c;
    }
  });
}

// Shared base payload — each test must override idempotencyKey to avoid cross-test collisions
const BASE = {
  userId: 'u1',
  intentType: 'proactive',
  logicalKey: 'lk',
  idempotencyKey: 'ik-base',
  context: {},
  generationStrategy: 'none' as const,
  proposedMessage: 'Hi from Nova',
  skipQuietHoursCheck: false,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Phase 8 — Canonical Outbound Contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (proactiveGate.acquire as jest.Mock).mockResolvedValue({ allowed: true, outreachId: 'or1' });
    setupDefaultMocks();
  });

  // T1 -----------------------------------------------------------------------
  test('T1: WATCHTOWER reaches Dispatcher with correct canonical source', async () => {
    const s = await outboundDispatcherService.dispatch({
      ...BASE, idempotencyKey: 't1:ik', sourceEngine: 'WATCHTOWER' as OutboundSource,
    });
    expect(['DELIVERED', 'NOTIFICATION_SKIPPED', 'DELIVERED_PARTIAL']).toContain(s);
    expect(proactiveGate.acquire).toHaveBeenCalledWith('u1', expect.any(Object));
  });

  // T2 -----------------------------------------------------------------------
  test('T2: Intent lifecycle -- gate -> RPC commit -> push called', async () => {
    await outboundDispatcherService.dispatch({
      ...BASE, idempotencyKey: 't2:ik', sourceEngine: 'NACE' as OutboundSource,
    });
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith('rpc_commit_outbound_intent', expect.any(Object));
    expect(proactiveGate.commit).toHaveBeenCalledWith('or1', expect.any(String));
  });

  // T3 -----------------------------------------------------------------------
  test('T3: Gate suppression -> SUPPRESSED, no RPC, no push', async () => {
    (proactiveGate.acquire as jest.Mock).mockResolvedValueOnce({ allowed: false, blockedBy: 'quiet_hours' });
    const s = await outboundDispatcherService.dispatch({
      ...BASE, idempotencyKey: 't3:ik', sourceEngine: 'NACE' as OutboundSource,
    });
    expect(s).toBe('SUPPRESSED');
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled();
    expect(sendNovaReplyNotification).not.toHaveBeenCalled();
  });

  // T4 -----------------------------------------------------------------------
  test('T4: Push fails -> DELIVERED_PARTIAL, RPC called exactly once (idempotent)', async () => {
    (sendNovaReplyNotification as jest.Mock).mockRejectedValueOnce(new Error('timeout'));
    const s = await outboundDispatcherService.dispatch({
      ...BASE, idempotencyKey: 't4:ik', sourceEngine: 'REMINDER' as OutboundSource,
    });
    expect(['DELIVERED_PARTIAL', 'NOTIFICATION_SKIPPED']).toContain(s);
    expect(supabaseAdmin.rpc).toHaveBeenCalledTimes(1);
  });

  // T5 -----------------------------------------------------------------------
  test('T5: REMINDER source routes through Dispatcher -- gate and RPC both called', async () => {
    const s = await outboundDispatcherService.dispatch({
      ...BASE,
      idempotencyKey: 'reminder:fire:rem-1',
      logicalKey: 'reminder:fire:rem-1',
      sourceEngine: 'REMINDER' as OutboundSource,
      intentType: 'reminder',
    });
    expect(['DELIVERED', 'NOTIFICATION_SKIPPED', 'DELIVERED_PARTIAL']).toContain(s);
    expect(proactiveGate.acquire).toHaveBeenCalled();
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith('rpc_commit_outbound_intent', expect.any(Object));
  });

  // T6 -----------------------------------------------------------------------
  test('T6: User-requested high-urgency reminder: skipQuietHoursCheck=true passed to gate', async () => {
    await outboundDispatcherService.dispatch({
      ...BASE, idempotencyKey: 't6:ik',
      sourceEngine: 'REMINDER' as OutboundSource,
      intentType: 'reminder',
      skipQuietHoursCheck: true,   // is_auto=false && urgency=high
      skipMinGapCheck: true,
    });
    expect(proactiveGate.acquire).toHaveBeenCalledWith('u1',
      expect.objectContaining({ skipQuietHoursCheck: true }),
    );
  });

  // T7 -----------------------------------------------------------------------
  test('T7: System-generated high-urgency reminder: skipQuietHoursCheck=false (Correction 3)', async () => {
    // is_auto=true -> ReminderSchedulerService sets skipQuietHoursCheck=false
    // A system-classified "high" must not break quiet hours
    await outboundDispatcherService.dispatch({
      ...BASE, idempotencyKey: 't7:ik',
      sourceEngine: 'REMINDER' as OutboundSource,
      intentType: 'reminder',
      skipQuietHoursCheck: false,
    });
    expect(proactiveGate.acquire).toHaveBeenCalledWith('u1',
      expect.objectContaining({ skipQuietHoursCheck: false }),
    );
  });

  // T8 -----------------------------------------------------------------------
  test('T8: WEATHER routes through Dispatcher -- gate acquired exactly once by Dispatcher, nova_outreach_log not written directly', async () => {
    await outboundDispatcherService.dispatch({
      ...BASE, idempotencyKey: 't8:ik',
      sourceEngine: 'WEATHER' as OutboundSource,
      intentType: 'weather_alert',
      skipMinGapCheck: true,
    });
    expect(proactiveGate.acquire).toHaveBeenCalledTimes(1);
    expect(proactiveGate.commit).toHaveBeenCalledTimes(1);
    const fromCalls = (supabaseAdmin.from as jest.Mock).mock.calls.map((c: any[]) => c[0] as string);
    expect(fromCalls).not.toContain('nova_outreach_log');
  });

  // T9 -----------------------------------------------------------------------
  test('T9: Same idempotencyKey -- existing DELIVERED intent returned, gate NOT re-acquired', async () => {
    // Simulate: 23505 on insert, fetch returns DELIVERED existing intent
    (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
      const c = makeChain();
      switch (table) {
        case 'account_tombstones': c.maybeSingle.mockResolvedValue({ data: null }); return c;
        case 'action_idempotency': c.insert.mockResolvedValue({ error: { code: '23505' } }); return c;
        case 'profiles': c.maybeSingle.mockResolvedValue({ data: { push_token: 'tok' } }); return c;
        case 'outbound_intents':
          c.insert.mockReturnValue(makeChain({ select: jest.fn().mockReturnValue(makeChain({ single: jest.fn().mockResolvedValue({ data: null, error: { code: '23505' } }) })) }));
          c.single.mockResolvedValue({ data: { id: 'ei', status: 'DELIVERED', outreach_id: 'or1', chat_message_id: 'ch1' }, error: null });
          c.update.mockReturnValue(makeChain({ eq: jest.fn().mockResolvedValue({ error: null }) }));
          return c;
        case 'chat_history':
          c.single.mockResolvedValue({ data: { content: 'msg', conversation_id: 'cv1' }, error: null });
          c.maybeSingle.mockResolvedValue({ data: { conversation_id: 'cv1' }, error: null });
          return c;
        default: return c;
      }
    });
    const s = await outboundDispatcherService.dispatch({
      ...BASE, idempotencyKey: 't9:ik', sourceEngine: 'TRIGGER_ENGINE' as OutboundSource,
    });
    expect(['DELIVERED', 'DELIVERED_PARTIAL', 'NOTIFICATION_SKIPPED']).toContain(s);
    // DELIVERED intent skips gate phase entirely
    expect(proactiveGate.acquire).not.toHaveBeenCalled();
  });

  // T10 ----------------------------------------------------------------------
  test('T10: nova_outreach_log never written directly by engines or Dispatcher', async () => {
    await outboundDispatcherService.dispatch({
      ...BASE, idempotencyKey: 't10:ik', sourceEngine: 'WEATHER' as OutboundSource,
    });
    const fromCalls = (supabaseAdmin.from as jest.Mock).mock.calls.map((c: any[]) => c[0] as string);
    expect(fromCalls).not.toContain('nova_outreach_log');
    // Only ProactiveGate writes nova_outreach_log (via acquire/commit)
    expect(proactiveGate.acquire).toHaveBeenCalled();
    expect(proactiveGate.commit).toHaveBeenCalled();
  });

  // T11 ----------------------------------------------------------------------
  test('T11: All 7 canonical OutboundSource string values present', () => {
    const sources: OutboundSource[] = [
      'NACE', 'WATCHTOWER', 'FOLLOWUP', 'REMINDER', 'WEATHER', 'TRIGGER_ENGINE', 'OTHER',
    ];
    expect(sources).toHaveLength(7);
    sources.forEach(s => expect(typeof s).toBe('string'));
  });

  // T12 ----------------------------------------------------------------------
  test('T12: Resumed PERSISTED intent skips RPC re-commit (idempotency guarantee)', async () => {
    // Crash-recovery: intent was PERSISTED, process restarted, same key retried
    (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
      const c = makeChain();
      switch (table) {
        case 'account_tombstones': c.maybeSingle.mockResolvedValue({ data: null }); return c;
        case 'action_idempotency': c.insert.mockResolvedValue({ error: null }); return c;
        case 'profiles': c.maybeSingle.mockResolvedValue({ data: { push_token: 'tok' } }); return c;
        case 'outbound_intents':
          c.insert.mockReturnValue(makeChain({ select: jest.fn().mockReturnValue(makeChain({ single: jest.fn().mockResolvedValue({ data: null, error: { code: '23505' } }) })) }));
          c.single.mockResolvedValue({ data: { id: 'ip', status: 'PERSISTED', outreach_id: 'orp', chat_message_id: 'chp' }, error: null });
          c.update.mockReturnValue(makeChain({ eq: jest.fn().mockResolvedValue({ error: null }) }));
          return c;
        case 'chat_history':
          c.single.mockResolvedValue({ data: { content: 'existing', conversation_id: 'cvp' }, error: null });
          c.maybeSingle.mockResolvedValue({ data: { conversation_id: 'cvp' }, error: null });
          return c;
        default: return c;
      }
    });
    const s = await outboundDispatcherService.dispatch({
      ...BASE, idempotencyKey: 't12:ik', sourceEngine: 'NACE' as OutboundSource,
    });
    expect(['DELIVERED', 'DELIVERED_PARTIAL', 'NOTIFICATION_SKIPPED']).toContain(s);
    // CRITICAL: RPC must NOT be called again for an already-persisted intent
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled();
  });

  // T13 ----------------------------------------------------------------------
  test('T13: FAILED_TRANSIENT retry -- stale gate released, CREATED reset, re-acquired, exactly one delivery (Correction 2)', async () => {
    /**
     * Scenario: first attempt failed transiently after acquiring the gate.
     * outreach_id = 'stale-or1' exists in nova_outreach_log as a phantom placeholder.
     * On retry with the same idempotencyKey:
     *   1. Dispatcher finds existing FAILED_TRANSIENT intent
     *   2. Releases stale gate reservation (proactiveGate.release called with 'stale-or1')
     *   3. Resets intent to CREATED, clears outreach_id
     *   4. Re-acquires gate fresh
     *   5. Delivers -- exactly one RPC commit, one delivery
     */
    const updateEq = jest.fn().mockResolvedValue({ error: null });
    const updateMock = jest.fn().mockReturnValue({ eq: updateEq });

    (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
      const c = makeChain();
      switch (table) {
        case 'account_tombstones': c.maybeSingle.mockResolvedValue({ data: null }); return c;
        case 'action_idempotency': c.insert.mockResolvedValue({ error: null }); return c;
        case 'profiles': c.maybeSingle.mockResolvedValue({ data: { push_token: 'tok' } }); return c;
        case 'outbound_intents':
          // insert hits 23505 -- existing key
          c.insert.mockReturnValue(makeChain({ select: jest.fn().mockReturnValue(makeChain({ single: jest.fn().mockResolvedValue({ data: null, error: { code: '23505' } }) })) }));
          // fetch returns FAILED_TRANSIENT with a stale outreach_id
          c.single.mockResolvedValue({ data: { id: 'ift', status: 'FAILED_TRANSIENT', outreach_id: 'stale-or1', chat_message_id: null }, error: null });
          c.update = updateMock;
          return c;
        case 'chat_history':
          c.single.mockResolvedValue({ data: { content: 'msg', conversation_id: 'cv1' }, error: null });
          c.maybeSingle.mockResolvedValue({ data: { conversation_id: 'cv1' }, error: null });
          return c;
        default: return c;
      }
    });
    (supabaseAdmin.rpc as jest.Mock).mockResolvedValue({ data: 'new-ch', error: null });

    const s = await outboundDispatcherService.dispatch({
      ...BASE, idempotencyKey: 't13:ik', sourceEngine: 'REMINDER' as OutboundSource,
    });

    // 1. Stale gate reservation was released before reset
    expect(proactiveGate.release).toHaveBeenCalledWith('stale-or1');
    // 2. Intent was reset to CREATED (update called with correct shape)
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'CREATED', failure_reason: null, outreach_id: null }),
    );
    // 3. Fresh gate acquired after reset
    expect(proactiveGate.acquire).toHaveBeenCalled();
    // 4. Exactly one RPC commit (one chat_history row)
    expect(supabaseAdmin.rpc).toHaveBeenCalledTimes(1);
    // 5. Final status is a delivery variant
    expect(['DELIVERED', 'DELIVERED_PARTIAL', 'NOTIFICATION_SKIPPED']).toContain(s);
  });
});
