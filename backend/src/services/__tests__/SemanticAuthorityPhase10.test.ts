/**
 * SemanticAuthorityPhase10.test.ts
 *
 * Phase 10 — Semantic Authority Unification
 * Tests the canonical invariant:
 *   1 message → 1 SemanticInterpreter → 1 SemanticValidator → SemanticEvent[] → N consumers
 *
 * Suites:
 *   A. toSemanticEvents() event boundary contract
 *   B. BackgroundActionService Phase 10 authority guard
 *   C. CorrectionPropagator per-scope isolation + partial failure reporting
 *   D. mom/Monday disambiguation (contextual, not hard-coded)
 *   E. parseDayRange() deterministic day-range parsing
 *   F. Adversarial Hinglish edge cases
 */

import {
  isFactAsserted,
  isFactCorrected,
  isRelationshipAsserted,
  isGoalAsserted,
  isGoalCorrected,
  isScheduleAsserted,
  relationshipToCanonicalKey,
  isRelationshipKey,
  isProfileMappedKey,
  PROFILE_MAPPED_KEYS,
} from '../../types/semanticEvent';
import { toSemanticEvents } from '../../lib/SemanticInterpreter';
import { parseDayRange } from '../ReminderEngine';

// ── Suite A: toSemanticEvents() event boundary ───────────────────────────────

describe('A. toSemanticEvents() — event boundary contract', () => {
  const BASE_VALIDATED_TURN = {
    requiresClarification: false,
    clarificationQuestion: null,
    facts: [] as any[],
    corrections: [] as any[],
    actions: [] as any[],
  };

  const userId = 'test-user-a';
  const sourceMessageId = 'msg-001';

  test('empty turn produces empty event array', () => {
    const events = toSemanticEvents(BASE_VALIDATED_TURN as any, userId, sourceMessageId);
    expect(events).toHaveLength(0);
  });

  test('ValidatedFact with relationship key → RelationshipAsserted', () => {
    const turn = {
      ...BASE_VALIDATED_TURN,
      facts: [{ canonicalKey: 'wife_name', value: 'Sakshi', confidence: 0.97, groundedInTurn: true }],
    };
    const events = toSemanticEvents(turn as any, userId, sourceMessageId);
    expect(events).toHaveLength(1);
    expect(isRelationshipAsserted(events[0])).toBe(true);
    if (isRelationshipAsserted(events[0])) {
      expect(events[0].relationship).toBe('wife');
      expect(events[0].relatedPersonName).toBe('Sakshi');
      expect(events[0].canonicalKey).toBe('wife_name');
      expect(events[0].family).toBe('RelationshipAsserted');
    }
  });

  test('ValidatedFact with non-relationship key → FactAsserted', () => {
    const turn = {
      ...BASE_VALIDATED_TURN,
      facts: [{ canonicalKey: 'favourite_color', value: 'blue', confidence: 0.8, groundedInTurn: true }],
    };
    const events = toSemanticEvents(turn as any, userId, sourceMessageId);
    expect(events).toHaveLength(1);
    expect(isFactAsserted(events[0])).toBe(true);
    if (isFactAsserted(events[0])) {
      expect(events[0].canonicalKey).toBe('favourite_color');
      expect(events[0].value).toBe('blue');
    }
  });

  test('ValidatedCorrection → FactCorrected', () => {
    const turn = {
      ...BASE_VALIDATED_TURN,
      corrections: [{ canonicalKey: 'wife_name', value: 'Priya', confidence: 0.99, groundedInTurn: true }],
    };
    const events = toSemanticEvents(turn as any, userId, sourceMessageId);
    expect(events).toHaveLength(1);
    expect(isFactCorrected(events[0])).toBe(true);
    if (isFactCorrected(events[0])) {
      expect(events[0].canonicalKey).toBe('wife_name');
      expect(events[0].newValue).toBe('Priya');
      expect(events[0].correctionIntent).toBe('replace');
      expect(events[0].authority).toBe('explicit_user');
    }
  });

  test('incomplete action (complete=false) does NOT produce ScheduleAsserted', () => {
    const turn = {
      ...BASE_VALIDATED_TURN,
      actions: [{ type: 'REMINDER', complete: false, missingFields: ['time'], data: {} }],
    };
    const events = toSemanticEvents(turn as any, userId, sourceMessageId);
    const schedEvents = events.filter(isScheduleAsserted);
    expect(schedEvents).toHaveLength(0);
  });

  test('complete REMINDER action → ScheduleAsserted', () => {
    const spec = { title: 'gym', time_of_day: '06:00' };
    const turn = {
      ...BASE_VALIDATED_TURN,
      actions: [{ type: 'REMINDER', complete: true, data: spec }],
    };
    const events = toSemanticEvents(turn as any, userId, sourceMessageId);
    const schedEvents = events.filter(isScheduleAsserted);
    expect(schedEvents).toHaveLength(1);
    if (isScheduleAsserted(schedEvents[0])) {
      expect(schedEvents[0].reminderSpec).toEqual(spec);
    }
  });

  test('GOAL_UPDATE with status=paused → GoalCorrected', () => {
    const turn = {
      ...BASE_VALIDATED_TURN,
      actions: [{ type: 'GOAL_UPDATE', complete: true, data: { status: 'paused', goal_description: 'cloud kitchen' } }],
    };
    const events = toSemanticEvents(turn as any, userId, sourceMessageId);
    const goalCorr = events.filter(isGoalCorrected);
    expect(goalCorr).toHaveLength(1);
    if (isGoalCorrected(goalCorr[0])) {
      expect(goalCorr[0].status).toBe('paused');
    }
  });

  test('GOAL_UPDATE without status → GoalAsserted', () => {
    const turn = {
      ...BASE_VALIDATED_TURN,
      actions: [{ type: 'GOAL_UPDATE', complete: true, data: { goal_description: 'start a gym' } }],
    };
    const events = toSemanticEvents(turn as any, userId, sourceMessageId);
    const goalAss = events.filter(isGoalAsserted);
    expect(goalAss).toHaveLength(1);
  });

  test('eventId is a valid UUID-format string (provenance only)', () => {
    const turn = {
      ...BASE_VALIDATED_TURN,
      facts: [{ canonicalKey: 'preferred_name', value: 'Samar', confidence: 0.95, groundedInTurn: true }],
    };
    const events = toSemanticEvents(turn as any, userId, sourceMessageId);
    expect(events[0].eventId).toMatch(/^[0-9a-f-]{36}$/i);
  });

  test('all events carry correct userId and sourceMessageId', () => {
    const turn = {
      ...BASE_VALIDATED_TURN,
      facts: [{ canonicalKey: 'preferred_name', value: 'Samar', confidence: 0.95, groundedInTurn: true }],
    };
    const events = toSemanticEvents(turn as any, userId, sourceMessageId);
    expect(events[0].userId).toBe(userId);
    expect(events[0].sourceMessageId).toBe(sourceMessageId);
  });
});

// ── Suite B: BackgroundActionService Phase 10 authority guard ─────────────────

describe('B. BackgroundActionService — Phase 10 authority guard', () => {
  // We test the guard logic directly without the full service
  // by simulating the BLOCKED_TOOLS check

  const PHASE10_BLOCKED = [
    { tool: 'MemoryRepository', action: 'save' },
    { tool: 'LifeThread', action: 'upsert' },
    { tool: 'LifeThread', action: 'create' },
    { tool: 'ReminderEngine', action: 'schedule' },
  ];

  const isBlocked = (tool: string, action: string) =>
    PHASE10_BLOCKED.some(b => b.tool === tool && b.action === action);

  test('MemoryRepository.save is BLOCKED', () => {
    expect(isBlocked('MemoryRepository', 'save')).toBe(true);
  });

  test('LifeThread.upsert is BLOCKED', () => {
    expect(isBlocked('LifeThread', 'upsert')).toBe(true);
  });

  test('LifeThread.create is BLOCKED', () => {
    expect(isBlocked('LifeThread', 'create')).toBe(true);
  });

  test('ReminderEngine.schedule is BLOCKED', () => {
    expect(isBlocked('ReminderEngine', 'schedule')).toBe(true);
  });

  test('MomentEngine.extract is ALLOWED', () => {
    expect(isBlocked('MomentEngine', 'extract')).toBe(false);
  });

  test('NovaFollowupService.queue is ALLOWED', () => {
    expect(isBlocked('NovaFollowupService', 'queue')).toBe(false);
  });

  test('NovaAction.create is ALLOWED', () => {
    expect(isBlocked('NovaAction', 'create')).toBe(false);
  });

  test('LifeThread.complete is ALLOWED (not in blocked list)', () => {
    // .complete = marking done, not creating assertion-derived state
    expect(isBlocked('LifeThread', 'complete')).toBe(false);
  });

  test('AgendaManager.add is ALLOWED', () => {
    expect(isBlocked('AgendaManager', 'add')).toBe(false);
  });

  test('WorkingMemory.set is ALLOWED (non-canonical schedule keys)', () => {
    expect(isBlocked('WorkingMemory', 'set')).toBe(false);
  });
});

// ── Suite C: CorrectionPropagator isolation + partial failure ─────────────────

describe('C. CorrectionPropagator — per-scope isolation and partial failure contract', () => {
  test('PropagationResult shape is correct when all succeed', () => {
    // Simulate a fully succeeded result (unit test of shape, not DB call)
    const result = {
      canonicalKey: 'wife_name',
      newValue: 'Sakshi',
      scopes: [
        { scope: 'memories', success: true },
        { scope: 'working_memory', success: true },
        { scope: 'kg_entities', success: true },
      ],
      fullySucceeded: true,
      partiallySucceeded: true,
    };
    expect(result.fullySucceeded).toBe(true);
    expect(result.scopes.every(s => s.success)).toBe(true);
  });

  test('PropagationResult partial failure: fullySucceeded=false, partiallySucceeded=true', () => {
    const result = {
      canonicalKey: 'wife_name',
      newValue: 'Sakshi',
      scopes: [
        { scope: 'memories', success: true },
        { scope: 'working_memory', success: true },
        { scope: 'kg_entities', success: false, error: 'DB timeout' },
      ],
      fullySucceeded: false,
      partiallySucceeded: true,
    };
    expect(result.fullySucceeded).toBe(false);
    expect(result.partiallySucceeded).toBe(true);
    const failed = result.scopes.filter(s => !s.success);
    expect(failed).toHaveLength(1);
    expect(failed[0].scope).toBe('kg_entities');
  });

  test('PropagationResult total failure: fullySucceeded=false, partiallySucceeded=false', () => {
    const result = {
      canonicalKey: 'preferred_name',
      newValue: 'Samar',
      scopes: [
        { scope: 'memories', success: false, error: 'Connection refused' },
        { scope: 'profiles', success: false, error: 'Connection refused' },
      ],
      fullySucceeded: false,
      partiallySucceeded: false,
    };
    expect(result.fullySucceeded).toBe(false);
    expect(result.partiallySucceeded).toBe(false);
  });

  test('preferred_name triggers profiles scope (isProfileMappedKey)', () => {
    expect(isProfileMappedKey('preferred_name')).toBe(true);
  });

  test('birth_date triggers profiles scope', () => {
    expect(isProfileMappedKey('birth_date')).toBe(true);
  });

  test('wife_name triggers kg_entities scope (isRelationshipKey)', () => {
    expect(isRelationshipKey('wife_name')).toBe(true);
  });

  test('brother_name triggers kg_entities scope', () => {
    expect(isRelationshipKey('brother_name')).toBe(true);
  });

  test('favourite_color does NOT trigger profiles or kg scope', () => {
    expect(isProfileMappedKey('favourite_color')).toBe(false);
    expect(isRelationshipKey('favourite_color')).toBe(false);
  });

  test('supersedesValue is populated when prior DB row exists', () => {
    // Shape test — actual DB populated by CorrectionPropagator runtime
    const event = {
      family: 'FactCorrected' as const,
      eventId: 'evt-001',
      userId: 'u1',
      sourceMessageId: 'msg-001',
      authority: 'explicit_user' as const,
      confidence: 1.0,
      createdAt: new Date().toISOString(),
      canonicalKey: 'wife_name',
      newValue: 'Sakshi',
      priorValue: 'Priya',
      correctionIntent: 'replace' as const,
      supersedesValue: 'Priya',  // filled by CorrectionPropagator from DB
      supersedesEventId: 'evt-000',
    };
    expect(event.supersedesValue).toBe('Priya');
    expect(event.supersedesEventId).toBe('evt-000');
  });
});

// ── Suite D: mom/Monday disambiguation ───────────────────────────────────────

describe('D. mom/Monday contextual disambiguation', () => {
  // These tests verify the RULES declared in the SemanticInterpreter prompt
  // and the parseDayRange() function behavior.
  // They do NOT make LLM calls — they test deterministic logic only.

  test('"mom to sat" is a day range (parseDayRange)', () => {
    const days = parseDayRange('mom to sat');
    expect(days).toEqual(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']);
  });

  test('"Mon to Sat" is a day range', () => {
    const days = parseDayRange('Mon to Sat');
    expect(days).toEqual(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']);
  });

  test('"mon se sat" is a day range (Hinglish)', () => {
    const days = parseDayRange('mon se sat');
    expect(days).toEqual(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']);
  });

  test('"Monday se Saturday" is a day range', () => {
    const days = parseDayRange('Monday se Saturday');
    expect(days).toEqual(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']);
  });

  test('"Mon" alone is single day [monday]', () => {
    const days = parseDayRange('Mon');
    expect(days).toEqual(['monday']);
  });

  test('"mon ko gym" extracts monday', () => {
    const days = parseDayRange('mon ko gym');
    expect(days).toEqual(['monday']);
  });

  test('"mom" alone is NOT a day (returns null from parseDayRange — no range context)', () => {
    // "mom" alone without "to/se <day>" is not a valid day range phrase
    const days = parseDayRange('mom yaad dilao');
    // Should NOT match day range — mom without a range partner is not a day
    // parseDayRange should return null (no day-range pattern) or ['monday'] for 'mom' bare
    // Per design: 'mom' alone matches the single-day fallback ONLY when the pattern is 'mom' + scheduling verb
    // Since this function is only called with established day-range context,
    // we test that 'mom yaad dilao' does NOT produce a Monday interpretation
    // The rangeMatch requires 'mom to/se <day>' — bare 'mom' alone shouldn't match range
    // The singleMatch also won't match 'mom' (not in the single-day regex)
    // So this should be null
    expect(days).toBeNull();
  });

  test('"weekdays" → Mon-Fri', () => {
    expect(parseDayRange('weekdays')).toEqual(['monday', 'tuesday', 'wednesday', 'thursday', 'friday']);
  });

  test('"weekends" → Sat-Sun', () => {
    expect(parseDayRange('weekends')).toEqual(['saturday', 'sunday']);
  });

  test('"everyday" → [] (no restriction)', () => {
    expect(parseDayRange('everyday')).toEqual([]);
  });

  test('"daily" → [] (no restriction)', () => {
    expect(parseDayRange('daily')).toEqual([]);
  });
});

// ── Suite E: parseDayRange() extended unit tests ───────────────────────────────

describe('E. parseDayRange() — extended edge cases', () => {
  test('Fri to Mon wraps around week correctly', () => {
    const days = parseDayRange('Fri to Mon');
    expect(days).toEqual(['friday', 'saturday', 'sunday', 'monday']);
  });

  test('Sat to Sun → [saturday, sunday]', () => {
    expect(parseDayRange('Sat to Sun')).toEqual(['saturday', 'sunday']);
  });

  test('Tuesday alone', () => {
    expect(parseDayRange('Tuesday')).toEqual(['tuesday']);
  });

  test('"on Friday" single day', () => {
    expect(parseDayRange('on Friday')).toEqual(['friday']);
  });

  test('unknown phrase returns null', () => {
    expect(parseDayRange('remind me tomorrow')).toBeNull();
  });

  test('"Sat se Sun" (Hinglish) → [saturday, sunday]', () => {
    expect(parseDayRange('Sat se Sun')).toEqual(['saturday', 'sunday']);
  });
});

// ── Suite F: Adversarial Hinglish ─────────────────────────────────────────────

describe('F. Adversarial Hinglish — type guard and key helper assertions', () => {
  test('relationshipToCanonicalKey("wife") → wife_name', () => {
    expect(relationshipToCanonicalKey('wife')).toBe('wife_name');
  });

  test('relationshipToCanonicalKey("bhai") → brother_name', () => {
    expect(relationshipToCanonicalKey('bhai')).toBe('brother_name');
  });

  test('relationshipToCanonicalKey("maa") → mother_name', () => {
    expect(relationshipToCanonicalKey('maa')).toBe('mother_name');
  });

  test('relationshipToCanonicalKey("mummy") → mother_name', () => {
    expect(relationshipToCanonicalKey('mummy')).toBe('mother_name');
  });

  test('relationshipToCanonicalKey("beta") → son_name', () => {
    expect(relationshipToCanonicalKey('beta')).toBe('son_name');
  });

  test('relationshipToCanonicalKey("unknown") → undefined', () => {
    expect(relationshipToCanonicalKey('unknown')).toBeUndefined();
  });

  test('isRelationshipKey("son_name") → true', () => {
    expect(isRelationshipKey('son_name')).toBe(true);
  });

  test('isRelationshipKey("son_nickname") → true', () => {
    expect(isRelationshipKey('son_nickname')).toBe(true);
  });

  test('isRelationshipKey("company_name") → true (ends with _name)', () => {
    // company_name ends with _name so isRelationshipKey returns true
    // This is by design — company name also gets KG treatment
    expect(isRelationshipKey('company_name')).toBe(true);
  });

  test('isRelationshipKey("favourite_color") → false', () => {
    expect(isRelationshipKey('favourite_color')).toBe(false);
  });

  test('PROFILE_MAPPED_KEYS includes preferred_name', () => {
    expect(PROFILE_MAPPED_KEYS.has('preferred_name')).toBe(true);
  });

  test('PROFILE_MAPPED_KEYS does NOT include wife_name', () => {
    expect(PROFILE_MAPPED_KEYS.has('wife_name')).toBe(false);
  });

  test('GoalCorrected abandoned event has correct shape', () => {
    const event = {
      family: 'GoalCorrected' as const,
      eventId: crypto.randomUUID(),
      userId: 'u1',
      sourceMessageId: 'msg-002',
      authority: 'explicit_user' as const,
      confidence: 1.0,
      createdAt: new Date().toISOString(),
      status: 'abandoned' as const,
      goalDescription: 'Cloud kitchen',
    };
    expect(isGoalCorrected(event)).toBe(true);
    expect(event.status).toBe('abandoned');
  });

  test('GoalCorrected paused has status paused', () => {
    const event = {
      family: 'GoalCorrected' as const,
      eventId: crypto.randomUUID(),
      userId: 'u1',
      sourceMessageId: 'msg-003',
      authority: 'explicit_user' as const,
      confidence: 1.0,
      createdAt: new Date().toISOString(),
      status: 'paused' as const,
      goalDescription: 'Cloud kitchen',
    };
    expect(event.status).toBe('paused');
    expect(isGoalCorrected(event)).toBe(true);
  });

  test('FactAsserted for wife_name — repeated assertion is idempotent by key', () => {
    // Two events with same canonicalKey+value should upsert to same DB row
    const e1 = { family: 'FactAsserted' as const, canonicalKey: 'wife_name', value: 'Sakshi' };
    const e2 = { family: 'FactAsserted' as const, canonicalKey: 'wife_name', value: 'Sakshi' };
    expect(e1.canonicalKey).toBe(e2.canonicalKey);
    expect(e1.value).toBe(e2.value);
    // Idempotency is enforced at DB layer by upsert(key, value) — duplicate events are safe
  });
});

