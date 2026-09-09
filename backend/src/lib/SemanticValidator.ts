/**
 * SemanticValidator — Nova's Deterministic Guard Layer (Phase 0)
 *
 * Responsibility: VALIDATION ONLY. No LLM calls.
 *   - Takes a SemanticTurn from SemanticInterpreter.
 *   - Applies deterministic checks: grounding, canonical resolution, authority eligibility,
 *     completeness, and attribution.
 *   - Produces a ValidatedTurn: only what the state engines (MemoryRepository,
 *     ReminderEngine, etc.) are ALLOWED to act on.
 *
 * INVARIANT: SemanticValidator NEVER interprets meaning.
 *   It only decides whether semantically-interpreted content meets the bar
 *   for being acted upon by the authority engine.
 *
 * Three-part grounding definition (Fix #2):
 *   1. Value exists in source message (literal presence)
 *   2. Concept/value RELATIONSHIP is supported by the source message
 *      (not just both words present independently)
 *   3. Attribution is unambiguous — value maps to exactly one concept
 *      in this turn (especially critical for multi-field and correction turns)
 */

import { MemorySemanticResolver } from './MemorySemanticResolver';
import { isKnownCanonicalKey } from './memoryKeySchema';
import {
  SemanticTurn,
  SemanticAction,
} from './SemanticInterpreter';

// ── Validated Output Types ─────────────────────────────────────────────────────

export interface ValidatedFact {
  canonicalKey: string;
  value: string;
  authority: 'subconscious_inference';
  confidence: number;
  type: 'fact';
}

export interface ValidatedCorrection {
  canonicalKey: string;
  value: string;
  authority: 'explicit_user';
  importance: 100;
  confidence: 1.0;
  groundingVerified: true;
  canonicalVerified: true;
  attributionVerified: true;
  correctionIntent: true;
}

export interface ValidatedReminderAction {
  type: 'REMINDER';
  data: Record<string, any>;
  complete: true;
}

export interface IncompleteAction {
  type: SemanticAction['type'];
  data: Record<string, any>;
  complete: false;
  missingFields: string[];
  clarificationQuestion?: string;
}

export type ValidatedAction = ValidatedReminderAction | IncompleteAction;

export interface ValidatedTurn {
  turnId: string;
  facts: ValidatedFact[];
  corrections: ValidatedCorrection[];
  actions: ValidatedAction[];
  requiresClarification: boolean;
  clarificationQuestion?: string;
}

// ── Grounding Helpers ──────────────────────────────────────────────────────────

const GENERIC_KEY_TOKENS = new Set(['name', 'nickname', 'value', 'fact', 'the', 'a', 'an', 'mera', 'meri', 'mere']);

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hasWordBoundary(haystack: string, word: string): boolean {
  if (!word || word.length < 2) return false;
  const re = new RegExp(`(?:^|[^a-z0-9_])${escapeRegExp(word.toLowerCase())}(?:[^a-z0-9_]|$)`, 'i');
  return re.test(haystack);
}

/**
 * Check 1: Does the value literally appear in the source message?
 */
export function isValueGroundedInSource(value: string, sourceMessage: string): boolean {
  const val = (value ?? '').trim();
  if (!val || val.length < 2) return false;
  return hasWordBoundary(sourceMessage, val);
}

/**
 * Check 2: Is the concept/value RELATIONSHIP supported by the source message?
 *
 * "Meri wife Priya hai. Actually woh Sakshi hai."
 *   → Both "Priya" and "Sakshi" are grounded literally.
 *   → But only "Sakshi" is a correction: the correction signal ("Actually",
 *     "nahi", "woh nahi", "galat") must be present when a correction is claimed.
 *
 * For corrections: we verify a correction signal is present in source.
 *   We do NOT require concept tokens to appear in the source because Hinglish
 *   users say "naam" not "user" or "name" — the canonical resolution handles that.
 *
 * For plain facts: at least one non-generic concept token must appear in source.
 */
const CONCEPT_SYNONYMS: Record<string, string[]> = {
  wife: ['wife', 'biwi', 'patni', 'bivi', 'mrs', 'partner', 'dharampatni', 'bahu', 'begum', 'aurat'],
  husband: ['husband', 'pati', 'miyan', 'partner', 'shauhar', 'mister', 'mr'],
  son: ['son', 'beta', 'bete', 'ladka', 'ladke', 'bachha', 'baccha', 'child', 'kid', 'bache', 'lalla', 'munna', 'putra'],
  daughter: ['daughter', 'beti', 'betiyan', 'ladki', 'ladkiyan', 'bachhi', 'child', 'kid', 'putri', 'gudiya', 'munni', 'kanya'],
  child: ['child', 'kid', 'bachha', 'baccha', 'bache', 'beta', 'bete', 'beti', 'betiyan'],
  mother: ['mother', 'mom', 'mummy', 'maa', 'mata', 'ammi', 'mataji', 'maaji', 'aai'],
  father: ['father', 'dad', 'papa', 'baap', 'pitaji', 'abbu', 'pita', 'bapuji', 'pappa'],
  brother: ['brother', 'bhai', 'bhaiya', 'bro', 'veer', 'bhrata', 'bhaiyon'],
  sister: ['sister', 'behen', 'didi', 'sis', 'bahin', 'behna', 'didiya'],
  friend: ['friend', 'dost', 'yaar', 'buddy', 'dostan'],
  user: ['mera', 'meri', 'mere', 'my', 'mine', 'naam', 'name', 'apna', 'apni', 'apne', 'self', 'full', 'pura'],
  preferred: ['mera', 'meri', 'mere', 'my', 'mine', 'naam', 'name', 'apna', 'apni', 'apne', 'full', 'pura'],
  full: ['mera', 'meri', 'mere', 'my', 'mine', 'naam', 'name', 'apna', 'apni', 'apne', 'full', 'pura'],
  age: ['age', 'umar', 'saal', 'month', 'months', 'mahina', 'mahine', 'year', 'years', 'old'],
};

export function isConceptRelationshipSupported(
  concept: string,
  _value: string,
  sourceMessage: string,
  isCorrectionClaim: boolean,
  contextMessage?: string,
): boolean {
  const combined = (contextMessage ? `${contextMessage} ${sourceMessage}` : sourceMessage).toLowerCase();

  // For corrections: a correction signal must be present in the source or context
  if (isCorrectionClaim) {
    const correctionSignals = [
      'nahi', 'nahin', 'nhi', 'nah ', ' na ', 'not ', ' not',
      'actually', 'woh nahi', 'galat', 'sahi', 'ek correction',
      'sorry', 'mistake', 'bhool', 'woh nah', 'correction hai',
      'actually mera', 'actually meri', 'actually my',
      'actually his', 'actually her', 'actually their',
    ];
    return correctionSignals.some(sig => combined.includes(sig));
  }

  // For facts: at least one non-generic concept token must appear in source or context (including synonyms)
  const tokens = concept
    .split('_')
    .map(t => t.toLowerCase())
    .filter(t => t && !GENERIC_KEY_TOKENS.has(t));

  if (tokens.length === 0) return true; // can’t verify, pass through to canonical check
  return tokens.some(t => {
    if (hasWordBoundary(combined, t)) return true;
    const syns = CONCEPT_SYNONYMS[t] || [];
    return syns.some(syn => hasWordBoundary(combined, syn));
  });
}

/**
 * Check 3: Is the value's attribution to this concept unambiguous?
 *
 * In a multi-field turn, if the SAME value could plausibly belong to two
 * different concepts, attribution is ambiguous and we reject BOTH.
 *
 * Example of ambiguous attribution (we must NOT reject):
 *   "Meri wife Sakshi hai aur bete ka naam Shreshth hai."
 *   → Sakshi → wife_name (unambiguous ✓)
 *   → Shreshth → son_name (unambiguous ✓)
 *
 * Example of genuinely ambiguous:
 *   "Ravi" appears in source but could be wife_name OR friend_name
 *   → reject until more context
 */
export function isAttributionUnambiguous(
  concept: string,
  value: string,
  allConcepts: Array<{ concept: string; value: string }>,
): boolean {
  // Count how many other concepts claim the SAME value
  const sameValue = allConcepts.filter(
    c => c.concept !== concept && c.value.toLowerCase().trim() === value.toLowerCase().trim()
  );
  // If another concept claims the exact same value, attribution is ambiguous
  return sameValue.length === 0;
}

// ── Canonical Validation ───────────────────────────────────────────────────────

/**
 * Check 4: Is the value reflexively naming the concept itself?
 * 
 * E.g. concept = "wife_name", value = "wife"
 * "My wife's name is wife" -> rejected.
 */
export function isValueReflexive(concept: string, value: string): boolean {
  const v = value.toLowerCase().trim();
  if (!v || v.length < 2) return true;
  
  // A generic semantic rule: if the value is precisely one of the tokens 
  // that makes up the concept key (e.g., concept: "wife_name", value: "wife"),
  // or the concept is just the value with an appended identifier like _name.
  const tokens = concept.split('_').map(t => t.toLowerCase());
  if (tokens.includes(v)) return true;
  
  return false;
}

function isValueDerivedKey(canonicalKey: string, value: string): boolean {
  const key = canonicalKey.trim().toLowerCase();
  const v = value.trim().toLowerCase().replace(/\s+/g, '_');
  if (!key || !v) return false;
  if (!key.endsWith(`_${v}`)) return false;
  return key.slice(0, -(v.length + 1)).length > 0;
}

// ── Reminder Completeness ─────────────────────────────────────────────────────

/**
 * Validates a REMINDER action for completeness.
 * NEVER defaults missing fields. Missing = incomplete = needs clarification.
 *
 * Completeness rules:
 *   - task is required
 *   - ONE of: (date + time_of_day) OR relative_value+relative_unit OR event_trigger
 *   - "evening"/"morning"/"night" without exact time_of_day → incomplete (ask exact time)
 */
export function validateReminderCompleteness(action: SemanticAction): ValidatedAction {
  const d = action.data ?? {};

  const hasTask = !!d.task?.trim();
  let exactTimeFormatted: string | null = null;
  if (d.time_of_day) {
    const tm = String(d.time_of_day).trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
    if (tm) {
      let h = parseInt(tm[1], 10);
      const m = tm[2] ? parseInt(tm[2], 10) : 0;
      if (tm[3] && tm[3].toLowerCase() === 'pm' && h < 12) h += 12;
      if (tm[3] && tm[3].toLowerCase() === 'am' && h === 12) h = 0;
      exactTimeFormatted = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
      d.time_of_day = exactTimeFormatted;
    }
  }
  const hasExactTime = !!exactTimeFormatted;
  const hasRelative = (d.relative_value != null) && !!d.relative_unit?.trim();
  const hasEventTrigger = !!d.event_trigger?.trim();
  const hasDate = !!d.date?.trim();
  const hasVaguePeriod = !!d.time_period?.trim() && !hasExactTime;

  const missing: string[] = [];
  const clarifications: string[] = [];

  if (!hasTask) {
    missing.push('task');
    clarifications.push('Kya remind karna hai?');
  }

  if (!hasEventTrigger && !hasRelative) {
    // Time-based reminder path
    if (!hasDate && !hasRelative) {
      missing.push('date');
      clarifications.push('Kab remind karna hai?');
    }
    if (!hasExactTime) {
      if (hasVaguePeriod) {
        // Has "evening"/"morning" but no exact time
        const periodLabel = d.time_period === 'evening' ? 'shaam'
          : d.time_period === 'morning' ? 'subah'
          : d.time_period === 'night' ? 'raat'
          : d.time_period;
        missing.push('exact_time');
        clarifications.push(`${periodLabel} ko exact kaunse baje?`);
      } else if (hasDate) {
        // Has date but no time at all
        missing.push('exact_time');
        clarifications.push('Kaunse time remind karna hai?');
      }
    }
  }

  if (missing.length === 0) {
    return { type: 'REMINDER', data: d, complete: true };
  }

  return {
    type: 'REMINDER',
    data: d,
    complete: false,
    missingFields: missing,
    // Ask only the FIRST missing piece — never multiple questions at once
    clarificationQuestion: clarifications[0],
  };
}

// ── Main Validator ─────────────────────────────────────────────────────────────

/**
 * Validates a SemanticTurn produced by SemanticInterpreter.
 * Returns a ValidatedTurn containing only what the state engines may act on.
 */
export function validateTurn(turn: SemanticTurn, sourceMessage: string, contextMessage?: string): ValidatedTurn {
  const validatedFacts: ValidatedFact[] = [];
  const validatedCorrections: ValidatedCorrection[] = [];
  const validatedActions: ValidatedAction[] = [];

  // All concepts in this turn — for attribution unambiguity check
  const allConceptsInTurn = [
    ...turn.facts.map(f => ({ concept: f.concept, value: f.value })),
    ...turn.corrections.map(c => ({ concept: c.concept, value: c.new_value })),
  ];

  // ── Validate Facts ──────────────────────────────────────────────────────────
  for (const fact of turn.facts) {
    if (!fact.groundedInTurn) {
      console.log(`[SemanticValidator] Rejected fact ${fact.concept} - not groundedInTurn`);
      continue;
    }
    if (!isValueGroundedInSource(fact.value, sourceMessage)) {
      console.log(`[SemanticValidator] Rejected fact ${fact.concept} - value not in source`, { value: fact.value, sourceMessage });
      continue; // Value not literally in source — reject
    }
    if (!isConceptRelationshipSupported(fact.concept, fact.value, sourceMessage, false, contextMessage)) {
      console.log(`[SemanticValidator] Rejected fact ${fact.concept} - concept relationship not supported`);
      continue;
    }
    if (!isAttributionUnambiguous(fact.concept, fact.value, allConceptsInTurn)) {
      console.log(`[SemanticValidator] Rejected fact ${fact.concept} - attribution ambiguous`);
      continue;
    }
    if (isValueReflexive(fact.concept, fact.value)) {
      console.log(`[SemanticValidator] Rejected fact ${fact.concept} - reflexive`);
      continue;
    }

    const snake = fact.concept.toLowerCase().replace(/-/g, '_').replace(/\s+/g, '_');
    const resolution = MemorySemanticResolver.resolveProposedKey(snake);
    if (resolution.action !== 'PERSIST' || !resolution.canonicalKey) {
      console.log(`[SemanticValidator] Rejected fact ${fact.concept} - resolution failed`, resolution);
      continue;
    }
    if (isValueDerivedKey(resolution.canonicalKey, fact.value)) {
      console.log(`[SemanticValidator] Rejected fact ${fact.concept} - derived key`);
      continue;
    }

    validatedFacts.push({
      canonicalKey: resolution.canonicalKey,
      value: fact.value,
      authority: 'subconscious_inference',
      confidence: fact.confidence,
      type: 'fact',
    });
  }

  // ── Validate Corrections ────────────────────────────────────────────────────
  // Each correction is validated INDEPENDENTLY.
  // Multiple valid corrections from one turn are ALL allowed.
  // Ambiguity = unclear intent, NOT multiple clear corrections.
  for (const correction of turn.corrections) {
    if (!correction.groundedInTurn) continue;
    if (!isValueGroundedInSource(correction.new_value, sourceMessage)) continue;
    if (!isConceptRelationshipSupported(correction.concept, correction.new_value, sourceMessage, true, contextMessage)) continue;
    if (!isAttributionUnambiguous(correction.concept, correction.new_value, allConceptsInTurn)) continue;
    if (isValueReflexive(correction.concept, correction.new_value)) continue;

    const snake = correction.concept.toLowerCase().replace(/-/g, '_').replace(/\s+/g, '_');
    const resolution = MemorySemanticResolver.resolveProposedKey(snake);
    if (resolution.action !== 'PERSIST' || !resolution.canonicalKey) continue;
    if (!isKnownCanonicalKey(resolution.canonicalKey)) continue;
    if (isValueDerivedKey(resolution.canonicalKey, correction.new_value)) continue;

    validatedCorrections.push({
      canonicalKey: resolution.canonicalKey,
      value: correction.new_value,
      authority: 'explicit_user',
      importance: 100,
      confidence: 1.0,
      groundingVerified: true,
      canonicalVerified: true,
      attributionVerified: true,
      correctionIntent: true,
    });
  }

  // ── Validate Actions ────────────────────────────────────────────────────────
  for (const action of turn.actions) {
    if (action.type === 'REMINDER') {
      validatedActions.push(validateReminderCompleteness(action));
    } else {
      // Other action types: pass through if data is non-empty
      if (action.data && Object.keys(action.data).length > 0) {
        validatedActions.push({ type: action.type, data: action.data, complete: true } as any);
      }
    }
  }

  // ── Clarification requirement ───────────────────────────────────────────────
  const incompleteAction = validatedActions.find(a => !a.complete) as IncompleteAction | undefined;
  const requiresClarification =
    turn.clarification.required || !!incompleteAction;

  const clarificationQuestion =
    incompleteAction?.clarificationQuestion
    ?? turn.clarification.question
    ?? undefined;

  return {
    turnId: turn.turnId,
    facts: validatedFacts,
    corrections: validatedCorrections,
    actions: validatedActions,
    requiresClarification,
    clarificationQuestion,
  };
}
