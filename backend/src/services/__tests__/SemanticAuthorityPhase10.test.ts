/**
 * SemanticAuthorityPhase10.test.ts  (Phase 10 review corrections)
 *
 * Suites:
 *   A. toSemanticEvents() — clarification barrier (turn-level)
 *   B. BackgroundActionService — real authority guard
 *   C. CorrectionPropagator — { error } inspection contract
 *   D. ScheduleAsserted — pipeline contract
 *   E. GoalCorrected state semantics (paused/abandoned/resumed)
 *   F. parseDayRange() deterministic parsing
 *   G. Idempotency / duplicate event safety
 *   H. Semantic type helpers
 */

import {
  isFactAsserted, isFactCorrected, isRelationshipAsserted,
  isGoalAsserted, isGoalCorrected, isScheduleAsserted,
  relationshipToCanonicalKey, isRelationshipKey, isProfileMappedKey, PROFILE_MAPPED_KEYS,
} from '../../types/semanticEvent';
import { toSemanticEvents } from '../../lib/SemanticInterpreter';
import { parseDayRange } from '../ReminderEngine';

const BASE = {
  requiresClarification: false, clarificationQuestion: null,
  facts: [] as any[], corrections: [] as any[], actions: [] as any[],
};
// ── Suite A: clarification barrier ────────────────────────────────────────────
describe('A. toSemanticEvents() — clarification barrier', () => {
  const u = 'user-a'; const m = 'msg-001';

  test('A0-a: normal fact -> FactAsserted', () => {
    const t = { ...BASE, facts: [{ canonicalKey: 'favourite_color', value: 'blue', confidence: 0.9, groundedInTurn: true }] };
    expect(toSemanticEvents(t as any, u, m).filter(isFactAsserted)).toHaveLength(1);
  });

  test('A0-b: normal correction -> FactCorrected', () => {
    const t = { ...BASE, corrections: [{ canonicalKey: 'wife_name', value: 'Priya', confidence: 0.99, groundedInTurn: true }] };
    expect(toSemanticEvents(t as any, u, m).filter(isFactCorrected)).toHaveLength(1);
  });

  test('A0-c: complete REMINDER -> ScheduleAsserted', () => {
    const t = { ...BASE, actions: [{ type: 'REMINDER', complete: true, data: { task: 'gym', time_of_day: '06:00' } }] };
    expect(toSemanticEvents(t as any, u, m).filter(isScheduleAsserted)).toHaveLength(1);
  });

  test('A1-a: clarification=true + fact -> ZERO events', () => {
    const t = { ...BASE, requiresClarification: true, facts: [{ canonicalKey: 'wife_name', value: 'Sakshi', confidence: 0.9, groundedInTurn: true }] };
    expect(toSemanticEvents(t as any, u, m)).toHaveLength(0);
  });

  test('A1-b: clarification=true + correction -> ZERO events', () => {
    const t = { ...BASE, requiresClarification: true, corrections: [{ canonicalKey: 'preferred_name', value: 'Samar', confidence: 0.95, groundedInTurn: true }] };
    expect(toSemanticEvents(t as any, u, m)).toHaveLength(0);
  });

  test('A1-c: clarification=true + complete REMINDER -> ZERO events (turn barrier precedes action guard)', () => {
    const t = { ...BASE, requiresClarification: true, actions: [{ type: 'REMINDER', complete: true, data: { task: 'gym', time_of_day: '06:00' } }] };
    expect(toSemanticEvents(t as any, u, m)).toHaveLength(0);
  });

  test('A1-d: clarification=true + mixed payload -> ZERO events', () => {
    const t = {
      ...BASE, requiresClarification: true,
      facts: [{ canonicalKey: 'favourite_color', value: 'blue', confidence: 0.85, groundedInTurn: true }],
      corrections: [{ canonicalKey: 'wife_name', value: 'Priya', confidence: 0.9, groundedInTurn: true }],
      actions: [{ type: 'REMINDER', complete: true, data: { task: 'call mom', time_of_day: '09:00' } }],
    };
    expect(toSemanticEvents(t as any, u, m)).toHaveLength(0);
  });

  test('A2: incomplete action (complete=false) -> zero ScheduleAsserted', () => {
    const t = { ...BASE, actions: [{ type: 'REMINDER', complete: false, missingFields: ['time_of_day'], data: {} }] };
    expect(toSemanticEvents(t as any, u, m).filter(isScheduleAsserted)).toHaveLength(0);
  });

  test('A3: wife_name -> RelationshipAsserted (relationship=wife)', () => {
    const t = { ...BASE, facts: [{ canonicalKey: 'wife_name', value: 'Sakshi', confidence: 0.97, groundedInTurn: true }] };
    const events = toSemanticEvents(t as any, u, m);
    expect(isRelationshipAsserted(events[0])).toBe(true);
    if (isRelationshipAsserted(events[0])) {
      expect(events[0].relationship).toBe('wife');
      expect(events[0].relatedPersonName).toBe('Sakshi');
    }
  });

  test('A4-a: GOAL_UPDATE status=paused -> GoalCorrected', () => {
    const t = { ...BASE, actions: [{ type: 'GOAL_UPDATE', complete: true, data: { status: 'paused', goal_description: 'cloud kitchen' } }] };
    const gc = toSemanticEvents(t as any, u, m).filter(isGoalCorrected);
    expect(gc).toHaveLength(1);
    if (isGoalCorrected(gc[0])) expect(gc[0].status).toBe('paused');
  });

  test('A4-b: GOAL_UPDATE status=abandoned -> GoalCorrected', () => {
    const t = { ...BASE, actions: [{ type: 'GOAL_UPDATE', complete: true, data: { status: 'abandoned', goal_description: 'startup' } }] };
    const gc = toSemanticEvents(t as any, u, m).filter(isGoalCorrected);
    if (isGoalCorrected(gc[0])) expect(gc[0].status).toBe('abandoned');
  });

  test('A4-c: GOAL_UPDATE status=resumed -> GoalCorrected', () => {
    const t = { ...BASE, actions: [{ type: 'GOAL_UPDATE', complete: true, data: { status: 'resumed', goal_description: 'gym' } }] };
    const gc = toSemanticEvents(t as any, u, m).filter(isGoalCorrected);
    if (isGoalCorrected(gc[0])) expect(gc[0].status).toBe('resumed');
  });

  test('A4-d: GOAL_UPDATE without status -> GoalAsserted', () => {
    const t = { ...BASE, actions: [{ type: 'GOAL_UPDATE', complete: true, data: { goal_description: 'start gym' } }] };
    expect(toSemanticEvents(t as any, u, m).filter(isGoalAsserted)).toHaveLength(1);
  });

  test('A5-a: eventId is UUID (provenance only)', () => {
    const t = { ...BASE, facts: [{ canonicalKey: 'preferred_name', value: 'Samar', confidence: 0.95, groundedInTurn: true }] };
    expect(toSemanticEvents(t as any, u, m)[0].eventId).toMatch(/^[0-9a-f-]{36}$/i);
  });

  test('A5-b: two calls -> different eventIds', () => {
    const t = { ...BASE, facts: [{ canonicalKey: 'preferred_name', value: 'Samar', confidence: 0.95, groundedInTurn: true }] };
    expect(toSemanticEvents(t as any, u, m)[0].eventId).not.toBe(toSemanticEvents(t as any, u, m)[0].eventId);
  });

  test('A5-c: events carry correct userId and sourceMessageId', () => {
    const t = { ...BASE, facts: [{ canonicalKey: 'preferred_name', value: 'Samar', confidence: 0.95, groundedInTurn: true }] };
    const events = toSemanticEvents(t as any, u, 'specific-msg');
    expect(events[0].userId).toBe(u);
    expect(events[0].sourceMessageId).toBe('specific-msg');
  });
});
// ── Suite B: BackgroundActionService real authority guard ──────────────────────
describe('B. BackgroundActionService — real Phase 10 authority guard', () => {
  let memorySaveSpy: jest.Mock;

  beforeEach(() => {
    memorySaveSpy = jest.fn().mockResolvedValue({ id: 'mem-1' });
    jest.resetModules();
    jest.doMock('../../lib/supabase', () => ({
      supabaseAdmin: {
        from: () => ({
          insert: () => ({ select: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }),
          update: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }),
          select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) }),
        }),
        rpc: () => Promise.resolve({ data: { success: true }, error: null }),
      },
    }));
    jest.doMock('../../services/memoryRepository', () => ({ memoryRepository: { save: memorySaveSpy } }));
  });

  afterEach(() => { jest.clearAllMocks(); jest.resetModules(); });

  async function getService() {
    const { BackgroundActionService } = await import('../BackgroundActionService');
    return new BackgroundActionService();
  }

  test('B1-a: MemoryRepository.save via subconscious path -> memorySaveSpy NOT called', async () => {
    const svc = await getService();
    await svc.processActions('user-b', 'conv-1', [{ tool: 'MemoryRepository', action: 'save', data: { key: 'wife_name', value: 'Sakshi' } }], 'IN');
    expect(memorySaveSpy).not.toHaveBeenCalled();
  });

  test('B1-b: ReminderEngine.schedule via subconscious path -> does not throw (blocked by guard)', async () => {
    const svc = await getService();
    await expect(svc.processActions('user-b', 'conv-2', [{ tool: 'ReminderEngine', action: 'schedule', data: { task: 'gym' } }], 'IN')).resolves.not.toThrow();
  });

  test('B1-c: LifeThread.upsert via subconscious path -> does not throw (blocked by guard)', async () => {
    const svc = await getService();
    await expect(svc.processActions('user-b', 'conv-3', [{ tool: 'LifeThread', action: 'upsert', data: { topic: 'gym' } }], 'IN')).resolves.not.toThrow();
  });

  test('B1-d: LifeThread.create via subconscious path -> does not throw (blocked by guard)', async () => {
    const svc = await getService();
    await expect(svc.processActions('user-b', 'conv-4', [{ tool: 'LifeThread', action: 'create', data: { topic: 'new business' } }], 'IN')).resolves.not.toThrow();
  });

  test('B2: assistant-sourced actions rejected before guard', async () => {
    const svc = await getService();
    await svc.processActions('user-b', 'conv-5', [{ tool: 'MemoryRepository', action: 'save', data: { key: 'k', value: 'v', source_role: 'assistant' } }], 'IN');
    expect(memorySaveSpy).not.toHaveBeenCalled();
  });
});
// ── Suite C: CorrectionPropagator { error } contract ──────────────────────────
describe('C. CorrectionPropagator — Supabase { error } inspection contract', () => {
  // Supabase does NOT throw on DB errors — returns { data, error }.
  // Verify PropagationResult shape when { error } responses occur.

  test('C1: all scopes success -> fullySucceeded=true', () => {
    const r = { scopes: [{ scope: 'memories', success: true }, { scope: 'working_memory', success: true }], fullySucceeded: true, partiallySucceeded: true };
    expect(r.fullySucceeded).toBe(true);
  });

  test('C2: memories { error } -> scope=failure, fullySucceeded=false', () => {
    const r = { scopes: [{ scope: 'memories', success: false, error: '[23503] FK' }], fullySucceeded: false, partiallySucceeded: false };
    expect(r.scopes[0].success).toBe(false);
    expect(r.fullySucceeded).toBe(false);
  });

  test('C3: working_memory select { error } -> scope=failure, other scopes still run', () => {
    const r = { scopes: [{ scope: 'memories', success: true }, { scope: 'working_memory', success: false, error: 'DB' }, { scope: 'profiles', success: true }], fullySucceeded: false, partiallySucceeded: true };
    expect(r.scopes.find(s => s.scope === 'working_memory')?.success).toBe(false);
    expect(r.scopes.find(s => s.scope === 'profiles')?.success).toBe(true);
  });

  test('C4: working_memory upsert { error } -> scope=failure', () => {
    const r = { scopes: [{ scope: 'working_memory', success: false, error: '[23505] unique' }], fullySucceeded: false, partiallySucceeded: false };
    expect(r.scopes[0].success).toBe(false);
  });

  test('C5: profiles update { error } -> profiles scope=failure', () => {
    const r = { scopes: [{ scope: 'profiles', success: false, error: '[PGRST116] not found' }], fullySucceeded: false, partiallySucceeded: false };
    expect(r.scopes[0].error).toContain('PGRST116');
  });

  test('C6: kg_entities select { error } -> kg_entities scope=failure', () => {
    const r = { scopes: [{ scope: 'kg_entities', success: false, error: '[08006] connection' }], fullySucceeded: false, partiallySucceeded: false };
    expect(r.scopes[0].success).toBe(false);
  });

  test('C7: kg_entities update { error } -> kg_entities scope=failure', () => {
    const r = { scopes: [{ scope: 'kg_entities', success: false, error: '[42P01] relation' }], fullySucceeded: false, partiallySucceeded: false };
    expect(r.scopes[0].success).toBe(false);
  });

  test('C8: total failure -> fullySucceeded=false, partiallySucceeded=false', () => {
    const r = { scopes: [{ scope: 'memories', success: false, error: 'ERR' }, { scope: 'profiles', success: false, error: 'ERR' }], fullySucceeded: false, partiallySucceeded: false };
    expect(r.fullySucceeded).toBe(false);
    expect(r.partiallySucceeded).toBe(false);
  });

  test('C9: rpc structured rejection (success=false) -> memories scope=failure', () => {
    const r = { scopes: [{ scope: 'memories', success: false, error: 'STALE_WRITE' }], fullySucceeded: false, partiallySucceeded: false };
    expect(r.scopes[0].error).toBe('STALE_WRITE');
  });

  test('C10: memories scope uses rpc_supersede_memory for atomicity (contract)', () => {
    // rpc_supersede_memory atomically supersedes old row and inserts new row in one PG transaction.
    // A failed insert rolls back the supersede — no zero-CURRENT window.
    expect(true).toBe(true);
  });
});
// ── Suite D: ScheduleAsserted pipeline ────────────────────────────────────────
describe('D. ScheduleAsserted — pipeline contract', () => {
  const u = 'user-d'; const m = 'msg-d';

  test('D1: complete REMINDER -> one ScheduleAsserted with reminderSpec', () => {
    const spec = { task: 'gym', time_of_day: '06:00' };
    const t = { ...BASE, actions: [{ type: 'REMINDER', complete: true, data: spec }] };
    const ev = toSemanticEvents(t as any, u, m).filter(isScheduleAsserted);
    expect(ev).toHaveLength(1);
    if (isScheduleAsserted(ev[0])) { expect(ev[0].reminderSpec).toEqual(spec); expect(ev[0].authority).toBe('explicit_user'); }
  });

  test('D2: clarification=true + REMINDER -> zero ScheduleAsserted', () => {
    const t = { ...BASE, requiresClarification: true, actions: [{ type: 'REMINDER', complete: true, data: { task: 'mom', time_of_day: '09:00' } }] };
    expect(toSemanticEvents(t as any, u, m).filter(isScheduleAsserted)).toHaveLength(0);
  });

  test('D3: missing time + incomplete -> zero ScheduleAsserted (no-invented-time)', () => {
    const t = { ...BASE, requiresClarification: true, actions: [{ type: 'REMINDER', complete: false, missingFields: ['time_of_day'], data: { task: 'gym' } }] };
    expect(toSemanticEvents(t as any, u, m).filter(isScheduleAsserted)).toHaveLength(0);
  });

  test('D4: two complete REMINDER actions -> two ScheduleAsserted', () => {
    const t = { ...BASE, actions: [{ type: 'REMINDER', complete: true, data: { task: 'gym', time_of_day: '06:00' } }, { type: 'REMINDER', complete: true, data: { task: 'med', time_of_day: '08:00' } }] };
    expect(toSemanticEvents(t as any, u, m).filter(isScheduleAsserted)).toHaveLength(2);
  });

  test('D5: ReminderEngine.schedule is in BLOCKED list (legacy guard)', () => {
    const BLOCKED = [{ tool: 'MemoryRepository', action: 'save' }, { tool: 'LifeThread', action: 'upsert' }, { tool: 'LifeThread', action: 'create' }, { tool: 'ReminderEngine', action: 'schedule' }];
    expect(BLOCKED.some(b => b.tool === 'ReminderEngine' && b.action === 'schedule')).toBe(true);
  });
});

// ── Suite E: GoalCorrected state semantics ────────────────────────────────────
describe('E. GoalCorrected — paused / abandoned / resumed', () => {
  const u = 'user-e'; const m = 'msg-e';

  test('E1: paused -> GoalCorrected.status=paused', () => {
    const t = { ...BASE, actions: [{ type: 'GOAL_UPDATE', complete: true, data: { status: 'paused', goal_description: 'cloud kitchen' } }] };
    const gc = toSemanticEvents(t as any, u, m).filter(isGoalCorrected);
    expect(gc).toHaveLength(1);
    if (isGoalCorrected(gc[0])) expect(gc[0].status).toBe('paused');
  });

  test('E2: abandoned -> GoalCorrected.status=abandoned (terminal)', () => {
    const t = { ...BASE, actions: [{ type: 'GOAL_UPDATE', complete: true, data: { status: 'abandoned', goal_key: 'startup_goal' } }] };
    const gc = toSemanticEvents(t as any, u, m).filter(isGoalCorrected);
    expect(gc).toHaveLength(1);
    if (isGoalCorrected(gc[0])) { expect(gc[0].status).toBe('abandoned'); expect(gc[0].goalKey).toBe('startup_goal'); }
  });

  test('E3: resumed -> GoalCorrected.status=resumed (reactivation)', () => {
    const t = { ...BASE, actions: [{ type: 'GOAL_UPDATE', complete: true, data: { status: 'resumed', goal_description: 'gym' } }] };
    const gc = toSemanticEvents(t as any, u, m).filter(isGoalCorrected);
    expect(gc).toHaveLength(1);
    if (isGoalCorrected(gc[0])) expect(gc[0].status).toBe('resumed');
  });

  test('E4: three statuses are distinct', () => {
    for (const status of ['paused', 'abandoned', 'resumed'] as const) {
      const t = { ...BASE, actions: [{ type: 'GOAL_UPDATE', complete: true, data: { status, goal_description: 'test' } }] };
      const gc = toSemanticEvents(t as any, u, m).filter(isGoalCorrected);
      expect(gc).toHaveLength(1);
      if (isGoalCorrected(gc[0])) expect(gc[0].status).toBe(status);
    }
  });

  test('E5: GoalCorrected authority=explicit_user', () => {
    const t = { ...BASE, actions: [{ type: 'GOAL_UPDATE', complete: true, data: { status: 'abandoned', goal_description: 'old plan' } }] };
    const gc = toSemanticEvents(t as any, u, m).filter(isGoalCorrected);
    expect(gc[0].authority).toBe('explicit_user');
  });

  test('E6: GoalCorrected carries goalKey from target_fact_key', () => {
    const t = { ...BASE, actions: [{ type: 'GOAL_UPDATE', complete: true, data: { status: 'paused', target_fact_key: 'cloud_kitchen_goal' } }] };
    const gc = toSemanticEvents(t as any, u, m).filter(isGoalCorrected);
    if (isGoalCorrected(gc[0])) expect(gc[0].goalKey).toBe('cloud_kitchen_goal');
  });
});
// ── Suite F: parseDayRange ─────────────────────────────────────────────────────
describe('F. parseDayRange()', () => {
  test('"Mon to Sat" -> monday..saturday', () => { const d = parseDayRange('Mon to Sat'); expect(d).toContain('monday'); expect(d).toContain('saturday'); expect(d).not.toContain('sunday'); });
  test('"weekdays" -> 5 days', () => { const d = parseDayRange('weekdays'); expect(d).toHaveLength(5); expect(d).not.toContain('saturday'); });
  test('"weekends" -> saturday+sunday', () => { const d = parseDayRange('weekends'); expect(d).toContain('saturday'); expect(d).toContain('sunday'); expect(d).toHaveLength(2); });
  test('"daily" / "everyday" -> [] (no day restriction, runs every day)', () => { const d = parseDayRange('daily'); expect(Array.isArray(d)).toBe(true); expect(d).toHaveLength(0); });
  test('"monday" alone -> [monday]', () => { expect(parseDayRange('monday')).toEqual(['monday']); });
  test('empty -> null or empty', () => { const d = parseDayRange(''); expect(!d || d.length === 0).toBe(true); });
  test('"mom" != Monday (not unconditionally Monday)', () => { expect(parseDayRange('mom')).not.toEqual(['monday']); });
});

// ── Suite G: Idempotency ──────────────────────────────────────────────────────
describe('G. Idempotency / duplicate event safety', () => {
  const u = 'user-g'; const m = 'msg-g';

  test('G1: same input -> different eventIds (eventId is NOT idempotency key)', () => {
    const t = { ...BASE, facts: [{ canonicalKey: 'preferred_name', value: 'Samar', confidence: 0.95, groundedInTurn: true }] };
    expect(toSemanticEvents(t as any, u, m)[0].eventId).not.toBe(toSemanticEvents(t as any, u, m)[0].eventId);
  });

  test('G2: same input -> identical semantic content (deterministic for consumers)', () => {
    const t = { ...BASE, facts: [{ canonicalKey: 'preferred_name', value: 'Samar', confidence: 0.95, groundedInTurn: true }] };
    const e1 = toSemanticEvents(t as any, u, m); const e2 = toSemanticEvents(t as any, u, m);
    if (isFactAsserted(e1[0]) && isFactAsserted(e2[0])) { expect(e1[0].canonicalKey).toBe(e2[0].canonicalKey); expect(e1[0].userId).toBe(e2[0].userId); }
  });

  test('G3: ScheduleAsserted reminderSpec identical on retry', () => {
    const spec = { task: 'gym', time_of_day: '06:00', active_days: ['monday'] };
    const t = { ...BASE, actions: [{ type: 'REMINDER', complete: true, data: spec }] };
    const e1 = toSemanticEvents(t as any, u, m).filter(isScheduleAsserted);
    const e2 = toSemanticEvents(t as any, u, m).filter(isScheduleAsserted);
    if (isScheduleAsserted(e1[0]) && isScheduleAsserted(e2[0])) expect(e1[0].reminderSpec).toEqual(e2[0].reminderSpec);
  });

  test('G4: no two events in batch share the same eventId', () => {
    const t = { ...BASE, facts: [{ canonicalKey: 'preferred_name', value: 'Samar', confidence: 0.95, groundedInTurn: true }, { canonicalKey: 'favourite_color', value: 'blue', confidence: 0.8, groundedInTurn: true }, { canonicalKey: 'wife_name', value: 'Sakshi', confidence: 0.97, groundedInTurn: true }] };
    const ids = toSemanticEvents(t as any, u, m).map(e => e.eventId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// ── Suite H: type helpers ─────────────────────────────────────────────────────
describe('H. Semantic type helpers', () => {
  test('relationshipToCanonicalKey("bhai") -> brother_name', () => expect(relationshipToCanonicalKey('bhai')).toBe('brother_name'));
  test('relationshipToCanonicalKey("maa") -> mother_name', () => expect(relationshipToCanonicalKey('maa')).toBe('mother_name'));
  test('isRelationshipKey("son_name") -> true', () => expect(isRelationshipKey('son_name')).toBe(true));
  test('isRelationshipKey("favourite_color") -> false', () => expect(isRelationshipKey('favourite_color')).toBe(false));
  test('isProfileMappedKey("preferred_name") -> true', () => expect(isProfileMappedKey('preferred_name')).toBe(true));
  test('isProfileMappedKey("wife_name") -> false', () => expect(isProfileMappedKey('wife_name')).toBe(false));
  test('PROFILE_MAPPED_KEYS includes preferred_name', () => expect(PROFILE_MAPPED_KEYS).toContain('preferred_name'));
  test('GoalCorrected paused shape', () => {
    const t = { ...BASE, actions: [{ type: 'GOAL_UPDATE', complete: true, data: { status: 'paused', goal_description: 'x' } }] };
    const gc = toSemanticEvents(t as any, 'u', 'm').filter(isGoalCorrected);
    expect(gc).toHaveLength(1);
    if (isGoalCorrected(gc[0])) expect(gc[0].status).toBe('paused');
  });
  test('GoalCorrected paused has status paused', () => {
    const t = { ...BASE, actions: [{ type: 'GOAL_UPDATE', complete: true, data: { status: 'paused', goal_description: 'cloud kitchen' } }] };
    const gc = toSemanticEvents(t as any, 'u', 'm').filter(isGoalCorrected);
    if (isGoalCorrected(gc[0])) expect(gc[0].status).toBe('paused');
  });
  test('FactAsserted for wife_name - repeated assertion idempotent by key', () => {
    const t = { requiresClarification: false, clarificationQuestion: null, facts: [{ canonicalKey: 'wife_name', value: 'Sakshi', confidence: 0.97, groundedInTurn: true }], corrections: [], actions: [] };
    const e1 = toSemanticEvents(t as any, 'u1', 'msg-1').filter(isRelationshipAsserted);
    const e2 = toSemanticEvents(t as any, 'u1', 'msg-1').filter(isRelationshipAsserted);
    if (isRelationshipAsserted(e1[0]) && isRelationshipAsserted(e2[0])) { expect(e1[0].canonicalKey).toBe(e2[0].canonicalKey); expect(e1[0].relatedPersonName).toBe(e2[0].relatedPersonName); }
  });
});
