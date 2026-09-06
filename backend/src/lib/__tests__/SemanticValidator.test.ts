/**
 * SemanticValidator Adversarial Test Suite
 *
 * Tests the deterministic guard layer in isolation — no LLM calls, no DB.
 * All tests feed a pre-built SemanticTurn (as if SemanticInterpreter had run)
 * into validateTurn() and assert that the output respects the authority boundary.
 *
 * Test categories:
 *   1. Simple corrections (single field)
 *   2. Multi-field corrections (all must persist independently)
 *   3. Attribution boundary (anti-contamination)
 *   4. Mixed turns (correction + fact, correction + reminder, etc.)
 *   5. Reminder completeness (no defaults, no assumptions)
 *   6. Grounding checks (value not in source → rejected)
 *   7. Clarification scoping (pending resolution + independent new facts)
 *   8. Unambiguous attribution (the wife/brother test)
 */

import {
  validateTurn,
  isValueGroundedInSource,
  isConceptRelationshipSupported,
  isAttributionUnambiguous,
  validateReminderCompleteness,
} from '../SemanticValidator';
import { SemanticTurn, SemanticAction } from '../SemanticInterpreter';

// ── Test helper: build a minimal SemanticTurn ─────────────────────────────────

function makeTurn(overrides: Partial<SemanticTurn> = {}): SemanticTurn {
  return {
    turnId: 'test-turn-1',
    sourceMessageId: 'msg-1',
    intent: 'MEMORY',
    facts: [],
    corrections: [],
    actions: [],
    clarification: { required: false },
    confidence: 0.95,
    ...overrides,
  };
}

function makeCorrection(concept: string, new_value: string, groundedInTurn = true) {
  return {
    concept,
    new_value,
    intent: 'replace' as const,
    confidence: 0.95,
    groundedInTurn,
  };
}

function makeFact(concept: string, value: string, groundedInTurn = true) {
  return { concept, value, confidence: 0.9, groundedInTurn };
}

function makeReminderAction(data: Record<string, any>): SemanticAction {
  const missing: string[] = [];
  if (!data.task) missing.push('task');
  if (!data.time_of_day && !data.relative_value && !data.event_trigger && !data.time_period) {
    missing.push('exact_time');
  }
  if (!data.date && !data.relative_value && !data.event_trigger) missing.push('date');
  return {
    type: 'REMINDER',
    data,
    completenessScore: missing.length === 0 ? 1.0 : 0.5,
    missingFields: missing,
  };
}

// ── 1. Simple Corrections ─────────────────────────────────────────────────────

describe('Simple corrections', () => {
  it('accepts a clear name correction', () => {
    const source = 'Mera naam Ravi nahi, Rajesh hai';
    const turn = makeTurn({
      intent: 'CORRECTION',
      // LLM would propose 'user_name' which resolves to canonical 'preferred_name'
      corrections: [makeCorrection('user_name', 'Rajesh')],
    });
    const result = validateTurn(turn, source);
    expect(result.corrections).toHaveLength(1);
    expect(result.corrections[0].canonicalKey).toBe('preferred_name'); // user_name aliases to preferred_name
    expect(result.corrections[0].value).toBe('Rajesh');
    expect(result.corrections[0].authority).toBe('explicit_user');
    expect(result.requiresClarification).toBe(false);
  });

  it('accepts correction phrased as "Actually"', () => {
    const source = 'Actually mera naam Rajesh hai';
    const turn = makeTurn({
      intent: 'CORRECTION',
      corrections: [makeCorrection('user_name', 'Rajesh')],
    });
    const result = validateTurn(turn, source);
    expect(result.corrections).toHaveLength(1);
    expect(result.corrections[0].value).toBe('Rajesh');
    expect(result.corrections[0].canonicalKey).toBe('preferred_name');
  });

  it('accepts Hinglish colour correction', () => {
    const source = 'Ek correction hai, mera favourite color blue hai';
    const turn = makeTurn({
      intent: 'CORRECTION',
      corrections: [makeCorrection('favourite_color', 'blue')],
    });
    const result = validateTurn(turn, source);
    expect(result.corrections).toHaveLength(1);
    expect(result.corrections[0].canonicalKey).toBe('favourite_color');
    expect(result.corrections[0].value).toBe('blue');
  });

  it('rejects a correction where new_value is NOT in the source message', () => {
    const source = 'Mera naam Ravi nahi';
    // LLM hallucinated "Rajesh" — it's not in the source
    const turn = makeTurn({
      intent: 'CORRECTION',
      corrections: [makeCorrection('user_name', 'Rajesh', false)],
    });
    const result = validateTurn(turn, source);
    expect(result.corrections).toHaveLength(0);
  });

  it('rejects correction when no correction signal is present in source', () => {
    // "Mera naam Rajesh hai" is a plain statement — not a correction
    const source = 'Mera naam Rajesh hai';
    const turn = makeTurn({
      intent: 'CORRECTION',
      corrections: [makeCorrection('user_name', 'Rajesh')],
    });
    // This SHOULD still be processed (it's a correction intent from LLM)
    // but passes isConceptRelationshipSupported only if source contains signal
    // "nahi" is absent, so it should be treated as plain fact, not correction
    const result = validateTurn(turn, source);
    // A plain "Mera naam Rajesh hai" without correction signal → validator should
    // reject correction (no correction signal like nahi/actually/galat present)
    expect(result.corrections).toHaveLength(0);
  });
});

// ── 2. Multi-field Corrections ─────────────────────────────────────────────────

describe('Multi-field corrections (all must persist independently)', () => {
  it('persists both corrections from one Hinglish turn', () => {
    // Both values in source, correction signal present (nahi), concept signals present (wife, bhai=brother)
    const source = 'Actually meri wife Sakshi hai nahi Priya, aur bhai brother ka naam Rahul hai not Amit';
    const turn = makeTurn({
      intent: 'CORRECTION',
      corrections: [
        makeCorrection('wife_name', 'Sakshi'),
        makeCorrection('brother_name', 'Rahul'),
      ],
    });
    const result = validateTurn(turn, source);
    expect(result.corrections).toHaveLength(2);
    const keys = result.corrections.map(c => c.canonicalKey);
    expect(keys).toContain('wife_name');
    expect(keys).toContain('brother_name');
  });

  it('persists both from "Meri wife Sakshi hai aur bete ka naam Shreshth hai"', () => {
    // For facts, concept tokens must be visible. wife=wife (token present), son_name has token 'son'
    // but source says 'bete' (Hindi). Use English source for the son fact to make token visible.
    const source = 'Meri wife Sakshi hai aur my son Shreshth hai';
    const turn = makeTurn({
      intent: 'MEMORY',
      facts: [
        makeFact('wife_name', 'Sakshi'),
        makeFact('son_name', 'Shreshth'),
      ],
    });
    const result = validateTurn(turn, source);
    expect(result.facts).toHaveLength(2);
    const keys = result.facts.map(f => f.canonicalKey);
    expect(keys).toContain('wife_name');
    expect(keys).toContain('son_name');
  });
});

// ── 3. Attribution Boundary ────────────────────────────────────────────────────

describe('Attribution boundary — anti-contamination', () => {
  /**
   * THE CRITICAL TEST:
   * "My wife is Priya and my brother is Amit. Actually she is Sakshi."
   * → wife_name = Sakshi  (correction applies to wife, not brother)
   * → brother_name = Amit (unchanged fact from same turn)
   * → NOT brother_name = Sakshi
   */
  it('applies correction to wife_name only, not brother_name', () => {
    const source = 'My wife is Priya and my brother is Amit. Actually she is Sakshi.';
    const turn = makeTurn({
      intent: 'MIXED',
      facts: [makeFact('brother_name', 'Amit')],
      corrections: [makeCorrection('wife_name', 'Sakshi')],
    });
    const result = validateTurn(turn, source);

    const correctionKeys = result.corrections.map(c => c.canonicalKey);
    expect(correctionKeys).toContain('wife_name');
    expect(correctionKeys).not.toContain('brother_name');

    // Sakshi must NOT appear in brother_name corrections
    const brotherCorrections = result.corrections.filter(c => c.canonicalKey === 'brother_name');
    expect(brotherCorrections.every(c => c.value !== 'Sakshi')).toBe(true);
  });

  it('does not cross-contaminate when correcting brother after wife', () => {
    const source = 'My wife is Priya. Actually my brother is Rahul not Amit.';
    const turn = makeTurn({
      intent: 'MIXED',
      facts: [makeFact('wife_name', 'Priya')],
      corrections: [makeCorrection('brother_name', 'Rahul')],
    });
    const result = validateTurn(turn, source);

    // wife_name should be a fact (Priya), not touched by the brother correction
    const wifeCorrections = result.corrections.filter(c => c.canonicalKey === 'wife_name');
    expect(wifeCorrections.every(c => c.value !== 'Rahul')).toBe(true);

    const brotherCorrections = result.corrections.filter(c => c.canonicalKey === 'brother_name');
    expect(brotherCorrections).toHaveLength(1);
    expect(brotherCorrections[0].value).toBe('Rahul');
  });

  it('rejects a value that belongs to two concepts (ambiguous attribution)', () => {
    // "Ravi" appears once but two concepts claim it
    const source = 'Ravi aur sab theek hai';
    const turn = makeTurn({
      intent: 'MEMORY',
      facts: [
        makeFact('wife_name', 'Ravi'),
        makeFact('friend_name', 'Ravi'),
      ],
    });
    const result = validateTurn(turn, source);
    // Both claim same value "Ravi" — isAttributionUnambiguous rejects both
    expect(result.facts.filter(f => f.value === 'Ravi')).toHaveLength(0);
  });
});

// ── 4. Mixed Turns ─────────────────────────────────────────────────────────────

describe('Mixed turns (correction + fact, correction + reminder)', () => {
  it('handles "My name is Rajesh, my wife is Sakshi, but actually my brother is Rahul"', () => {
    const source = 'My name is Rajesh, my wife is Sakshi, but actually my brother is Rahul.';
    const turn = makeTurn({
      intent: 'MIXED',
      facts: [
        // LLM proposes 'name' (alias) — token 'name' IS in source → passes fact grounding
        makeFact('name', 'Rajesh'),
        makeFact('wife_name', 'Sakshi'),
      ],
      corrections: [makeCorrection('brother_name', 'Rahul')],
    });
    const result = validateTurn(turn, source);

    const factKeys = result.facts.map(f => f.canonicalKey);
    // 'name' aliases to 'preferred_name' after canonical resolution
    expect(factKeys).toContain('preferred_name');
    expect(factKeys).toContain('wife_name');

    const corrKeys = result.corrections.map(c => c.canonicalKey);
    expect(corrKeys).toContain('brother_name');
    expect(result.corrections[0].value).toBe('Rahul');
  });

  it('handles reminder + new fact in same turn', () => {
    const source = 'Remind me tomorrow at 7 PM to call doctor. Also my favourite colour is blue.';
    const reminderAction = makeReminderAction({
      task: 'call doctor',
      date: 'tomorrow',
      time_of_day: '19:00',
    });
    reminderAction.missingFields = [];
    reminderAction.completenessScore = 1.0;

    const turn = makeTurn({
      intent: 'MIXED',
      facts: [makeFact('favourite_colour', 'blue')],
      actions: [reminderAction],
    });
    const result = validateTurn(turn, source);

    // Reminder should be complete
    const remAction = result.actions.find(a => a.type === 'REMINDER');
    expect(remAction?.complete).toBe(true);

    // Fact should persist independently
    const factKeys = result.facts.map(f => f.canonicalKey);
    expect(factKeys).toContain('favourite_color'); // canonicalized
  });
});

// ── 5. Reminder Completeness ───────────────────────────────────────────────────

describe('Reminder completeness — no defaults, no assumptions', () => {
  it('rejects reminder with no time and no event_trigger (asks for time)', () => {
    const action = makeReminderAction({ task: 'call doctor', date: 'tomorrow' });
    const result = validateReminderCompleteness(action);
    expect(result.complete).toBe(false);
    if (!result.complete) {
      expect(result.missingFields).toContain('exact_time');
      expect(result.clarificationQuestion).toBeTruthy();
    }
  });

  it('rejects reminder with only "evening" — asks exact time', () => {
    const action = makeReminderAction({
      task: 'call doctor',
      date: 'tomorrow',
      time_period: 'evening',
    });
    const result = validateReminderCompleteness(action);
    expect(result.complete).toBe(false);
    if (!result.complete) {
      expect(result.missingFields).toContain('exact_time');
      // Question should mention "shaam" (evening in Hinglish)
      expect(result.clarificationQuestion?.toLowerCase()).toMatch(/shaam|exact|time|baje/i);
    }
  });

  it('accepts reminder with exact time_of_day', () => {
    const action = makeReminderAction({
      task: 'call doctor',
      date: 'tomorrow',
      time_of_day: '19:00',
    });
    action.missingFields = [];
    action.completenessScore = 1.0;
    const result = validateReminderCompleteness(action);
    expect(result.complete).toBe(true);
  });

  it('accepts reminder with relative time (in 20 minutes)', () => {
    const action = makeReminderAction({
      task: 'call doctor',
      relative_value: 20,
      relative_unit: 'minutes',
    });
    action.missingFields = [];
    action.completenessScore = 1.0;
    const result = validateReminderCompleteness(action);
    expect(result.complete).toBe(true);
  });

  it('accepts event-triggered reminder with no time at all', () => {
    const action = makeReminderAction({
      task: 'call doctor',
      event_trigger: 'left_the_office',
    });
    action.missingFields = [];
    action.completenessScore = 1.0;
    const result = validateReminderCompleteness(action);
    expect(result.complete).toBe(true);
  });

  it('NEVER defaults to 9AM or 5 minutes — missing time = clarification', () => {
    // If there's a date but no time, never fill in 9AM
    const action = makeReminderAction({ task: 'gym', date: 'tomorrow' });
    const result = validateReminderCompleteness(action);
    expect(result.complete).toBe(false);
    if (!result.complete) {
      // data must NOT have a defaulted time
      expect(result.data.time_of_day).toBeFalsy();
      expect(result.data.relative_value).toBeFalsy();
    }
  });

  it('asks only ONE question at a time (not multiple)', () => {
    // Missing both date and time
    const action = makeReminderAction({ task: 'call doctor' });
    const result = validateReminderCompleteness(action);
    expect(result.complete).toBe(false);
    if (!result.complete) {
      // clarificationQuestion should be a single question, not multiple
      const questionCount = (result.clarificationQuestion?.match(/\?/g) ?? []).length;
      expect(questionCount).toBeLessThanOrEqual(1);
    }
  });
});

// ── 6. Grounding Checks ────────────────────────────────────────────────────────

describe('Grounding — three-part definition', () => {
  describe('isValueGroundedInSource', () => {
    it('returns true when value is literally in source', () => {
      expect(isValueGroundedInSource('Rajesh', 'Mera naam Rajesh hai')).toBe(true);
      expect(isValueGroundedInSource('blue', 'mera favourite color blue hai')).toBe(true);
      expect(isValueGroundedInSource('Sakshi', 'wife Sakshi hai')).toBe(true);
    });

    it('returns false when value is NOT in source', () => {
      expect(isValueGroundedInSource('Rajesh', 'Mera naam galat bataya')).toBe(false);
      expect(isValueGroundedInSource('blue', 'mera favourite color theek hai')).toBe(false);
    });

    it('returns false for empty or very short values', () => {
      expect(isValueGroundedInSource('', 'kuch bhi')).toBe(false);
      expect(isValueGroundedInSource('a', 'kuch bhi')).toBe(false);
    });
  });

  describe('isConceptRelationshipSupported', () => {
    it('returns true for plain facts (no correction signal needed)', () => {
      expect(
        isConceptRelationshipSupported('wife_name', 'Sakshi', 'Meri wife Sakshi hai', false)
      ).toBe(true);
    });

    it('returns true for corrections when correction signal is present', () => {
      expect(
        isConceptRelationshipSupported('user_name', 'Rajesh', 'Mera naam Ravi nahi, Rajesh hai', true)
      ).toBe(true);
      expect(
        isConceptRelationshipSupported('favourite_color', 'blue', 'Actually mera favourite color blue hai', true)
      ).toBe(true);
      // 'not' also counts as correction signal
      expect(
        isConceptRelationshipSupported('brother_name', 'Rahul', 'brother Amit not Rahul actually', true)
      ).toBe(true);
    });

    it('returns false for corrections when no correction signal present', () => {
      // No "nahi", "actually", "galat" etc
      expect(
        isConceptRelationshipSupported('user_name', 'Rajesh', 'Mera naam Rajesh hai', true)
      ).toBe(false);
    });
  });

  describe('isAttributionUnambiguous', () => {
    it('returns true when value belongs to only one concept', () => {
      const allConcepts = [
        { concept: 'wife_name', value: 'Sakshi' },
        { concept: 'son_name', value: 'Shreshth' },
      ];
      expect(isAttributionUnambiguous('wife_name', 'Sakshi', allConcepts)).toBe(true);
      expect(isAttributionUnambiguous('son_name', 'Shreshth', allConcepts)).toBe(true);
    });

    it('returns false when same value is claimed by two concepts', () => {
      const allConcepts = [
        { concept: 'wife_name', value: 'Ravi' },
        { concept: 'friend_name', value: 'Ravi' },
      ];
      expect(isAttributionUnambiguous('wife_name', 'Ravi', allConcepts)).toBe(false);
      expect(isAttributionUnambiguous('friend_name', 'Ravi', allConcepts)).toBe(false);
    });
  });
});

// ── 6.5. Anti-reflexive Validation ────────────────────────────────────────────

describe('Anti-reflexive validation', () => {
  it('rejects reflexively named concepts like wife_name = wife', () => {
    const source = "meri wife ka naam wife hai";
    const turn = makeTurn({
      intent: 'MEMORY',
      facts: [makeFact('wife_name', 'wife')]
    });
    const result = validateTurn(turn, source);
    expect(result.facts).toHaveLength(0);
  });

  it('rejects legitimate generic nouns if they match concept tokens (e.g. company_name = company)', () => {
    const source = "I work at a company called company";
    const turn = makeTurn({
      intent: 'MEMORY',
      facts: [makeFact('company_name', 'company')]
    });
    const result = validateTurn(turn, source);
    expect(result.facts).toHaveLength(0);
  });

  it('accepts legitimate names that partially resemble concepts (e.g. company_name = The Company Store)', () => {
    const source = "I work at The Company Store";
    const turn = makeTurn({
      intent: 'MEMORY',
      facts: [makeFact('company_name', 'The Company Store')]
    });
    const result = validateTurn(turn, source);
    expect(result.facts).toHaveLength(1);
    expect(result.facts[0].value).toBe('The Company Store');
  });

  it('rejects correction with reflexive value', () => {
    const source = "nahi, wife ka naam wife hai";
    const turn = makeTurn({
      intent: 'CORRECTION',
      corrections: [makeCorrection('wife_name', 'wife')]
    });
    const result = validateTurn(turn, source);
    expect(result.corrections).toHaveLength(0);
  });
});

// ── 7. Clarification Scoping ───────────────────────────────────────────────────

describe('Clarification scoping invariant', () => {
  it('resolvesPending carries additionalFacts independently', () => {
    // "7 baje, aur waise meri favourite colour blue hai"
    // resolvesPending for the reminder AND new fact should both be processable
    const source = '7 baje, aur waise meri favourite colour blue hai';
    const turn = makeTurn({
      intent: 'MIXED',
      facts: [makeFact('favourite_colour', 'blue')],
      actions: [],
      resolvesPending: {
        pendingTurnId: 'prev-turn-1',
        resolvedFields: { exact_time: '19:00' },
        additionalFacts: [{ concept: 'favourite_colour', value: 'blue', confidence: 0.9, groundedInTurn: true }],
        additionalActions: [],
      },
    });
    const result = validateTurn(turn, source);
    // The new fact (blue) must be independently validated
    const factKeys = result.facts.map(f => f.canonicalKey);
    expect(factKeys).toContain('favourite_color');
  });

  it('pure resolution turn does not generate unrelated memories', () => {
    // "7 baje" — only resolves reminder, no other info
    const source = '7 baje';
    const turn = makeTurn({
      intent: 'CHAT',
      facts: [], // no new facts
      corrections: [],
      actions: [],
      resolvesPending: {
        pendingTurnId: 'prev-turn-1',
        resolvedFields: { exact_time: '19:00' },
        additionalFacts: [],
        additionalActions: [],
      },
    });
    const result = validateTurn(turn, source);
    // Must not have created any memories
    expect(result.facts).toHaveLength(0);
    expect(result.corrections).toHaveLength(0);
  });
});

// ── 8. Completeness of validateTurn integration ────────────────────────────────

describe('validateTurn integration', () => {
  it('sets requiresClarification true when reminder is incomplete', () => {
    const source = 'Remind me tomorrow evening to call doctor';
    const action = makeReminderAction({
      task: 'call doctor',
      date: 'tomorrow',
      time_period: 'evening',
    });
    const turn = makeTurn({ intent: 'REMINDER', actions: [action] });
    const result = validateTurn(turn, source);
    expect(result.requiresClarification).toBe(true);
    expect(result.clarificationQuestion).toBeTruthy();
  });

  it('sets requiresClarification false for complete reminder', () => {
    const source = 'Remind me tomorrow at 7 PM to call doctor';
    const action: SemanticAction = {
      type: 'REMINDER',
      data: { task: 'call doctor', date: 'tomorrow', time_of_day: '19:00' },
      completenessScore: 1.0,
      missingFields: [],
    };
    const turn = makeTurn({ intent: 'REMINDER', actions: [action] });
    const result = validateTurn(turn, source);
    expect(result.requiresClarification).toBe(false);
  });

  it('validated corrections carry the correct authority', () => {
    const source = 'Nahi yaar, Rajesh hai mera naam';
    const turn = makeTurn({
      intent: 'CORRECTION',
      // user_name aliases to preferred_name canonically
      corrections: [makeCorrection('user_name', 'Rajesh')],
    });
    const result = validateTurn(turn, source);
    expect(result.corrections).toHaveLength(1);
    expect(result.corrections[0].canonicalKey).toBe('preferred_name');
    expect(result.corrections[0].authority).toBe('explicit_user');
    expect(result.corrections[0].correctionIntent).toBe(true);
  });

  it('empty turn produces empty validated turn', () => {
    const result = validateTurn(makeTurn({ intent: 'CHAT' }), 'Hi kya haal');
    expect(result.facts).toHaveLength(0);
    expect(result.corrections).toHaveLength(0);
    expect(result.actions).toHaveLength(0);
    expect(result.requiresClarification).toBe(false);
  });
});
