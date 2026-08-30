/**
 * repairFingerprint.ts — Deterministic SHA-256 Fingerprinting for Phase 2C Repairs
 */

import crypto from 'crypto';
import { RepairType } from '../types/canonicalRepair';

export function generateRepairFingerprint(
  userId: string,
  repairType: RepairType,
  targetEntityId: string,
  discriminator?: string
): string {
  const payload = [
    userId,
    repairType,
    targetEntityId,
    discriminator || 'default',
  ].join('|');

  return crypto.createHash('sha256').update(payload).digest('hex');
}
