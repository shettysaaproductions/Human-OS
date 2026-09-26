/**
 * IncidentManager.ts — Engineering Incident Lifecycle & Fingerprinting Engine
 *
 * ARCHITECTURAL INVARIANTS:
 * 1. Fingerprint Stability: Fingerprints are derived strictly from (userId, flawType, canonicalSubject, failureSignature).
 *    Identical defects produce the identical fingerprint, while distinct defects do not collide.
 * 2. Immutable Historical Truth: Incidents are never deleted upon resolution.
 * 3. Regression Authority: Any new occurrence of a previously resolved fingerprint automatically
 *    transitions the incident into status = 'regression', raising an immediate high-priority alert.
 * 4. Deduplication: In-flight or unresolved defects increment detection_count rather than creating
 *    duplicate incident rows.
 * 5. Safe Blocking: If an incident requires capabilities exceeding current runtime capacity,
 *    it is marked status = 'blocked' with a specific blocked_reason.
 */

import crypto from 'crypto';
import { supabaseAdmin } from '../../lib/supabase';
import { logger } from '../../lib/logger';
import {
  EvaluationFinding,
  ObservableDialogueEvidence,
  EngineeringIncidentRecord,
  IncidentStatus
} from './types';

export interface IncidentRecordResult {
  incidentId: string;
  fingerprint: string;
  action: 'NEW_INCIDENT' | 'DUPLICATE_OBSERVED' | 'REGRESSION_DETECTED' | 'BLOCKED_CAPABILITY';
  status: IncidentStatus;
  detectionCount: number;
}

export function computeIncidentFingerprint(
  userId: string | null,
  flawType: string,
  canonicalSubject: string,
  failureSignature: string
): string {
  const parts = [
    (userId || 'global').trim().toLowerCase(),
    flawType.trim().toUpperCase(),
    canonicalSubject.trim().toLowerCase(),
    failureSignature.trim().toLowerCase()
  ];
  return crypto.createHash('sha256').update(parts.join('::')).digest('hex');
}

export class IncidentManager {
  /**
   * Ingest an evaluation finding and transition incident lifecycle.
   */
  async recordFinding(
    finding: EvaluationFinding,
    evidence: ObservableDialogueEvidence
  ): Promise<IncidentRecordResult> {
    const fingerprint = computeIncidentFingerprint(
      evidence.userId,
      finding.flawType,
      finding.canonicalSubject,
      finding.failureSignature
    );

    // 1. Query existing incident by stable fingerprint
    const { data: existing, error: fetchErr } = await supabaseAdmin
      .from('nova_engineering_incidents')
      .select('*')
      .eq('fingerprint', fingerprint)
      .maybeSingle();

    if (fetchErr) {
      logger.error('[IncidentManager] Database error checking existing incident', { error: fetchErr.message });
      throw fetchErr;
    }

    const now = new Date().toISOString();

    // ── CASE 1: NEW INCIDENT ───────────────────────────────────────────────────
    if (!existing) {
      const isBlocked = finding.requiredCapability === 'ROOT_CAUSE_DIAGNOSIS' &&
        finding.failureSignature.includes('capability_unavailable');

      const initialStatus: IncidentStatus = isBlocked ? 'blocked' : 'open';

      const payload: Partial<EngineeringIncidentRecord> = {
        fingerprint,
        flaw_type: finding.flawType,
        severity: finding.severity,
        status: initialStatus,
        confidence: finding.confidence,
        user_id: evidence.userId,
        conversation_id: evidence.conversationId,
        source_message_id: evidence.assistantMessageId,
        evidence: evidence,
        required_capability: finding.requiredCapability,
        detection_count: 1,
        first_detected_at: now,
        last_detected_at: now,
        recommended_action: finding.recommendedAction,
        blocked_reason: isBlocked ? finding.reasoningSummary : null,
      };

      const { data: inserted, error: insertErr } = await supabaseAdmin
        .from('nova_engineering_incidents')
        .insert(payload)
        .select('id, status, detection_count')
        .single();

      if (insertErr) {
        // Race condition fallback: someone else inserted with same fingerprint
        if (insertErr.code === '23505') {
          return this.recordFinding(finding, evidence);
        }
        logger.error('[IncidentManager] Failed to insert new incident', { error: insertErr.message });
        throw insertErr;
      }

      logger.info('[IncidentManager] New engineering incident recorded', {
        incidentId: inserted.id,
        flawType: finding.flawType,
        fingerprint,
        status: initialStatus
      });

      return {
        incidentId: inserted.id,
        fingerprint,
        action: isBlocked ? 'BLOCKED_CAPABILITY' : 'NEW_INCIDENT',
        status: inserted.status,
        detectionCount: inserted.detection_count
      };
    }

    // ── CASE 2: REGRESSION OF RESOLVED INCIDENT ───────────────────────────────
    if (existing.status === 'resolved') {
      const newDetectionCount = (existing.detection_count || 1) + 1;
      const regressionNote = `REGRESSION detected at ${now} (previously marked resolved at ${existing.resolved_at || 'unknown'})`;

      const { data: updated, error: updateErr } = await supabaseAdmin
        .from('nova_engineering_incidents')
        .update({
          status: 'regression',
          detection_count: newDetectionCount,
          last_detected_at: now,
          evidence: evidence,
          resolution_note: regressionNote,
          updated_at: now
        })
        .eq('id', existing.id)
        .select('id, status, detection_count')
        .single();

      if (updateErr) {
        logger.error('[IncidentManager] Failed to mark regression on incident', { error: updateErr.message });
        throw updateErr;
      }

      logger.warn('[IncidentManager] ⚠️ REGRESSION DETECTED on previously resolved incident', {
        incidentId: existing.id,
        flawType: existing.flaw_type,
        fingerprint,
        detectionCount: newDetectionCount
      });

      return {
        incidentId: updated.id,
        fingerprint,
        action: 'REGRESSION_DETECTED',
        status: 'regression',
        detectionCount: updated.detection_count
      };
    }

    // ── CASE 3: DUPLICATE OBSERVATION (In-Flight / Open / Blocked) ──────────────
    const newDetectionCount = (existing.detection_count || 1) + 1;
    const { data: updated, error: updateErr } = await supabaseAdmin
      .from('nova_engineering_incidents')
      .update({
        detection_count: newDetectionCount,
        last_detected_at: now,
        evidence: evidence,
        updated_at: now
      })
      .eq('id', existing.id)
      .select('id, status, detection_count')
      .single();

    if (updateErr) {
      logger.error('[IncidentManager] Failed to increment detection count', { error: updateErr.message });
      throw updateErr;
    }

    logger.debug('[IncidentManager] Duplicate defect observation recorded', {
      incidentId: existing.id,
      fingerprint,
      detectionCount: newDetectionCount
    });

    return {
      incidentId: updated.id,
      fingerprint,
      action: 'DUPLICATE_OBSERVED',
      status: updated.status,
      detectionCount: updated.detection_count
    };
  }

  /**
   * Resolve an incident with an audit note. Historical record is preserved.
   */
  async resolveIncident(incidentId: string, resolutionNote: string): Promise<boolean> {
    const now = new Date().toISOString();
    const { error } = await supabaseAdmin
      .from('nova_engineering_incidents')
      .update({
        status: 'resolved',
        resolved_at: now,
        resolution_note: resolutionNote,
        updated_at: now
      })
      .eq('id', incidentId);

    if (error) {
      logger.error('[IncidentManager] Failed to resolve incident', { incidentId, error: error.message });
      return false;
    }

    logger.info('[IncidentManager] Incident resolved', { incidentId, resolutionNote });
    return true;
  }

  /**
   * Mark an incident as blocked when requiring higher reasoning capabilities.
   */
  async blockIncident(incidentId: string, blockedReason: string): Promise<boolean> {
    const now = new Date().toISOString();
    const { error } = await supabaseAdmin
      .from('nova_engineering_incidents')
      .update({
        status: 'blocked',
        blocked_reason: blockedReason,
        updated_at: now
      })
      .eq('id', incidentId);

    if (error) {
      logger.error('[IncidentManager] Failed to block incident', { incidentId, error: error.message });
      return false;
    }

    logger.warn('[IncidentManager] Incident marked BLOCKED pending higher capability tier', { incidentId, blockedReason });
    return true;
  }
}

export const incidentManager = new IncidentManager();
