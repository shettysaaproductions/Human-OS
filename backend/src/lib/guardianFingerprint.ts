/**
 * guardianFingerprint.ts — Deterministic Anomaly Fingerprinting
 *
 * Computes stable, collision-resistant SHA-256 fingerprints for anomalies.
 * Excludes volatile timestamps to ensure repeated detection of the same underlying
 * state inconsistency updates the detection_count and last_detected_at instead of
 * inserting unbounded duplicate rows.
 */

import crypto from 'crypto';
import { AnomalyCode } from '../types/guardian';

/**
 * Generates a stable SHA-256 fingerprint for an anomaly.
 *
 * @param userId - Canonical user ID (or 'global' for cross-user structural checks)
 * @param anomalyCode - Anomaly code (e.g., 'W-001')
 * @param targetEntityId - Primary identifier of the affected entity (e.g., memory key/id, thread id, job id)
 * @param secondaryKey - Optional discriminator (e.g., canonical key, correlation id)
 */
export function generateAnomalyFingerprint(
  userId: string,
  anomalyCode: AnomalyCode,
  targetEntityId: string,
  secondaryKey?: string
): string {
  const normUser = (userId || 'global').trim().toLowerCase();
  const normCode = anomalyCode.trim().toUpperCase();
  const normEntity = (targetEntityId || 'none').trim().toLowerCase();
  const normSecondary = (secondaryKey || '').trim().toLowerCase();

  const payload = `${normUser}|${normCode}|${normEntity}|${normSecondary}`;
  return crypto.createHash('sha256').update(payload, 'utf8').digest('hex');
}
