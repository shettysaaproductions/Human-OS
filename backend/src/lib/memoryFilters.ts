/**
 * memoryFilters.ts — Shared garbage memory admission guard.
 *
 * Applied at EVERY extraction path (ConsolidatedMemoryAgent, DeterministicFactAgent,
 * memoryRepository) as layered defense-in-depth so no extraction path may persist
 * obvious question text, meta labels, or raw phatic utterances as durable memory.
 *
 * Amendment 1: Common admission boundary for ALL extraction paths.
 */

import { logger } from './logger';

// ── Value-level garbage patterns ────────────────────────────────────────────────
// These match values (not keys) that are clearly prompt template artifacts,
// phatic acknowledgements, or plain user utterances misclassified as facts.
const GARBAGE_VALUE_PATTERNS: RegExp[] = [
  /^user['']?s\s+/i,                // "User's active goals", "User's current project"
  /^the\s+user\s+/i,                // "The user's goals"
  /^(nova'?s?\s+)?memory\s+(about|of)\s+/i, // "Nova's memory about X"
  /\?$/,                             // Ends with "?" = stored question text, not a fact
  /^(haan|nahi|nai|ok|theek hai?|bas|ha|achha|hm|hmm|hmm+)$/i, // Phatic acks
  /^main wapas aa gaya$/i,          // "I'm back" — raw utterance transcript
  /^(what should i do|kya karna chahiye|aur kuch|batao na|tell me more)$/i,
  /^(user|nova)\s*:/i,              // "User:" / "Nova:" chat transcript leaks
  /^\[?(system|assistant|user)\]?:/i, // Raw role-prefixed text
  /^(active goals?|current goals?|long.?term goals?|user's goals?)$/i,
  /^(pending tasks?|upcoming tasks?|active tasks?)$/i,
];

// ── Key-level garbage patterns ───────────────────────────────────────────────
// These match keys that should never hold durable facts.
const GARBAGE_KEY_PATTERNS: RegExp[] = [
  /^active_goals?$/i,
  /^pending_kam$/i,           // The confirmed garbage key from forensic audit
  /^(recent_)?conversation$/i,
  /^last_message(_content)?$/i,
  /^(current_)?utterance$/i,
];

// ── Minimum value length ─────────────────────────────────────────────────────
const MIN_VALUE_LENGTH = 2;

/**
 * Returns true if the given memory value is obviously garbage and should NOT
 * be persisted. Applies to semantic memories and working memory alike.
 *
 * @param key   - The memory key (canonical snake_case).
 * @param value - The candidate value string.
 * @param source - Optional source label for logging.
 */
export function isGarbageMemoryValue(key: string, value: string, source?: string): boolean {
  const v = (value ?? '').trim();
  const k = (key ?? '').trim().toLowerCase();

  if (v.length < MIN_VALUE_LENGTH) {
    logger.info('[MemoryFilter] BLOCKED short value', { key, value: v, source });
    return true;
  }

  for (const pattern of GARBAGE_KEY_PATTERNS) {
    if (pattern.test(k)) {
      logger.info('[MemoryFilter] BLOCKED garbage key', { key, value: v, source });
      return true;
    }
  }

  for (const pattern of GARBAGE_VALUE_PATTERNS) {
    if (pattern.test(v)) {
      logger.info('[MemoryFilter] BLOCKED garbage value', { key, value: v, source });
      return true;
    }
  }

  return false;
}

/**
 * Filters an array of working_memory inserts, removing garbage entries.
 * Returns a new filtered array.
 */
export function filterGarbageWorkingMemories(
  entries: { key: string; value: string; [k: string]: any }[],
  source?: string
): { key: string; value: string; [k: string]: any }[] {
  return entries.filter(e => {
    if (isGarbageMemoryValue(e.key, e.value, source)) return false;
    return true;
  });
}
