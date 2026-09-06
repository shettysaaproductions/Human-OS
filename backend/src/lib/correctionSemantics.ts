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

/**
 * Select all valid semantic corrections from the LLM-extracted memory array.
 *
 * Architecture change (Phase 0 — Step 3):
 *   BEFORE: required exactly one distinct valid correction (unique.size !== 1 → [])
 *           This was causing legitimate multi-field corrections to be silently dropped.
 *           e.g. "Meri wife Sakshi hai aur bhai ka naam Rahul hai" → nothing saved.
 *
 *   AFTER:  each correction is validated INDEPENDENTLY.
 *           Multiple valid corrections from one turn ALL persist.
 *           Ambiguity = genuinely unclear intent, NOT multiple clear corrections.
 *
 * What still fails closed (unchanged):
 *   - Value not grounded in source message → rejected
 *   - Key does not resolve to a known canonical key → rejected
 *   - Value-derived key (e.g. favourite_color_green) → rejected
 *   - Concept not grounded in source → rejected
 *   - shouldPersist !== true → rejected
 *   - Duplicate key+value pairs → deduplicated (first wins, deterministic)
 */
export function selectAuthoritativeCorrections(
  memories: any[] | null | undefined,
  sourceMessage: string,
  contextText?: string
): any[] {
  if (!Array.isArray(memories) || memories.length === 0) return [];

  // Validate each candidate independently
  const valid = memories
    .map(mem => {
      const validated = validateSemanticCorrection(mem, sourceMessage, contextText);
      if (!validated) return null;
      return { mem, validated };
    })
    .filter((entry): entry is { mem: any; validated: ValidatedCorrection } => entry !== null);

  if (valid.length === 0) return [];

  // Deduplicate: same canonical key + same normalised value → keep first occurrence only.
  // Different canonical keys or different values are distinct corrections — keep both.
  const seen = new Map<string, true>();
  const results: any[] = [];

  for (const { mem, validated } of valid) {
    const identity = `${validated.key}\u0000${validated.value.trim().toLowerCase()}`;
    if (seen.has(identity)) continue;
    seen.set(identity, true);

    results.push({
      shouldPersist: true,
      type: mem.type || 'fact',
      key: validated.key,
      value: validated.value,
      importance: 100,
      confidence: 1.0,
      emotional_weight: mem.emotional_weight || 0,
      correction_intent: true,
    });
  }

  return results;
}
