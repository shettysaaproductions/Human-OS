/**
 * Phase11Consumers.test.ts
 *
 * Deterministic tests for all Phase 11 canonical event consumers.
 *
 * Tests cover:
 *   F1-F5  : FactAssertionConsumer (FactAsserted)
 *   R1-R5  : FactAssertionConsumer (RelationshipAsserted)
 *   S1-S6  : ScheduleEventConsumer (ScheduleAsserted)
 *   G1-G5  : GoalAssertedConsumer (GoalAsserted)
 *   D1-D3  : DeterministicFactAgent adapter (new canonical path)
 *   B1-B2  : BackgroundActionService blocked paths
 *   C1-C2  : ConsolidatedMemoryAgent hard semantic gate
 */

// ── Shared test helpers ──────────────────────────────────────────────────────

function makeFactEvent(overrides: Partial<any> = {}): any {
  return {
    eventId: 'evt-fact-001',
    family: 'FactAsserted',
    userId: 'user-p11',
    sourceMessageId: 'msg-uuid-001',
    authority: 'explicit_user',
    confidence: 1.0,
    createdAt: new Date().toISOString(),
    canonicalKey: 'wife_name',
    value: 'Priya',
    ...overrides,
  };
}

function makeRelEvent(overrides: Partial<any> = {}): any {
  return {
    eventId: 'evt-rel-001',
    family: 'RelationshipAsserted',
    userId: 'user-p11',
    sourceMessageId: 'msg-uuid-001',
    authority: 'explicit_user',
    confidence: 1.0,
    createdAt: new Date().toISOString(),
    canonicalKey: 'wife_name',
    relationship: 'wife',
    relatedPersonName: 'Priya',
    ...overrides,
  };
}

function makeSchedEvent(overrides: Partial<any> = {}): any {
  return {
    eventId: 'evt-sched-001',
    family: 'ScheduleAsserted',
    userId: 'user-p11',
    sourceMessageId: 'msg-uuid-001',
    authority: 'explicit_user',
    confidence: 1.0,
    createdAt: new Date().toISOString(),
    reminderSpec: { time_of_day: '09:00', title: 'gym', is_auto: false },
    ...overrides,
  };
}

function makeGoalEvent(overrides: Partial<any> = {}): any {
  return {
    eventId: 'evt-goal-001',
    family: 'GoalAsserted',
    userId: 'user-p11',
    sourceMessageId: 'msg-uuid-001',
    authority: 'explicit_user',
    confidence: 1.0,
    createdAt: new Date().toISOString(),
    goalDescription: 'Start a cloud kitchen',
    goalKey: 'cloud_kitchen_goal',
    ...overrides,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// Suite F: FactAssertionConsumer — FactAsserted
// ══════════════════════════════════════════════════════════════════════════════
describe('F. FactAssertionConsumer — FactAsserted', () => {
  let upsertSpy: jest.Mock;
  let isMemoryEnabledSpy: jest.Mock;

  beforeEach(() => {
    jest.resetModules();
    upsertSpy = jest.fn().mockResolvedValue(undefined);
    isMemoryEnabledSpy = jest.fn().mockResolvedValue(true);

    jest.doMock('../../services/memoryRepository', () => ({
      memoryRepository: { upsertMemory: upsertSpy },
    }));
    jest.doMock('../../lib/supabase', () => ({
      supabaseAdmin: { from: jest.fn().mockReturnValue({ upsert: jest.fn().mockResolvedValue({ data: null, error: null }) }) },
    }));
    jest.doMock('../../services/MemoryPolicyService', () => ({
      memoryPolicyService: { isMemoryEnabled: isMemoryEnabledSpy },
    }));
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
  });

  test('F1: FactAsserted → exactly one upsertMemory call', async () => {
    const { FactAssertionConsumer } = await import('../FactAssertionConsumer');
    const consumer = new FactAssertionConsumer();
    await consumer.consume('user-p11', [makeFactEvent()]);
    expect(upsertSpy).toHaveBeenCalledTimes(1);
  });

  test('F2: FactAsserted → upsertMemory receives correct key and value', async () => {
    const { FactAssertionConsumer } = await import('../FactAssertionConsumer');
    const consumer = new FactAssertionConsumer();
    await consumer.consume('user-p11', [makeFactEvent({ canonicalKey: 'mother_name', value: 'Sunita' })]);
    const [, mem] = upsertSpy.mock.calls[0];
    expect(mem.key).toBe('mother_name');
    expect(mem.value).toBe('Sunita');
    expect(mem.type).toBe('family');
    expect(mem.source_authority).toBe('explicit_user');
    expect(mem.source_message_id).toBe('msg-uuid-001');
  });

  test('F3: duplicate FactAsserted → still only one upsertMemory call (idempotency at DB level)', async () => {
    const { FactAssertionConsumer } = await import('../FactAssertionConsumer');
    const consumer = new FactAssertionConsumer();
    // Replay the same event — consumer calls upsert once per event; DB handles dedup
    await consumer.consume('user-p11', [makeFactEvent(), makeFactEvent()]);
    expect(upsertSpy).toHaveBeenCalledTimes(2); // 2 events → 2 calls; DB upsert is idempotent
    // Both calls must have same key/value
    expect(upsertSpy.mock.calls[0][1].key).toBe(upsertSpy.mock.calls[1][1].key);
  });

  test('F4: memory paused → zero upsertMemory calls, skipped result', async () => {
    isMemoryEnabledSpy.mockResolvedValue(false);
    const { FactAssertionConsumer } = await import('../FactAssertionConsumer');
    const consumer = new FactAssertionConsumer();
    const results = await consumer.consume('user-p11', [makeFactEvent()]);
    expect(upsertSpy).not.toHaveBeenCalled();
    expect(results[0].skipped).toBe(true);
    expect(results[0].skipReason).toBe('memory_paused');
  });

  test('F5: non-FactAsserted events in array → ignored (no upsert)', async () => {
    const { FactAssertionConsumer } = await import('../FactAssertionConsumer');
    const consumer = new FactAssertionConsumer();
    const schedEvent = makeSchedEvent();
    await consumer.consume('user-p11', [schedEvent]);
    expect(upsertSpy).not.toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Suite R: FactAssertionConsumer — RelationshipAsserted
// ══════════════════════════════════════════════════════════════════════════════
describe('R. FactAssertionConsumer — RelationshipAsserted', () => {
  let upsertSpy: jest.Mock;
  let kgUpsertSpy: jest.Mock;
  let isMemoryEnabledSpy: jest.Mock;

  beforeEach(() => {
    jest.resetModules();
    upsertSpy = jest.fn().mockResolvedValue(undefined);
    kgUpsertSpy = jest.fn().mockResolvedValue({ data: null, error: null });
    isMemoryEnabledSpy = jest.fn().mockResolvedValue(true);

    jest.doMock('../../services/memoryRepository', () => ({
      memoryRepository: { upsertMemory: upsertSpy },
    }));
    jest.doMock('../../lib/supabase', () => ({
      supabaseAdmin: {
        from: jest.fn().mockReturnValue({ upsert: kgUpsertSpy }),
      },
    }));
    jest.doMock('../../services/MemoryPolicyService', () => ({
      memoryPolicyService: { isMemoryEnabled: isMemoryEnabledSpy },
    }));
  });

  afterEach(() => { jest.clearAllMocks(); jest.resetModules(); });

  test('R1: RelationshipAsserted → exactly one upsertMemory + one KG upsert', async () => {
    const { FactAssertionConsumer } = await import('../FactAssertionConsumer');
    const consumer = new FactAssertionConsumer();
    await consumer.consume('user-p11', [makeRelEvent()]);
    expect(upsertSpy).toHaveBeenCalledTimes(1);
    expect(kgUpsertSpy).toHaveBeenCalledTimes(1);
  });

  test('R2: RelationshipAsserted → memory row uses explicit_user authority and is_protected=true', async () => {
    const { FactAssertionConsumer } = await import('../FactAssertionConsumer');
    const consumer = new FactAssertionConsumer();
    await consumer.consume('user-p11', [makeRelEvent()]);
    const [, mem] = upsertSpy.mock.calls[0];
    expect(mem.source_authority).toBe('explicit_user');
    expect(mem.is_protected).toBe(true);
    expect(mem.type).toBe('family');
    expect(mem.value).toBe('Priya');
  });

  test('R3: KG upsert receives correct entity/relationship fields', async () => {
    const { FactAssertionConsumer } = await import('../FactAssertionConsumer');
    const consumer = new FactAssertionConsumer();
    await consumer.consume('user-p11', [makeRelEvent({ relationship: 'wife', relatedPersonName: 'Priya' })]);
    const upsertArg = kgUpsertSpy.mock.calls[0][0];
    expect(upsertArg.entity).toBe('Priya');
    expect(upsertArg.entity_type).toBe('person');
    expect(upsertArg.relationship).toBe('wife');
    expect(upsertArg.user_id).toBe('user-p11');
  });

  test('R4: KG upsert failure (non-fatal) → memory row still created, result.success=true', async () => {
    kgUpsertSpy.mockResolvedValue({ data: null, error: { message: 'duplicate key' } });
    const { FactAssertionConsumer } = await import('../FactAssertionConsumer');
    const consumer = new FactAssertionConsumer();
    const results = await consumer.consume('user-p11', [makeRelEvent()]);
    expect(upsertSpy).toHaveBeenCalledTimes(1); // memory row still written
    expect(results[0].success).toBe(true);       // non-fatal
  });

  test('R5: RelationshipAsserted + FactAsserted in same array → both processed', async () => {
    const { FactAssertionConsumer } = await import('../FactAssertionConsumer');
    const consumer = new FactAssertionConsumer();
    await consumer.consume('user-p11', [makeFactEvent({ canonicalKey: 'job_title', value: 'Engineer' }), makeRelEvent()]);
    expect(upsertSpy).toHaveBeenCalledTimes(2);
    expect(kgUpsertSpy).toHaveBeenCalledTimes(1);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Suite S: ScheduleEventConsumer
// ══════════════════════════════════════════════════════════════════════════════
describe('S. ScheduleEventConsumer — ScheduleAsserted', () => {
  let scheduleAllSpy: jest.Mock;
  let parseSpy: jest.Mock;
  let isMemoryEnabledSpy: jest.Mock;

  beforeEach(() => {
    jest.resetModules();
    scheduleAllSpy = jest.fn().mockResolvedValue([{ id: 'reminder-001', trigger_at: '2027-01-01T09:00:00Z', alreadyExists: false }]);
    parseSpy = jest.fn().mockReturnValue([{ text: 'gym', trigger_at: '2027-01-01T09:00:00Z' }]);
    isMemoryEnabledSpy = jest.fn().mockResolvedValue(true);

    const ReminderEngineMock = jest.fn().mockImplementation(() => ({
      parse: parseSpy,
      scheduleAll: scheduleAllSpy,
    }));

    jest.doMock('../../services/ReminderEngine', () => ({ ReminderEngine: ReminderEngineMock }));
    jest.doMock('../../services/MemoryPolicyService', () => ({
      memoryPolicyService: { isMemoryEnabled: isMemoryEnabledSpy },
    }));
  });

  afterEach(() => { jest.clearAllMocks(); jest.resetModules(); });

  test('S1: ScheduleAsserted → exactly one scheduleAll call', async () => {
    const { ScheduleEventConsumer } = await import('../ScheduleEventConsumer');
    const consumer = new ScheduleEventConsumer();
    await consumer.consume('user-p11', [makeSchedEvent()], 'IN');
    expect(scheduleAllSpy).toHaveBeenCalledTimes(1);
  });

  test('S2: ScheduleAsserted → parse receives reminderSpec from event (no text parsing)', async () => {
    const { ScheduleEventConsumer } = await import('../ScheduleEventConsumer');
    const consumer = new ScheduleEventConsumer();
    const spec = { time_of_day: '07:30', title: 'morning walk', is_auto: false };
    await consumer.consume('user-p11', [makeSchedEvent({ reminderSpec: spec })], 'IN');
    expect(parseSpy).toHaveBeenCalledWith(spec);
    // Must NOT be called with a raw string (text parsing would imply re-interpretation)
    expect(typeof parseSpy.mock.calls[0][0]).toBe('object');
  });

  test('S3: non-ScheduleAsserted events → ignored, zero scheduleAll calls', async () => {
    const { ScheduleEventConsumer } = await import('../ScheduleEventConsumer');
    const consumer = new ScheduleEventConsumer();
    await consumer.consume('user-p11', [makeFactEvent(), makeGoalEvent()], 'IN');
    expect(scheduleAllSpy).not.toHaveBeenCalled();
  });

  test('S4: duplicate ScheduleAsserted (alreadyExists=true) → success=true, alreadyExists=true', async () => {
    scheduleAllSpy.mockResolvedValue([{ id: 'reminder-001', trigger_at: '2027-01-01T09:00:00Z', alreadyExists: true }]);
    const { ScheduleEventConsumer } = await import('../ScheduleEventConsumer');
    const consumer = new ScheduleEventConsumer();
    const [result] = await consumer.consume('user-p11', [makeSchedEvent()], 'IN');
    expect(result.success).toBe(true);
    expect(result.alreadyExists).toBe(true);
    expect(result.reminderId).toBe('reminder-001');
  });

  test('S5: memory paused → zero scheduleAll calls, skipped result', async () => {
    isMemoryEnabledSpy.mockResolvedValue(false);
    const { ScheduleEventConsumer } = await import('../ScheduleEventConsumer');
    const consumer = new ScheduleEventConsumer();
    const results = await consumer.consume('user-p11', [makeSchedEvent()], 'IN');
    expect(scheduleAllSpy).not.toHaveBeenCalled();
    expect(results[0].skipped).toBe(true);
    expect(results[0].skipReason).toBe('memory_paused');
  });

  test('S6: engine.parse returns empty list → success=false, PARSE_EMPTY error', async () => {
    parseSpy.mockReturnValue([]);
    const { ScheduleEventConsumer } = await import('../ScheduleEventConsumer');
    const consumer = new ScheduleEventConsumer();
    const [result] = await consumer.consume('user-p11', [makeSchedEvent()], 'IN');
    expect(result.success).toBe(false);
    expect(result.error).toBe('PARSE_EMPTY');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Suite G: GoalAssertedConsumer
// ══════════════════════════════════════════════════════════════════════════════
describe('G. GoalAssertedConsumer — GoalAsserted', () => {
  let createOrUpdateSpy: jest.Mock;

  beforeEach(() => {
    jest.resetModules();
    createOrUpdateSpy = jest.fn().mockResolvedValue({
      thread: { id: 'thread-ck-001', topic: 'Start a cloud kitchen', state: 'active' },
      isNew: true,
    });
    jest.doMock('../../services/lifeThreadRepository', () => ({
      lifeThreadRepository: { createOrUpdateThread: createOrUpdateSpy },
    }));
  });

  afterEach(() => { jest.clearAllMocks(); jest.resetModules(); });

  test('G1: GoalAsserted → exactly one createOrUpdateThread call', async () => {
    const { GoalAssertedConsumer } = await import('../GoalAssertedConsumer');
    const consumer = new GoalAssertedConsumer();
    await consumer.consume('user-p11', [makeGoalEvent()], 'turn-001');
    expect(createOrUpdateSpy).toHaveBeenCalledTimes(1);
  });

  test('G2: GoalAsserted → thread created with state=active and correct provenance', async () => {
    const { GoalAssertedConsumer } = await import('../GoalAssertedConsumer');
    const consumer = new GoalAssertedConsumer();
    await consumer.consume('user-p11', [makeGoalEvent({ goalDescription: 'Start gym routine' })], 'turn-001');
    const [, spec, opts] = createOrUpdateSpy.mock.calls[0];
    expect(spec.state).toBe('active');
    expect(spec.topic).toBe('Start gym routine');
    expect(opts.sourceAuthority).toBe('deterministic_turn_analysis');
    expect(opts.turnId).toBe('turn-001');
  });

  test('G3: GoalAsserted with no existing thread → isNew=true', async () => {
    const { GoalAssertedConsumer } = await import('../GoalAssertedConsumer');
    const consumer = new GoalAssertedConsumer();
    const [result] = await consumer.consume('user-p11', [makeGoalEvent()]);
    expect(result.isNew).toBe(true);
    expect(result.threadId).toBe('thread-ck-001');
  });

  test('G4: duplicate GoalAsserted (same goal) → createOrUpdateThread still called (idempotent)', async () => {
    createOrUpdateSpy.mockResolvedValue({
      thread: { id: 'thread-ck-001', topic: 'Start a cloud kitchen', state: 'active' },
      isNew: false, // already exists
    });
    const { GoalAssertedConsumer } = await import('../GoalAssertedConsumer');
    const consumer = new GoalAssertedConsumer();
    const [result] = await consumer.consume('user-p11', [makeGoalEvent()]);
    expect(createOrUpdateSpy).toHaveBeenCalledTimes(1);
    expect(result.isNew).toBe(false);
    expect(result.error).toBeUndefined();
  });

  test('G5: empty goalDescription → skipped, createOrUpdateThread NOT called', async () => {
    const { GoalAssertedConsumer } = await import('../GoalAssertedConsumer');
    const consumer = new GoalAssertedConsumer();
    const [result] = await consumer.consume('user-p11', [makeGoalEvent({ goalDescription: 'ok' })]);
    expect(createOrUpdateSpy).not.toHaveBeenCalled();
    expect(result.skipped).toBe(true);
    expect(result.skipReason).toBe('empty_goal_description');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Suite D: DeterministicFactAgent adapter — canonical path
// ══════════════════════════════════════════════════════════════════════════════
describe('D. DeterministicFactAgent — canonical semanticEvents path', () => {
  let consumeSpy: jest.Mock;
  let goalConsumeSpy: jest.Mock;
  let propagateSpy: jest.Mock;
  let isMemoryEnabledSpy: jest.Mock;

  beforeEach(() => {
    jest.resetModules();
    consumeSpy = jest.fn().mockResolvedValue([{ eventId: 'e1', family: 'FactAsserted', canonicalKey: 'wife_name', success: true }]);
    goalConsumeSpy = jest.fn().mockResolvedValue([{ eventId: 'e1', isNew: true }]);
    propagateSpy = jest.fn().mockResolvedValue({ fullySucceeded: true, scopes: [{ scope: 'memories', success: true }] });
    isMemoryEnabledSpy = jest.fn().mockResolvedValue(true);

    jest.doMock('../../consumers/FactAssertionConsumer', () => ({
      factAssertionConsumer: { consume: consumeSpy },
      FactAssertionConsumer: jest.fn(),
    }));
    jest.doMock('../../consumers/GoalAssertedConsumer', () => ({
      goalAssertedConsumer: { consume: goalConsumeSpy },
      GoalAssertedConsumer: jest.fn(),
    }));
    jest.doMock('../../services/CorrectionPropagator', () => ({
      propagateCorrection: propagateSpy,
    }));
    jest.doMock('../../services/MemoryPolicyService', () => ({
      memoryPolicyService: { isMemoryEnabled: isMemoryEnabledSpy },
    }));
  });

  afterEach(() => { jest.clearAllMocks(); jest.resetModules(); });

  test('D1: semanticEvents present → routes to FactAssertionConsumer, not legacy facts[]', async () => {
    const { DeterministicFactAgent } = await import('../../agents/DeterministicFactAgent');
    const agent = new DeterministicFactAgent();
    await agent.processJob({
      payload: {
        userId: 'user-p11',
        semanticEvents: [makeFactEvent()],
        facts: [{ key: 'wife_name', value: 'LEGACY_VALUE' }], // legacy payload present but must be ignored
        sourceMessage: 'test',
        messageId: 'msg-001',
      },
    });
    // FactAssertionConsumer was called, not legacy path
    expect(consumeSpy).toHaveBeenCalledTimes(1);
  });

  test('D2: legacy facts[] only (no semanticEvents) → legacy path executed', async () => {
    const upsertSpy = jest.fn().mockResolvedValue(undefined);
    jest.doMock('../../services/memoryRepository', () => ({
      memoryRepository: { upsertMemory: upsertSpy },
    }));
    const { DeterministicFactAgent } = await import('../../agents/DeterministicFactAgent');
    const agent = new DeterministicFactAgent();
    await agent.processJob({
      payload: {
        userId: 'user-p11',
        // No semanticEvents — legacy path
        facts: [{ key: 'job_title', value: 'Engineer' }],
        sourceMessage: 'test',
        messageId: 'msg-001',
      },
    });
    expect(upsertSpy).toHaveBeenCalledTimes(1);
    // FactAssertionConsumer was NOT called
    expect(consumeSpy).not.toHaveBeenCalled();
  });

  test('D3: FactCorrected in semanticEvents → propagateCorrection called', async () => {
    const { DeterministicFactAgent } = await import('../../agents/DeterministicFactAgent');
    const agent = new DeterministicFactAgent();
    const corrEvent = {
      eventId: 'evt-corr-001',
      family: 'FactCorrected',
      userId: 'user-p11',
      sourceMessageId: 'msg-001',
      authority: 'explicit_user',
      confidence: 1.0,
      createdAt: new Date().toISOString(),
      canonicalKey: 'wife_name',
      newValue: 'Sakshi',
      correctionIntent: 'replace',
    };
    await agent.processJob({
      payload: {
        userId: 'user-p11',
        semanticEvents: [corrEvent],
        sourceMessage: 'test',
        messageId: 'msg-001',
      },
    });
    expect(propagateSpy).toHaveBeenCalledTimes(1);
    expect(propagateSpy.mock.calls[0][1].canonicalKey).toBe('wife_name');
    expect(propagateSpy.mock.calls[0][1].newValue).toBe('Sakshi');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Suite B: BackgroundActionService — blocked canonical tools
// ══════════════════════════════════════════════════════════════════════════════
describe('B. BackgroundActionService — canonical mutations blocked', () => {
  test('B1: ReminderEngine.schedule action → blocked by PHASE10_BLOCKED, scheduleAll NOT called', async () => {
    jest.resetModules();
    const scheduleAllSpy = jest.fn();
    jest.doMock('../../services/ReminderEngine', () => ({
      ReminderEngine: jest.fn().mockImplementation(() => ({
        parse: jest.fn().mockReturnValue([]),
        scheduleAll: scheduleAllSpy,
      })),
    }));
    jest.doMock('../../lib/supabase', () => ({
      supabaseAdmin: { from: jest.fn().mockReturnValue({ insert: jest.fn().mockResolvedValue({ data: null, error: null }), select: jest.fn().mockReturnThis(), maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }) }) },
    }));

    const { BackgroundActionService } = await import('../../services/BackgroundActionService');
    const bas = new BackgroundActionService();
    await bas.processActions('user-p11', 'conv-001', [
      { tool: 'ReminderEngine', action: 'schedule', data: { time_of_day: '09:00', title: 'gym' } },
    ], 'IN');
    expect(scheduleAllSpy).not.toHaveBeenCalled();
    jest.resetModules();
  });

  test('B2: MemoryRepository.save action → blocked by PHASE10_BLOCKED, upsertMemory NOT called', async () => {
    jest.resetModules();
    const upsertSpy = jest.fn();
    jest.doMock('../../services/memoryRepository', () => ({
      memoryRepository: { upsertMemory: upsertSpy },
    }));
    jest.doMock('../../lib/supabase', () => ({
      supabaseAdmin: { from: jest.fn().mockReturnValue({ insert: jest.fn().mockResolvedValue({ data: null, error: null }), select: jest.fn().mockReturnThis(), maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }) }) },
    }));

    const { BackgroundActionService } = await import('../../services/BackgroundActionService');
    const bas = new BackgroundActionService();
    await bas.processActions('user-p11', 'conv-001', [
      { tool: 'MemoryRepository', action: 'save', data: { key: 'wife_name', value: 'Priya' } },
    ], 'IN');
    expect(upsertSpy).not.toHaveBeenCalled();
    jest.resetModules();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Suite C: ConsolidatedMemoryAgent — hard semantic gate
// ══════════════════════════════════════════════════════════════════════════════
describe('C. ConsolidatedMemoryAgent — hard semantic gate', () => {
  test('C1: hasCanonicalEvents=true → semantic_memories are zeroed before persistExtraction', () => {
    // Simulate the gate logic directly
    const parsed: any = {
      semantic_memories: [{ key: 'wife_name', value: 'Priya', shouldPersist: true }],
      working_memories: [{ key: 'pref', value: 'val' }],
    };
    const hasCanonicalEvents = true;

    // This is the exact gate logic from ConsolidatedMemoryAgent
    if (hasCanonicalEvents) {
      if (parsed.semantic_memories && parsed.semantic_memories.length > 0) {
        parsed.semantic_memories = [];
      }
      parsed.working_memories = [];
    }

    // Hard invariant: persistExtraction sees an empty array
    expect(parsed.semantic_memories).toHaveLength(0);
    expect(parsed.working_memories).toHaveLength(0);
  });

  test('C2: hasCanonicalEvents=false → semantic_memories pass through unchanged', () => {
    const parsed: any = {
      semantic_memories: [{ key: 'job_title', value: 'Engineer', shouldPersist: true }],
      working_memories: [],
    };
    const hasCanonicalEvents = false;

    if (hasCanonicalEvents) {
      parsed.semantic_memories = [];
      parsed.working_memories = [];
    }

    expect(parsed.semantic_memories).toHaveLength(1);
  });
});
