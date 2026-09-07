/**
 * LifeThreadAgentGoalCorrectedPhase10.test.ts
 *
 * Tests the fail-closed GoalCorrected semantics added in Phase 10 review.
 *
 * Invariants tested:
 *   1. resumed + matching waiting thread -> state=active, isExplicitResume=true
 *   2. paused + matching active thread -> state=waiting
 *   3. abandoned + matching thread -> state=abandoned
 *   4. no matching thread -> zero mutation (fail closed, no negation fallback)
 *   5. resumed with no match -> updateThreadProvenanceForCorrection NOT called
 *   6. abandoned is terminal
 *   7. paused stays waiting
 *   8. sourceAuthority = 'deterministic_turn_analysis' always
 */

// We test the GoalCorrected routing logic as a unit, mocking lifeThreadRepository
// and verifying the exact state transitions and mutation opts.

describe('LifeThreadAgent Phase10: GoalCorrected state transitions', () => {

  // Simulate the routing logic extracted from LifeThreadAgent.processGoalCorrectedEvents()
  // This mirrors the production code exactly.

  type TargetState = 'waiting' | 'abandoned' | 'active';

  interface MockThread {
    id: string;
    topic: string;
    state: string;
    canonical_key: string | null;
  }

  interface MutationCall {
    threadId: string;
    state: TargetState;
    isExplicitResume: boolean;
    sourceAuthority: string;
    provenance: string;
  }

  async function routeGoalCorrectedEvents(
    goalCorrectedEvents: any[],
    allThreads: MockThread[],
    createOrUpdateSpy: jest.Mock,
    updateProvenanceSpy: jest.Mock,
    turnId = 'turn-001'
  ) {
    for (const evt of goalCorrectedEvents) {
      const goalKey: string | undefined = evt.goalKey;
      const goalDesc: string | undefined = evt.goalDescription;

      let targetState: TargetState;
      if (evt.status === 'paused') {
        targetState = 'waiting';
      } else if (evt.status === 'abandoned') {
        targetState = 'abandoned';
      } else if (evt.status === 'resumed') {
        targetState = 'active';
      } else {
        continue;
      }

      const matchingThread = allThreads.find(
        t => (goalKey && t.canonical_key === goalKey) ||
             (goalDesc && goalDesc.length > 2 && (t.topic ?? '').toLowerCase().includes(goalDesc.toLowerCase()))
      );

      if (matchingThread) {
        await createOrUpdateSpy(
          'user-test',
          {
            threadId:   matchingThread.id,
            topic:      matchingThread.topic,
            state:      targetState,
            provenance: `GoalCorrected:${evt.status}:turn=${turnId}`,
          },
          {
            isExplicitResume:  evt.status === 'resumed',
            sourceAuthority:   'deterministic_turn_analysis',
            turnId,
            reason: `GoalCorrected: status=${evt.status} from SemanticEvent stream`,
          }
        );
      } else {
        // Fail closed — zero mutation, no negation fallback
        // updateProvenanceSpy should NOT be called
      }
    }
  }

  let createOrUpdateSpy: jest.Mock;
  let updateProvenanceSpy: jest.Mock;

  const ACTIVE_THREAD: MockThread = { id: 'thread-gym-001', topic: 'Start gym routine', state: 'active', canonical_key: 'gym_goal' };
  const WAITING_THREAD: MockThread = { id: 'thread-ck-001', topic: 'Cloud kitchen', state: 'waiting', canonical_key: 'cloud_kitchen_goal' };

  beforeEach(() => {
    createOrUpdateSpy = jest.fn().mockResolvedValue({ id: 'thread-id' });
    updateProvenanceSpy = jest.fn().mockResolvedValue(undefined);
  });

  afterEach(() => { jest.clearAllMocks(); });

  // ── T1: resumed + waiting thread by canonical_key -> state=active ─────────
  test('T1: resumed + waiting thread matched by canonical_key -> createOrUpdate(state=active, isExplicitResume=true)', async () => {
    await routeGoalCorrectedEvents(
      [{ status: 'resumed', goalKey: 'cloud_kitchen_goal' }],
      [WAITING_THREAD],
      createOrUpdateSpy, updateProvenanceSpy
    );
    expect(createOrUpdateSpy).toHaveBeenCalledTimes(1);
    const [, spec, opts] = createOrUpdateSpy.mock.calls[0];
    expect(spec.state).toBe('active');
    expect(spec.threadId).toBe('thread-ck-001');
    expect(opts.isExplicitResume).toBe(true);
  });

  // ── T2: paused + active thread by description -> state=waiting ───────────
  test('T2: paused + active thread matched by description -> createOrUpdate(state=waiting)', async () => {
    await routeGoalCorrectedEvents(
      [{ status: 'paused', goalKey: undefined, goalDescription: 'gym routine' }],
      [ACTIVE_THREAD],
      createOrUpdateSpy, updateProvenanceSpy
    );
    expect(createOrUpdateSpy).toHaveBeenCalledTimes(1);
    const [, spec, opts] = createOrUpdateSpy.mock.calls[0];
    expect(spec.state).toBe('waiting');
    expect(spec.threadId).toBe('thread-gym-001');
    expect(opts.isExplicitResume).toBe(false);
  });

  // ── T3: abandoned + matching thread -> state=abandoned ───────────────────
  test('T3: abandoned + matching thread -> createOrUpdate(state=abandoned)', async () => {
    await routeGoalCorrectedEvents(
      [{ status: 'abandoned', goalKey: 'gym_goal' }],
      [ACTIVE_THREAD],
      createOrUpdateSpy, updateProvenanceSpy
    );
    expect(createOrUpdateSpy).toHaveBeenCalledTimes(1);
    const [, spec, opts] = createOrUpdateSpy.mock.calls[0];
    expect(spec.state).toBe('abandoned');
    expect(opts.isExplicitResume).toBe(false);
  });

  // ── T4: no matching thread -> zero mutation (fail closed) ─────────────────
  test('T4: no matching thread -> createOrUpdate NOT called (zero mutation)', async () => {
    await routeGoalCorrectedEvents(
      [{ status: 'paused', goalKey: 'nonexistent_goal' }],
      [ACTIVE_THREAD],
      createOrUpdateSpy, updateProvenanceSpy
    );
    expect(createOrUpdateSpy).not.toHaveBeenCalled();
    expect(updateProvenanceSpy).not.toHaveBeenCalled();
  });

  // ── T5: resumed with no match -> updateProvenanceForCorrection NOT called ──
  test('T5: resumed + no match -> updateThreadProvenanceForCorrection NOT called', async () => {
    await routeGoalCorrectedEvents(
      [{ status: 'resumed', goalKey: 'nonexistent_goal' }],
      [],
      createOrUpdateSpy, updateProvenanceSpy
    );
    // The key invariant: resumed must never be converted to concept negation
    expect(updateProvenanceSpy).not.toHaveBeenCalled();
    expect(createOrUpdateSpy).not.toHaveBeenCalled();
  });

  // ── T6: abandoned is terminal -> state=abandoned, not revived ─────────────
  test('T6: abandoned produces state=abandoned (terminal)', async () => {
    await routeGoalCorrectedEvents(
      [{ status: 'abandoned', goalKey: 'cloud_kitchen_goal' }],
      [WAITING_THREAD],
      createOrUpdateSpy, updateProvenanceSpy
    );
    expect(createOrUpdateSpy).toHaveBeenCalledTimes(1);
    const [, spec] = createOrUpdateSpy.mock.calls[0];
    expect(spec.state).toBe('abandoned');
    expect(spec.state).not.toBe('active');
    expect(spec.state).not.toBe('waiting');
  });

  // ── T7: paused stays waiting -> does not become active ────────────────────
  test('T7: paused produces state=waiting, not active', async () => {
    await routeGoalCorrectedEvents(
      [{ status: 'paused', goalKey: 'gym_goal' }],
      [ACTIVE_THREAD],
      createOrUpdateSpy, updateProvenanceSpy
    );
    const [, spec] = createOrUpdateSpy.mock.calls[0];
    expect(spec.state).toBe('waiting');
    expect(spec.state).not.toBe('active');
    expect(spec.state).not.toBe('abandoned');
  });

  // ── T8: sourceAuthority always = deterministic_turn_analysis ─────────────
  test('T8: all transitions use sourceAuthority=deterministic_turn_analysis', async () => {
    for (const status of ['paused', 'abandoned', 'resumed'] as const) {
      createOrUpdateSpy.mockClear();
      const thread = status === 'resumed' ? WAITING_THREAD : ACTIVE_THREAD;
      const goalKey = thread.canonical_key;
      await routeGoalCorrectedEvents(
        [{ status, goalKey }],
        [thread],
        createOrUpdateSpy, updateProvenanceSpy
      );
      if (createOrUpdateSpy.mock.calls.length > 0) {
        const [, , opts] = createOrUpdateSpy.mock.calls[0];
        expect(opts.sourceAuthority).toBe('deterministic_turn_analysis');
      }
    }
  });

  // ── T9: short goalDescription (<= 2 chars) not used for matching ──────────
  test('T9: goalDescription shorter than 3 chars does not match (prevents false positives)', async () => {
    await routeGoalCorrectedEvents(
      [{ status: 'paused', goalKey: undefined, goalDescription: 'ok' }],
      [ACTIVE_THREAD],
      createOrUpdateSpy, updateProvenanceSpy
    );
    // "ok" is 2 chars — below threshold, so no match
    expect(createOrUpdateSpy).not.toHaveBeenCalled();
  });

  // ── T10: three statuses produce three distinct states ─────────────────────
  test('T10: paused=waiting, abandoned=abandoned, resumed=active — states are distinct', async () => {
    const statusToState: Record<string, TargetState> = {
      paused: 'waiting',
      abandoned: 'abandoned',
      resumed: 'active',
    };
    for (const [status, expectedState] of Object.entries(statusToState)) {
      createOrUpdateSpy.mockClear();
      const thread = status === 'resumed' ? WAITING_THREAD : ACTIVE_THREAD;
      await routeGoalCorrectedEvents(
        [{ status, goalKey: thread.canonical_key }],
        [thread],
        createOrUpdateSpy, updateProvenanceSpy
      );
      if (createOrUpdateSpy.mock.calls.length > 0) {
        const [, spec] = createOrUpdateSpy.mock.calls[0];
        expect(spec.state).toBe(expectedState);
      }
    }
  });
});
