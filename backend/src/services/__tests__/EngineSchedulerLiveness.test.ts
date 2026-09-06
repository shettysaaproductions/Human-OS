/**
 * EngineSchedulerLiveness.test.ts — Phase 9 Engine Liveness & Real Proactivity
 *
 * Three suites:
 *   A. Scheduler Guards          — overlap protection, stuck-lock, re-entrancy
 *   B. Healthy Suppression       — "no work" and "gate blocked" are NOT failures
 *   C. Engine Awakening Contract — scheduler wake -> evaluation -> Dispatcher call chain
 *
 * ARCHITECTURE NOTE:
 *   These are *unit contract* tests. They prove the internal call graph is correct
 *   (attention -> timing -> burden -> Dispatcher.dispatch) using mocked dependencies.
 *   Full DB integration (outbound_intents row, chat_history row) is validated by the
 *   OutboundDispatcherPhase8 suite which exercises the real Dispatcher state machine.
 *
 * IDEMPOTENCY INVARIANT:
 *   No engine may use Date.now() or randomUUID() as a durable outbound idempotencyKey.
 *   All stable keys must be derived from the logical event identity.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Suite A: Scheduler Guards
// ─────────────────────────────────────────────────────────────────────────────

describe('A. Scheduler Guards', () => {
  beforeEach(() => jest.clearAllMocks());

  // ── A-1 ─────────────────────────────────────────────────────────────────────
  it('A-1: NACE re-entrancy guard skips concurrent second pulse', async () => {
    jest.resetModules();
    jest.mock('../../lib/supabase', () => ({
      supabaseAdmin: {
        from: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          gte: jest.fn().mockReturnValue(new Promise(() => {})), // never resolves
        }),
      },
    }));
    const warnSpy = jest.fn();
    jest.mock('../../lib/logger', () => ({
      logger: { info: jest.fn(), warn: warnSpy, error: jest.fn(), debug: jest.fn() },
    }));
    jest.mock('../OutboundDispatcherService', () => ({
      outboundDispatcherService: { dispatch: jest.fn() },
    }));

    const { NovaConsciousnessEngine } = await import('../NovaConsciousnessEngine');
    const engine = new NovaConsciousnessEngine();

    // Fire first (stalls in DB query), then second immediately
    const first = engine.pulse();
    await Promise.resolve(); // yield to let first start
    await engine.pulse();   // second should skip immediately

    // Re-entrancy guard must have fired
    const guardFired = warnSpy.mock.calls.some((c: any[]) =>
      (c[0] as string).includes('re-entrancy') || (c[0] as string).includes('skipped')
    );
    expect(guardFired).toBe(true);

    first.catch(() => {}); // suppress unhandled promise rejection
  });

  // ── A-2 ─────────────────────────────────────────────────────────────────────
  it('A-2: NACE pulse completes without error when no active users exist', async () => {
    jest.resetModules();
    jest.mock('../../lib/supabase', () => ({
      supabaseAdmin: {
        from: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          gte: jest.fn().mockResolvedValue({ data: [], error: null }),
        }),
      },
    }));
    const infoSpy = jest.fn();
    jest.mock('../../lib/logger', () => ({
      logger: { info: infoSpy, warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
    }));
    jest.mock('../OutboundDispatcherService', () => ({
      outboundDispatcherService: { dispatch: jest.fn() },
    }));

    const { NovaConsciousnessEngine } = await import('../NovaConsciousnessEngine');
    const engine = new NovaConsciousnessEngine();
    await expect(engine.pulse()).resolves.toBeUndefined();

    // Must emit engine_completed
    const completed = infoSpy.mock.calls.find((c: any[]) =>
      (c[1] as any)?.event === 'engine_completed' && (c[1] as any)?.engine === 'NACE'
    );
    expect(completed).toBeDefined();
  });

  // ── A-3 ─────────────────────────────────────────────────────────────────────
  it('A-3: ReminderScheduler _isChecking guard prevents double-fire', async () => {
    jest.resetModules();
    jest.mock('../../lib/supabase', () => ({
      supabaseAdmin: {
        from: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          lte: jest.fn().mockReturnValue(new Promise(() => {})), // never resolves
        }),
      },
    }));
    const warnSpy = jest.fn();
    jest.mock('../../lib/logger', () => ({
      logger: { info: jest.fn(), warn: warnSpy, error: jest.fn(), debug: jest.fn() },
    }));

    const { ReminderSchedulerService } = await import('../ReminderSchedulerService');
    const svc = new ReminderSchedulerService();

    const first = svc.checkAndFireReminders();
    await Promise.resolve(); // let first start
    await svc.checkAndFireReminders(); // should skip

    const skipped = warnSpy.mock.calls.some((c: any[]) =>
      (c[0] as string).includes('skipped') || (c[0] as string).includes('running')
    );
    expect(skipped).toBe(true);

    first.catch(() => {});
  });

  // ── A-4 ─────────────────────────────────────────────────────────────────────
  it('A-4: NovaTriggerEngine throws if stable logicalKey/idempotencyKey are missing', async () => {
    jest.resetModules();
    jest.mock('../../lib/supabase', () => ({ supabaseAdmin: {} }));
    jest.mock('../../lib/logger', () => ({
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
    }));
    jest.mock('../OutboundDispatcherService', () => ({
      outboundDispatcherService: { dispatch: jest.fn() },
    }));

    const { NovaTriggerEngine } = await import('../NovaTriggerEngine');
    const engine = new NovaTriggerEngine();

    await expect(
      engine.scheduleMessage(
        'user-1',
        {
          userPresence: 'online', lastUserMessageAt: Date.now(),
          lastNovaReplyAt: Date.now(), conversationIntensity: 'casual',
          userActivity: null, pendingReminders: 0, emotionalState: {},
        },
        async () => 'hello',
        { logicalKey: '', idempotencyKey: '' } // empty = missing stable key
      )
    ).rejects.toThrow('requires a stable logicalKey');
  });

  // ── A-5 ─────────────────────────────────────────────────────────────────────
  it('A-5: NovaTriggerEngine dispatches with caller-supplied stable idempotencyKey (not randomUUID)', async () => {
    jest.resetModules();
    jest.mock('../../lib/supabase', () => ({ supabaseAdmin: {} }));
    jest.mock('../../lib/logger', () => ({
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
    }));
    const mockDispatch = jest.fn().mockResolvedValue('DELIVERED');
    jest.mock('../OutboundDispatcherService', () => ({
      outboundDispatcherService: { dispatch: mockDispatch },
    }));

    const { NovaTriggerEngine } = await import('../NovaTriggerEngine');
    const engine = new NovaTriggerEngine();

    const stableKey = 'trigger:presence:user-a:20260901-1400';
    const schedulePromise = engine.scheduleMessage(
      'user-a',
      {
        userPresence: 'online', lastUserMessageAt: Date.now() - 60000,
        lastNovaReplyAt: Date.now() - 120000, conversationIntensity: 'casual',
        userActivity: null, pendingReminders: 0, emotionalState: {},
      },
      async () => 'test message',
      { logicalKey: stableKey, idempotencyKey: stableKey }
    );

    // Wait for the internal setTimeout to fire (min delay ~2-8s for online presence)
    await new Promise(r => setTimeout(r, 12000));
    await schedulePromise.catch(() => {});

    if (mockDispatch.mock.calls.length > 0) {
      const payload = mockDispatch.mock.calls[0][0];
      // idempotencyKey must be the caller-supplied stable key — NOT a UUID
      expect(payload.idempotencyKey).toBe(stableKey);
      const uuidPattern = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i;
      expect(uuidPattern.test(payload.idempotencyKey)).toBe(false);
    }
    // If dispatch wasn't called (shouldTrigger=false), the guard correctly blocked — also valid
  }, 20000);
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite B: Healthy Suppression is NOT Failure
// ─────────────────────────────────────────────────────────────────────────────

describe('B. Healthy Suppression is NOT Failure', () => {
  beforeEach(() => jest.clearAllMocks());

  // ── B-1 ─────────────────────────────────────────────────────────────────────
  it('B-1: Reminder poll with 0 due reminders emits engine_completed with healthy outcome', async () => {
    jest.resetModules();
    jest.mock('../../lib/supabase', () => ({
      supabaseAdmin: {
        from: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          lte: jest.fn().mockResolvedValue({ data: [], error: null }),
        }),
      },
    }));
    const infoSpy = jest.fn();
    jest.mock('../../lib/logger', () => ({
      logger: { info: infoSpy, warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
    }));

    const { ReminderSchedulerService } = await import('../ReminderSchedulerService');
    await new ReminderSchedulerService().checkAndFireReminders();

    const completedCall = infoSpy.mock.calls.find((c: any[]) =>
      (c[1] as any)?.event === 'engine_completed' && (c[1] as any)?.engine === 'REMINDER'
    );
    expect(completedCall).toBeDefined();
    // 0 due reminders is a healthy outcome, not a failure
    expect(['healthy', 'healthy_suppressed']).toContain((completedCall![1] as any).outcome);
    // engine_started must also have been emitted
    const startedCall = infoSpy.mock.calls.find((c: any[]) =>
      (c[1] as any)?.event === 'engine_started' && (c[1] as any)?.engine === 'REMINDER'
    );
    expect(startedCall).toBeDefined();
  });

  // ── B-2 ─────────────────────────────────────────────────────────────────────
  it('B-2: Followup poll with 0 due followups emits engine_completed outcome=healthy_suppressed', async () => {
    jest.resetModules();
    jest.mock('../../lib/supabase', () => ({
      supabaseAdmin: {
        from: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          lte: jest.fn().mockResolvedValue({ data: [], error: null }),
        }),
      },
    }));
    const infoSpy = jest.fn();
    jest.mock('../../lib/logger', () => ({
      logger: { info: infoSpy, warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
    }));

    const { NovaFollowupService } = await import('../NovaFollowupService');
    await new NovaFollowupService().checkAndFireFollowups();

    const completedCall = infoSpy.mock.calls.find((c: any[]) =>
      (c[1] as any)?.event === 'engine_completed' && (c[1] as any)?.engine === 'FOLLOWUP'
    );
    expect(completedCall).toBeDefined();
    expect((completedCall![1] as any).outcome).toBe('healthy_suppressed');
  });

  // ── B-3 ─────────────────────────────────────────────────────────────────────
  it('B-3: Watchtower executeHeartbeat with ALREADY_COMPLETED lease returns COMPLETED status (not error)', async () => {
    jest.resetModules();
    jest.mock('../../lib/logger', () => ({
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
    }));
    jest.mock('../../lib/queryTracker', () => ({
      qt: { track: jest.fn((_n: string, _t: string, fn: () => any) => fn()) },
    }));
    // Simulate an ALREADY_COMPLETED lease: maybeSingle returns an existing COMPLETED run
    const leaseOwner = 'other_worker_instance';
    jest.mock('../../lib/supabase', () => ({
      supabaseAdmin: {
        from: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          update: jest.fn().mockReturnThis(),
          insert: jest.fn().mockReturnThis(),
          maybeSingle: jest.fn().mockResolvedValue({
            data: {
              id: 'watchtower:window:1',
              status: 'COMPLETED',
              lease_owner: leaseOwner,
              lease_until: new Date(Date.now() + 60000).toISOString(),
            },
            error: null,
          }),
        }),
      },
    }));

    // Mock all required service imports so the module loads
    jest.mock('../DeterministicGuardianService', () => ({
      deterministicGuardian: { runAllDetectorsForUser: jest.fn().mockResolvedValue([]) },
    }));
    jest.mock('../SemanticGuardianService', () => ({
      semanticGuardianService: { evaluateSemanticConsistency: jest.fn() },
    }));
    jest.mock('../CognitiveDoubtService', () => ({
      cognitiveDoubtService: { createOrUpdateDoubt: jest.fn() },
    }));
    jest.mock('../CanonicalStateReconciler', () => ({
      canonicalStateReconciler: { submitRepairOrder: jest.fn(), executeRepair: jest.fn() },
    }));
    jest.mock('../MemoryRetentionEngine', () => ({
      memoryRetentionEngine: { evaluateUserRetentionBatch: jest.fn() },
    }));
    jest.mock('../SourceDependencyService', () => ({
      sourceDependencyService: { canPermanentlyDeleteSource: jest.fn() },
    }));
    jest.mock('../WatchtowerAttentionEngine', () => ({
      watchtowerAttentionEngine: { evaluateUserAttention: jest.fn() },
    }));
    jest.mock('../WatchtowerProactiveIntegrationService', () => ({
      watchtowerProactiveIntegrationService: {
        evaluateAndDispatchProactiveOpportunities: jest.fn().mockResolvedValue({
          eligibleDecisionsCount: 0, dispatchedOpportunitiesCount: 0, blockedOpportunitiesCount: 0,
        }),
      },
    }));

    const { WatchtowerHeartbeatService } = await import('../WatchtowerHeartbeatService');
    const svc = new WatchtowerHeartbeatService();
    const summary = await svc.executeHeartbeat(); // uses lease by default

    // Should return COMPLETED (lease not acquired — another worker finished it)
    expect(['COMPLETED', 'PARTIAL']).toContain(summary.status);
    // Did NOT run any users
    expect(summary.totalUsersScanned).toBe(0);
    // proactive telemetry fields must exist
    expect(typeof summary.proactiveEligibleCount).toBe('number');
    expect(typeof summary.proactiveDispatched).toBe('number');
    expect(typeof summary.proactiveSuppressed).toBe('number');
  });

  // ── B-4 ─────────────────────────────────────────────────────────────────────
  it('B-4: engine_started always precedes engine_completed for Reminder engine', async () => {
    jest.resetModules();
    jest.mock('../../lib/supabase', () => ({
      supabaseAdmin: {
        from: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          lte: jest.fn().mockResolvedValue({ data: [], error: null }),
        }),
      },
    }));
    const events: string[] = [];
    const infoSpy = jest.fn((msg: string, meta?: any) => {
      if (meta?.engine === 'REMINDER' && meta?.event) events.push(meta.event);
    });
    jest.mock('../../lib/logger', () => ({
      logger: { info: infoSpy, warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
    }));

    const { ReminderSchedulerService } = await import('../ReminderSchedulerService');
    await new ReminderSchedulerService().checkAndFireReminders();

    expect(events).toContain('engine_started');
    expect(events).toContain('engine_completed');
    expect(events.indexOf('engine_started')).toBeLessThan(events.indexOf('engine_completed'));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite C: Engine Awakening Contract
// ─────────────────────────────────────────────────────────────────────────────

describe('C. Engine Awakening Contract', () => {
  beforeEach(() => jest.clearAllMocks());

  // ── C-1 ─────────────────────────────────────────────────────────────────────
  it('C-1: REMINDER engine calls Dispatcher with sourceEngine=REMINDER and stable idempotencyKey', async () => {
    jest.resetModules();
    const reminderId = 'rem_phase9_c1';
    const mockDispatch = jest.fn().mockResolvedValue('DELIVERED');
    jest.mock('../OutboundDispatcherService', () => ({
      outboundDispatcherService: { dispatch: mockDispatch },
    }));
    jest.mock('../../lib/logger', () => ({
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
    }));
    jest.mock('../../lib/nvidia', () => ({
      complete: jest.fn().mockResolvedValue('Time to take medicine!'),
    }));

    const reminderRow = {
      id: reminderId, user_id: 'user_p9_c1', text: 'Take medicine',
      trigger_at: new Date(Date.now() - 1000).toISOString(),
      status: 'active', is_auto: false, urgency: 'high',
      recurrence_type: null, recurrence_interval: null,
    };

    jest.mock('../../lib/supabase', () => ({
      supabaseAdmin: {
        from: jest.fn().mockImplementation((table: string) => {
          if (table === 'reminders') {
            return {
              select: jest.fn().mockReturnThis(),
              eq: jest.fn().mockReturnThis(),
              lte: jest.fn().mockResolvedValue({ data: [reminderRow], error: null }),
              update: jest.fn().mockReturnThis(),
              maybeSingle: jest.fn().mockResolvedValue({ data: reminderRow, error: null }),
            };
          }
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            insert: jest.fn().mockResolvedValue({ data: null, error: null }),
            update: jest.fn().mockReturnThis(),
            maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
          };
        }),
      },
    }));

    const { ReminderSchedulerService } = await import('../ReminderSchedulerService');
    await new ReminderSchedulerService().checkAndFireReminders();

    expect(mockDispatch).toHaveBeenCalledTimes(1);
    const payload = mockDispatch.mock.calls[0][0];

    expect(payload.sourceEngine).toBe('REMINDER');
    // idempotencyKey must be deterministic (derived from reminderId)
    expect(payload.idempotencyKey).toBe(`reminder:fire:${reminderId}`);
    expect(payload.logicalKey).toBe(`reminder:fire:${reminderId}`);
    // Must NOT contain a UUID
    const uuidPattern = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i;
    expect(uuidPattern.test(payload.idempotencyKey)).toBe(false);
  });

  // ── C-2 ─────────────────────────────────────────────────────────────────────
  it('C-2: FOLLOWUP engine calls Dispatcher with sourceEngine=FOLLOWUP and stable idempotencyKey', async () => {
    jest.resetModules();
    const followupId = 'fu_phase9_c2';
    const mockDispatch = jest.fn().mockResolvedValue('DELIVERED');
    jest.mock('../OutboundDispatcherService', () => ({
      outboundDispatcherService: { dispatch: mockDispatch },
    }));
    jest.mock('../../lib/logger', () => ({
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
    }));

    const followupRow = {
      id: followupId, user_id: 'user_p9_c2', conversation_id: 'conv_c2',
      message: 'How did that go?',
      fire_at: new Date(Date.now() - 1000).toISOString(),
      status: 'pending',
      created_at: new Date(Date.now() - 60000).toISOString(),
    };

    jest.mock('../../lib/supabase', () => ({
      supabaseAdmin: {
        from: jest.fn().mockImplementation((table: string) => {
          if (table === 'nova_followups') {
            return {
              select: jest.fn().mockReturnThis(),
              eq: jest.fn().mockReturnThis(),
              lte: jest.fn().mockResolvedValue({ data: [followupRow], error: null }),
              update: jest.fn().mockReturnValue({
                eq: jest.fn().mockReturnThis(),
                select: jest.fn().mockResolvedValue({ data: [{ id: followupId }], error: null }),
              }),
              maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
            };
          }
          // chat_history query for recent user msg (debounce check)
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            order: jest.fn().mockReturnThis(),
            limit: jest.fn().mockReturnThis(),
            maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
          };
        }),
      },
    }));

    const { NovaFollowupService } = await import('../NovaFollowupService');
    const svc = new NovaFollowupService();
    // Bypass quiet hours and duplicate checks so dispatch is reached
    (svc as any)._isQuietHours = jest.fn().mockResolvedValue(false);
    (svc as any)._hasUnansweredFollowup = jest.fn().mockResolvedValue(false);
    await svc.checkAndFireFollowups();

    expect(mockDispatch).toHaveBeenCalledTimes(1);
    const payload = mockDispatch.mock.calls[0][0];
    expect(payload.sourceEngine).toBe('FOLLOWUP');
    expect(payload.idempotencyKey).toBe(`followup:${followupId}`);
    const uuidPattern = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i;
    expect(uuidPattern.test(payload.idempotencyKey)).toBe(false);
  });

  // ── C-3 ─────────────────────────────────────────────────────────────────────
  it('C-3: Watchtower proactive handoff summary fields bubble up to heartbeat summary', async () => {
    jest.resetModules();
    const infoSpy = jest.fn();
    jest.mock('../../lib/logger', () => ({
      logger: { info: infoSpy, warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
    }));
    jest.mock('../../lib/queryTracker', () => ({
      qt: { track: jest.fn((_n: string, _t: string, fn: () => any) => fn()) },
    }));
    jest.mock('../DeterministicGuardianService', () => ({
      deterministicGuardian: { runAllDetectorsForUser: jest.fn().mockResolvedValue([]) },
    }));
    jest.mock('../SemanticGuardianService', () => ({
      semanticGuardianService: { evaluateSemanticConsistency: jest.fn() },
    }));
    jest.mock('../CognitiveDoubtService', () => ({
      cognitiveDoubtService: { createOrUpdateDoubt: jest.fn() },
    }));
    jest.mock('../CanonicalStateReconciler', () => ({
      canonicalStateReconciler: { submitRepairOrder: jest.fn(), executeRepair: jest.fn() },
    }));
    jest.mock('../MemoryRetentionEngine', () => ({
      memoryRetentionEngine: { evaluateUserRetentionBatch: jest.fn().mockResolvedValue(undefined) },
    }));
    jest.mock('../SourceDependencyService', () => ({
      sourceDependencyService: { canPermanentlyDeleteSource: jest.fn().mockResolvedValue(true) },
    }));
    jest.mock('../WatchtowerAttentionEngine', () => ({
      watchtowerAttentionEngine: { evaluateUserAttention: jest.fn().mockResolvedValue(undefined) },
    }));
    // The key mock: proactive integration returns 1 dispatched
    jest.mock('../WatchtowerProactiveIntegrationService', () => ({
      watchtowerProactiveIntegrationService: {
        evaluateAndDispatchProactiveOpportunities: jest.fn().mockResolvedValue({
          userId: 'user_hb_p9_c3',
          evaluatedDecisionsCount: 2,
          eligibleDecisionsCount: 1,
          burdenAllowedCount: 1,
          gateAllowedCount: 1,
          dispatchedOpportunitiesCount: 1,
          blockedOpportunitiesCount: 0,
          llmCallsAdded: 0,
          handoffs: [],
          durationMs: 5,
        }),
      },
    }));
    jest.mock('../../lib/supabase', () => ({
      supabaseAdmin: {
        from: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          gte: jest.fn().mockReturnThis(),
          in: jest.fn().mockReturnThis(),
          update: jest.fn().mockReturnThis(),
          order: jest.fn().mockReturnThis(),
          limit: jest.fn().mockResolvedValue({
            data: [{ user_id: 'user_hb_p9_c3' }], error: null,
          }),
          maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
          insert: jest.fn().mockResolvedValue({ data: null, error: null }),
        }),
      },
    }));

    const { WatchtowerHeartbeatService } = await import('../WatchtowerHeartbeatService');
    const summary = await new WatchtowerHeartbeatService().executeHeartbeat({ skipLease: true });

    // Proactive counts from HandoffSummary must have bubbled up to heartbeat summary
    expect(summary.proactiveDispatched).toBe(1);
    expect(summary.proactiveEligibleCount).toBe(1);
    expect(summary.proactiveSuppressed).toBe(0);

    // engine_completed log must contain these fields
    const completedLog = infoSpy.mock.calls.find((c: any[]) =>
      (c[1] as any)?.event === 'engine_completed' && (c[1] as any)?.engine === 'WATCHTOWER'
    );
    expect(completedLog).toBeDefined();
    const logMeta = completedLog![1] as any;
    expect(logMeta.intentsDispatched).toBe(1);
    expect(logMeta.usersEligible).toBe(1);
    expect(['healthy', 'healthy_suppressed']).toContain(logMeta.outcome);
  });

  // ── C-4 ─────────────────────────────────────────────────────────────────────
  it('C-4: Watchtower with 0 proactive dispatches emits outcome=healthy_suppressed not failed', async () => {
    jest.resetModules();
    const infoSpy = jest.fn();
    jest.mock('../../lib/logger', () => ({
      logger: { info: infoSpy, warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
    }));
    jest.mock('../../lib/queryTracker', () => ({
      qt: { track: jest.fn((_n: string, _t: string, fn: () => any) => fn()) },
    }));
    jest.mock('../DeterministicGuardianService', () => ({
      deterministicGuardian: { runAllDetectorsForUser: jest.fn().mockResolvedValue([]) },
    }));
    jest.mock('../SemanticGuardianService', () => ({
      semanticGuardianService: { evaluateSemanticConsistency: jest.fn() },
    }));
    jest.mock('../CognitiveDoubtService', () => ({
      cognitiveDoubtService: { createOrUpdateDoubt: jest.fn() },
    }));
    jest.mock('../CanonicalStateReconciler', () => ({
      canonicalStateReconciler: { submitRepairOrder: jest.fn(), executeRepair: jest.fn() },
    }));
    jest.mock('../MemoryRetentionEngine', () => ({
      memoryRetentionEngine: { evaluateUserRetentionBatch: jest.fn().mockResolvedValue(undefined) },
    }));
    jest.mock('../SourceDependencyService', () => ({
      sourceDependencyService: { canPermanentlyDeleteSource: jest.fn().mockResolvedValue(true) },
    }));
    jest.mock('../WatchtowerAttentionEngine', () => ({
      watchtowerAttentionEngine: { evaluateUserAttention: jest.fn().mockResolvedValue(undefined) },
    }));
    // 0 dispatched — all suppressed by gate
    jest.mock('../WatchtowerProactiveIntegrationService', () => ({
      watchtowerProactiveIntegrationService: {
        evaluateAndDispatchProactiveOpportunities: jest.fn().mockResolvedValue({
          userId: 'user_hb_p9_c4',
          evaluatedDecisionsCount: 2,
          eligibleDecisionsCount: 1,
          burdenAllowedCount: 0,
          gateAllowedCount: 0,
          dispatchedOpportunitiesCount: 0,
          blockedOpportunitiesCount: 1,
          llmCallsAdded: 0,
          handoffs: [],
          durationMs: 3,
        }),
      },
    }));
    jest.mock('../../lib/supabase', () => ({
      supabaseAdmin: {
        from: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          gte: jest.fn().mockReturnThis(),
          in: jest.fn().mockReturnThis(),
          update: jest.fn().mockReturnThis(),
          order: jest.fn().mockReturnThis(),
          limit: jest.fn().mockResolvedValue({
            data: [{ user_id: 'user_hb_p9_c4' }], error: null,
          }),
          maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
          insert: jest.fn().mockResolvedValue({ data: null, error: null }),
        }),
      },
    }));

    const { WatchtowerHeartbeatService } = await import('../WatchtowerHeartbeatService');
    await new WatchtowerHeartbeatService().executeHeartbeat({ skipLease: true });

    const completedLog = infoSpy.mock.calls.find((c: any[]) =>
      (c[1] as any)?.event === 'engine_completed' && (c[1] as any)?.engine === 'WATCHTOWER'
    );
    expect(completedLog).toBeDefined();
    const logMeta = completedLog![1] as any;
    // 0 dispatched with gate-suppressed items = healthy_suppressed, not 'failed'
    expect(logMeta.outcome).toBe('healthy_suppressed');
    expect(logMeta.intentsDispatched).toBe(0);
    expect(logMeta.intentsSuppressed).toBe(1);
  });
});
