import { MemorySemanticResolver } from './MemorySemanticResolver';
import { isKnownCanonicalKey } from './memoryKeySchema';

const GENERIC_KEY_TOKENS = new Set(['name', 'nickname', 'value', 'fact', 'the', 'a', 'an']);

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeConceptText(s: string): string {
  return s
    .toLowerCase()
    .replace(/favourite/g, 'favorite')
    .replace(/colour/g, 'color');
}

function hasWord(haystack: string, word: string): boolean {
  if (!word) return false;
  const re = new RegExp(`(?:^|[^a-z0-9_])${escapeRegExp(word)}(?:[^a-z0-9_]|$)`, 'i');
  return re.test(haystack);
}

export function isValueGroundedInSource(value: string, sourceMessage: string): boolean {
  const val = (value ?? '').trim();
  if (!val) return false;
  return hasWord(sourceMessage, val);
}

export function isValueDerivedKey(canonicalKey: string, value: string): boolean {
  const key = (canonicalKey ?? '').trim().toLowerCase();
  const v = (value ?? '').trim().toLowerCase().replace(/\s+/g, '_');
  if (!key || !v) return false;
  if (!key.endsWith(`_${v}`)) return false;
  const prefix = key.slice(0, -(v.length + 1));
  return prefix.length > 0;
}

export function isConceptGrounded(
  canonicalKey: string,
  sourceMessage: string,
  contextText?: string
): boolean {
  const haystack = normalizeConceptText(`${sourceMessage} ${contextText || ''}`);
  const tokens = canonicalKey
    .split('_')
    .map(t => normalizeConceptText(t))
    .filter(t => t && !GENERIC_KEY_TOKENS.has(t));

  if (tokens.length === 0) return false;
  return tokens.every(t => hasWord(haystack, t));
}

export interface ValidatedCorrection {
  key: string;
  value: string;
}

/**
 * Fail-closed semantic correction validation.
 * Does not teach Hinglish vocabulary; checks grounding, canonical resolution,
 * and rejects value-appended keys.
 */
export function validateSemanticCorrection(
  mem: { key?: string; concept?: string; value?: string; shouldPersist?: boolean } | null | undefined,
  sourceMessage: string,
  contextText?: string
): ValidatedCorrection | null {
  if (!mem) return null;
  if (mem.shouldPersist !== true) return null;

  const rawKey = (mem.key ?? mem.concept ?? '').trim();
  const rawValue = (mem.value ?? '').trim();
  if (!rawKey || !rawValue) return null;
  if (!sourceMessage || !sourceMessage.trim()) return null;

  if (!isValueGroundedInSource(rawValue, sourceMessage)) return null;

  const snake = rawKey.toLowerCase().replace(/-/g, '_').replace(/\s+/g, '_');
  const resolution = MemorySemanticResolver.resolveProposedKey(snake);
  if (resolution.action !== 'PERSIST' || !resolution.canonicalKey) return null;

  const canonicalKey = resolution.canonicalKey;
  if (!isKnownCanonicalKey(canonicalKey)) return null;
  if (isValueDerivedKey(canonicalKey, rawValue)) return null;
  if (!isConceptGrounded(canonicalKey, sourceMessage, contextText)) return null;

  return { key: canonicalKey, value: rawValue };
}

function deterministicCorrectionFromUserTurn(sourceMessage: string): ValidatedCorrection | null {
  try {
    // Loaded dynamically to avoid the existing TurnAnalyzer -> correctionSemantics dependency cycle.
    const { TurnAnalyzer } = require('../services/TurnAnalyzer') as typeof import('../services/TurnAnalyzer');
    const analysis = TurnAnalyzer.analyze([{ role: 'user', message: sourceMessage }]);
    const target = analysis.correctionTarget ?? null;
    const value = analysis.correctionValue ?? null;
    if (!target || !value) return null;
    return validateSemanticCorrection({ key: target, value, shouldPersist: true }, sourceMessage);
  } catch {
    return null;
  }
}

/**
 * Select corrections only when there is exactly one distinct valid semantic
 * correction. If TurnAnalyzer deterministically resolved target+value from the
 * user turn, that pair is authoritative and the LLM cannot substitute either.
 * Multiple fallback candidates are ambiguous and therefore fail closed.
 */
export function selectAuthoritativeCorrections(
  memories: any[] | null | undefined,
  sourceMessage: string,
  contextText?: string
): any[] {
  const deterministic = deterministicCorrectionFromUserTurn(sourceMessage);
  if (deterministic) {
    return [{
      shouldPersist: true,
      type: 'fact',
      key: deterministic.key,
      value: deterministic.value,
      importance: 100,
      confidence: 1.0,
      emotional_weight: 0,
      correction_intent: true,
    }];
  }

  if (!Array.isArray(memories) || memories.length === 0) return [];

  const valid = memories
    .map(mem => {
      const validated = validateSemanticCorrection(mem, sourceMessage, contextText);
      if (!validated) return null;
      return { mem, validated };
    })
    .filter((entry): entry is { mem: any; validated: ValidatedCorrection } => entry !== null);

  const unique = new Map<string, { mem: any; validated: ValidatedCorrection }>();
  for (const entry of valid) {
    const identity = `${entry.validated.key}\u0000${entry.validated.value.trim().toLowerCase()}`;
    if (!unique.has(identity)) unique.set(identity, entry);
  }

  if (unique.size !== 1) return [];

  const { mem, validated } = unique.values().next().value as { mem: any; validated: ValidatedCorrection };
  return [{
    shouldPersist: true,
    type: mem.type || 'fact',
    key: validated.key,
    value: validated.value,
    importance: 100,
    confidence: 1.0,
    emotional_weight: mem.emotional_weight || 0,
    correction_intent: true,
  }];
}
