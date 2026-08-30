/**
 * doubtFingerprint.ts — Deterministic Fingerprint Generator for Cognitive Doubts
 *
 * Generates stable SHA-256 hashes based strictly on:
 * - user_id
 * - category
 * - sorted target canonical entity keys
 * - deterministic semantic discriminator
 *
 * Never uses volatile timestamps, ensuring identical epistemic uncertainty
 * reuses the existing doubt record without duplicate rows.
 */

import { createHash } from 'crypto';
import { DoubtCategory } from '../types/cognitiveDoubt';

export function generateDoubtFingerprint(
  userId: string,
  category: DoubtCategory,
  targetEntityKeys: string[] = [],
  semanticDiscriminator?: string
): string {
  const normalizedKeys = [...targetEntityKeys]
    .map(k => k.trim().toLowerCase())
    .sort()
    .join(',');

  const normalizedDiscriminator = (semanticDiscriminator || '').trim().toLowerCase();

  const payload = [
    userId,
    category,
    normalizedKeys,
    normalizedDiscriminator,
  ].join('|');

  return createHash('sha256').update(payload).digest('hex');
}
