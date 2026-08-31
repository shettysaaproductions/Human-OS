/**
 * doubtFingerprint.ts — Deterministic Fingerprint & Evidence Version Generator
 *
 * ARCHITECTURAL INVARIANTS (Phase 2F-C):
 * 1. DETERMINISTIC IDENTITY: Generates stable SHA-256 hashes based strictly on:
 *    - user_id
 *    - category
 *    - sorted target canonical entity keys
 *    - unresolved_question_type
 *    - normalized semantic discriminator
 *    Never uses volatile timestamps or transient wording.
 *
 * 2. DETERMINISTIC EVIDENCE VERSIONING: Computes stable SHA-256 hash of canonical
 *    evidence state (claimed counts/facts, grounded relations/facts, candidate threads).
 *    Does NOT change merely because the same turn is reprocessed or field order varies.
 *    Changes ONLY when underlying semantic facts change.
 */

import { createHash } from 'crypto';
import { DoubtCategory } from '../types/cognitiveDoubt';

/**
 * Generates a stable semantic identity for a cognitive doubt.
 */
export function generateDoubtFingerprint(
  userId: string,
  category: DoubtCategory,
  targetEntityKeys: string[] = [],
  semanticDiscriminator?: string,
  unresolvedQuestionType?: string
): string {
  const normalizedUser = (userId || '').trim();
  const normalizedCategory = (category || '').trim().toLowerCase();
  
  const normalizedKeys = Array.from(
    new Set(
      targetEntityKeys
        .map(k => (typeof k === 'string' ? k.trim().toLowerCase() : ''))
        .filter(Boolean)
    )
  )
    .sort()
    .join(',');

  const normalizedQuestionType = (unresolvedQuestionType || category || '').trim().toLowerCase();
  const normalizedDiscriminator = (semanticDiscriminator || '').trim().toLowerCase();

  const payload = [
    normalizedUser,
    normalizedCategory,
    normalizedKeys,
    normalizedQuestionType,
    normalizedDiscriminator,
  ].join('|');

  return createHash('sha256').update(payload).digest('hex');
}

/**
 * Normalizes an evidence value recursively, stripping volatile runtime timestamps.
 */
function normalizeEvidenceValue(val: any): any {
  if (val === null || val === undefined) return null;
  if (typeof val === 'number' || typeof val === 'boolean') return val;
  if (typeof val === 'string') return val.trim().toLowerCase();

  if (Array.isArray(val)) {
    return val
      .map(item => normalizeEvidenceValue(item))
      .filter(item => item !== null)
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  }

  if (typeof val === 'object') {
    const volatileKeys = new Set([
      'evidence_version',
      'created_at',
      'updated_at',
      'last_checked_at',
      'timestamp',
      'durationMs',
      'evaluation_ms',
      'reopened_at',
      'last_ambiguous_reply_at',
    ]);

    const sortedKeys = Object.keys(val)
      .filter(k => !volatileKeys.has(k))
      .sort();

    const normalizedObj: Record<string, any> = {};
    for (const key of sortedKeys) {
      const normalizedSub = normalizeEvidenceValue(val[key]);
      if (normalizedSub !== null && normalizedSub !== undefined) {
        normalizedObj[key.trim().toLowerCase()] = normalizedSub;
      }
    }
    return normalizedObj;
  }

  return String(val).trim().toLowerCase();
}

/**
 * Derives a deterministic evidence version from the normalized evidence payload.
 */
export function deriveEvidenceVersion(evidence: Record<string, any> = {}): string {
  const canonicalEvidence = normalizeEvidenceValue(evidence);
  const jsonString = JSON.stringify(canonicalEvidence || {});
  return createHash('sha256').update(jsonString).digest('hex');
}
