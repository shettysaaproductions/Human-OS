/**
 * IncidentManager.ts — Engineering Incident Lifecycle & Fingerprinting Engine
 *
 * ARCHITECTURAL INVARIANTS:
 * 1. Semantic Fingerprint Stability: Fingerprints are derived strictly from normalized
 *    behavioral identity (userId, flawType, canonicalEntity, rootBehaviorSignature).
 *    Identical defects produce the identical canonical fingerprint, while distinct defects do not collide.
 * 2. Immutable Historical Truth: Incidents are never deleted upon resolution. Historical fingerprints preserved.
 * 3. Regression Authority: Any new occurrence of a previously resolved fingerprint automatically
 *    transitions the incident into status = 'regression', raising an immediate high-priority alert.
 * 4. Deduplication: In-flight or unresolved defects increment detection_count rather than creating
 *    duplicate incident rows.
 * 5. Safe Blocking: If an incident requires capabilities exceeding current runtime capacity,
 *    it is marked status = 'blocked' with a specific blocked_reason and actionability_status = 'BLOCKED'.
 * 6. Actionability Gate: Medium-confidence findings (0.75–0.89) undergo secondary adversarial
 *    verification before becoming VERIFIED.
 * 7. Automation Safety Boundary: Automated external ticket creation is explicitly DISABLED.
 */

import crypto from 'crypto';
import { supabaseAdmin } from '../../lib/supabase';
import { logger } from '../../lib/logger';
import {
  EvaluationFinding,
  ObservableDialogueEvidence,
  EngineeringIncidentRecord,
  IncidentStatus,
  ActionabilityStatus,
  FlawType,
  IncidentSeverity
} from './types';
import { normalizeFingerprintSlug } from './ConversationalEvaluator';
import { adversarialVerifier, AdversarialVerifier } from './AdversarialVerifier';

export interface IncidentRecordResult {
  incidentId: string;
  fingerprint: string;
  action: 'NEW_INCIDENT' | 'DUPLICATE_OBSERVED' | 'REGRESSION_DETECTED' | 'BLOCKED_CAPABILITY';
  status: IncidentStatus;
  actionabilityStatus: ActionabilityStatus;
  detectionCount: number;
}

export interface NormalizedSemanticCluster {
  canonicalSubject: string;
  normalizedEntity: string;
  rootBehaviorSignature: string;
}

export interface EngineeringQueueItem {
  canonicalFingerprint: string;
  flawType: FlawType;
  canonicalSubject: string;
  severity: IncidentSeverity;
  detectionCount: number;
  actionabilityStatus: ActionabilityStatus;
  incidentIds: string[];
  evidenceSummary: string;
}

/**
 * Extracts a normalized semantic cluster from finding attributes and dialogue text,
 * preventing wording variations from fragmenting fingerprints into separate database rows.
 */
export function extractSemanticCluster(
  _flawType: string,
  canonicalSubject: string,
  failureSignature: string,
  evidenceText: string = ''
): NormalizedSemanticCluster {
  const combined = `${canonicalSubject || ''} ${failureSignature || ''} ${evidenceText || ''}`.toLowerCase();

  // Cluster 1: Kin / Child Birthday Proactive Derailment & Inundation
  if (
    /(tiku|shreshth|bete_ka|bete|child|son).*(birthday|bday)/i.test(combined) ||
    /(birthday|bday).*(tiku|shreshth|bete|planning|plan|special_ideas)/i.test(combined)
  ) {
    return {
      canonicalSubject: 'kin_birthday_planning',
      normalizedEntity: 'kin_birthday',
      rootBehaviorSignature: 'proactive_birthday_inundation_loop'
    };
  }

  // Cluster 2: Inappropriate Dialing Template Leakage ("new numbers dial karna hoga")
  if (
    /(new.*numbers|dial.*karna|dialing.*numbers|calling.*reminder.*template|har.*roz.*new.*numbers)/i.test(combined)
  ) {
    return {
      canonicalSubject: 'template_leak_dialing_numbers',
      normalizedEntity: 'calling_template',
      rootBehaviorSignature: 'inappropriate_dialing_boilerplate_appendage'
    };
  }

  // Cluster 3: Inopportune Morning 8 AM Routine Reminders
  if (
    /(8.*am.*office|8.*am.*wake|morning.*routine.*commute|daily.*routine.*reminder|office.*ke.*liye.*reminder)/i.test(combined)
  ) {
    return {
      canonicalSubject: 'routine_office_morning_reminder',
      normalizedEntity: 'morning_routine',
      rootBehaviorSignature: 'mismatched_temporal_routine_injection'
    };
  }

  // Cluster 4: Entity Role & Nickname Inversion (Sagar vs Tiku)
  if (
    /(tiku.*sagar|sagar.*tiku|nickname.*bete|father.*son.*name|user_name_confusion)/i.test(combined)
  ) {
    return {
      canonicalSubject: 'entity_identity_nickname',
      normalizedEntity: 'user_identity_nickname',
      rootBehaviorSignature: 'user_child_role_confusion'
    };
  }

  // Cluster 5: Fabricated Party Event Hallucination & Defense
  if (
    /(party|kis.*party|party.*mein|celebration_event).*(hallucinat|direct.*asume|proof)/i.test(combined) ||
    /(party_attendance|hallucinated_party)/i.test(combined)
  ) {
    return {
      canonicalSubject: 'hallucinated_social_event',
      normalizedEntity: 'hallucinated_event',
      rootBehaviorSignature: 'fabricated_event_persistence'
    };
  }

  // Cluster 6: Transit Location Amnesia
  if (
    /(transit|commute|metro|travel|heading_home|going_home|rapido).*(where|destination|location|kahan)/i.test(combined) ||
    combined.includes('transit_destination_amnesia')
  ) {
    return {
      canonicalSubject: 'transit_destination_amnesia',
      normalizedEntity: 'transit_destination',
      rootBehaviorSignature: 'destination_amnesia_after_stated'
    };
  }

  // Cluster 7: Nocturnal / Circadian Quiet-Hours Breach
  if (
    /(quiet_hours|nocturnal|sleep_interruption|untimely_ping|raat.*ko.*ping|sone.*ke.*baad)/i.test(combined)
  ) {
    return {
      canonicalSubject: 'circadian_quiet_hours',
      normalizedEntity: 'circadian_quiet_hours',
      rootBehaviorSignature: 'nocturnal_proactive_intrusion'
    };
  }

  // Cluster 8: Proactive Workplace Interrogation Loop
  if (
    /(conviction_hr|selects|dialing.*lineup|interrogation_loop|excessive_question)/i.test(combined)
  ) {
    return {
      canonicalSubject: 'workplace_target_interrogation',
      normalizedEntity: 'workplace_targets',
      rootBehaviorSignature: 'repetitive_interrogation_loop'
    };
  }

  // Fallback: Normalized slugging of the provided subject and signature
  const normSubject = normalizeFingerprintSlug(canonicalSubject || 'unspecified_subject');
  const normSignature = normalizeFingerprintSlug(failureSignature || 'unspecified_failure');

  return {
    canonicalSubject: normSubject,
    normalizedEntity: normSubject,
    rootBehaviorSignature: normSignature
  };
}

/**
 * Computes a semantic canonical fingerprint based on normalized behavioral identity.
 */
export function computeSemanticFingerprint(
  userId: string | null,
  flawType: string,
  canonicalSubject: string,
  failureSignature: string,
  evidenceText: string = ''
): { fingerprint: string; cluster: NormalizedSemanticCluster } {
  const cluster = extractSemanticCluster(flawType, canonicalSubject, failureSignature, evidenceText);
  const parts = [
    (userId || 'global').trim().toLowerCase(),
    flawType.trim().toUpperCase(),
    cluster.normalizedEntity.trim().toLowerCase(),
    cluster.rootBehaviorSignature.trim().toLowerCase()
  ];
  const fingerprint = crypto.createHash('sha256').update(parts.join('::')).digest('hex');
  return { fingerprint, cluster };
}

/**
 * Standard fingerprint entry point. Uses semantic clustering while preserving historical compatibility.
 */
export function computeIncidentFingerprint(
  userId: string | null,
  flawType: string,
  canonicalSubject: string,
  failureSignature: string,
  evidenceText?: string
): string {
  return computeSemanticFingerprint(userId, flawType, canonicalSubject, failureSignature, evidenceText).fingerprint;
}

export class IncidentManager {
  // Hard safety invariant: automated external ticket creation is explicitly DISABLED
  public static readonly AUTOMATED_TASK_CREATION_ENABLED = false;

  /**
   * Ingest an evaluation finding and transition incident lifecycle.
   */
  async recordFinding(
    finding: EvaluationFinding,
    evidence: ObservableDialogueEvidence
  ): Promise<IncidentRecordResult> {
    const evidenceText = `${evidence.userMessage || ''} ${evidence.assistantResponse || ''} ${finding.reasoningSummary || ''}`;
    const { fingerprint, cluster } = computeSemanticFingerprint(
      evidence.userId,
      finding.flawType,
      finding.canonicalSubject,
      finding.failureSignature,
      evidenceText
    );

    // Compute raw legacy fingerprint as fallback for historical continuity
    const legacyRawParts = [
      (evidence.userId || 'global').trim().toLowerCase(),
      finding.flawType.trim().toUpperCase(),
      (finding.canonicalSubject || '').trim().toLowerCase(),
      (finding.failureSignature || '').trim().toLowerCase()
    ];
    const legacyFingerprint = crypto.createHash('sha256').update(legacyRawParts.join('::')).digest('hex');

    // 1. Query existing incident by canonical semantic fingerprint OR legacy fingerprint
    let existingQuery = supabaseAdmin
      .from('nova_engineering_incidents')
      .select('*');

    if (fingerprint === legacyFingerprint) {
      existingQuery = existingQuery.eq('fingerprint', fingerprint);
    } else {
      existingQuery = existingQuery.or(`fingerprint.eq.${fingerprint},fingerprint.eq.${legacyFingerprint}`);
    }

    const { data: existingRows, error: fetchErr } = await existingQuery.limit(1);

    if (fetchErr) {
      logger.error('[IncidentManager] Database error checking existing incident', { error: fetchErr.message });
      throw fetchErr;
    }

    const existing = existingRows && existingRows.length > 0 ? existingRows[0] : null;
    const now = new Date().toISOString();

    // ── CASE 1: NEW INCIDENT ───────────────────────────────────────────────────
    if (!existing) {
      const isBlocked = finding.requiredCapability === 'ROOT_CAUSE_DIAGNOSIS' &&
        finding.failureSignature.includes('capability_unavailable');

      const initialStatus: IncidentStatus = isBlocked ? 'blocked' : 'open';

      // Determine actionability state
      let initialActionability: ActionabilityStatus = 'UNVERIFIED';
      if (isBlocked) {
        initialActionability = 'BLOCKED';
      } else if (finding.isDeterministic || finding.confidence >= AdversarialVerifier.HIGH_CONFIDENCE_THRESHOLD) {
        initialActionability = 'VERIFIED';
      } else {
        // Medium confidence (0.75 - 0.89) requires secondary adversarial verification
        initialActionability = 'UNVERIFIED';
      }

      const payload: Partial<EngineeringIncidentRecord> = {
        fingerprint,
        flaw_type: finding.flawType,
        severity: finding.severity,
        status: initialStatus,
        actionability_status: initialActionability,
        confidence: finding.confidence,
        user_id: evidence.userId,
        conversation_id: evidence.conversationId,
        source_message_id: evidence.assistantMessageId,
        evidence: {
          ...evidence,
          canonicalCluster: cluster
        } as any,
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
        .select('id, status, detection_count, actionability_status')
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
        status: initialStatus,
        actionabilityStatus: inserted.actionability_status
      });

      let finalActionability: ActionabilityStatus = inserted.actionability_status || initialActionability;

      // ── SECONDARY VERIFICATION GATE ──────────────────────────────────────────
      // If finding is in the medium-confidence band (0.75–0.89), invoke adversarial verifier
      if (adversarialVerifier.requiresVerification(finding)) {
        try {
          const verifResult = await adversarialVerifier.verifyFinding(finding, evidence, inserted.id);
          finalActionability = verifResult.actionabilityStatus;
        } catch (verifErr: any) {
          logger.warn('[IncidentManager] Verification gate error, incident remains UNVERIFIED', {
            incidentId: inserted.id,
            error: verifErr?.message
          });
        }
      }

      return {
        incidentId: inserted.id,
        fingerprint,
        action: isBlocked ? 'BLOCKED_CAPABILITY' : 'NEW_INCIDENT',
        status: inserted.status,
        actionabilityStatus: finalActionability,
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
          actionability_status: 'VERIFIED', // Regressions of previously verified defects are immediately verified
          detection_count: newDetectionCount,
          last_detected_at: now,
          evidence: evidence,
          resolution_note: regressionNote,
          updated_at: now
        })
        .eq('id', existing.id)
        .select('id, status, detection_count, actionability_status')
        .single();

      if (updateErr) {
        logger.error('[IncidentManager] Failed to mark regression on incident', { error: updateErr.message });
        throw updateErr;
      }

      logger.warn('[IncidentManager] ⚠️ REGRESSION DETECTED on previously resolved incident', {
        incidentId: existing.id,
        flawType: existing.flaw_type,
        fingerprint: existing.fingerprint,
        detectionCount: newDetectionCount
      });

      return {
        incidentId: updated.id,
        fingerprint: existing.fingerprint,
        action: 'REGRESSION_DETECTED',
        status: 'regression',
        actionabilityStatus: (updated.actionability_status as ActionabilityStatus) || 'VERIFIED',
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
      .select('id, status, detection_count, actionability_status')
      .single();

    if (updateErr) {
      logger.error('[IncidentManager] Failed to increment detection count', { error: updateErr.message });
      throw updateErr;
    }

    logger.debug('[IncidentManager] Duplicate defect observation recorded (fingerprint clustered)', {
      incidentId: existing.id,
      fingerprint: existing.fingerprint,
      detectionCount: newDetectionCount
    });

    return {
      incidentId: updated.id,
      fingerprint: existing.fingerprint,
      action: 'DUPLICATE_OBSERVED',
      status: updated.status,
      actionabilityStatus: (updated.actionability_status as ActionabilityStatus) || 'UNVERIFIED',
      detectionCount: updated.detection_count
    };
  }

  /**
   * Safe, internal representation of actionable engineering items.
   * Hard automation safety boundary: automated external ticket creation is explicitly DISABLED.
   */
  async getInternalEngineeringQueue(): Promise<{
    automatedExternalCreationEnabled: boolean;
    queueLength: number;
    items: EngineeringQueueItem[];
  }> {
    const { data: verifiedIncidents, error } = await supabaseAdmin
      .from('nova_engineering_incidents')
      .select('*')
      .eq('actionability_status', 'VERIFIED')
      .in('status', ['open', 'regression'])
      .order('last_detected_at', { ascending: false });

    if (error || !verifiedIncidents) {
      logger.error('[IncidentManager] Failed to fetch engineering queue', { error: error?.message });
      return {
        automatedExternalCreationEnabled: IncidentManager.AUTOMATED_TASK_CREATION_ENABLED,
        queueLength: 0,
        items: []
      };
    }

    // Group verified incidents by canonical fingerprint cluster
    const clusterMap = new Map<string, EngineeringQueueItem>();

    for (const inc of verifiedIncidents) {
      const fp = inc.fingerprint;
      if (!clusterMap.has(fp)) {
        clusterMap.set(fp, {
          canonicalFingerprint: fp,
          flawType: inc.flaw_type,
          canonicalSubject: (inc.evidence as any)?.canonicalCluster?.canonicalSubject || inc.flaw_type,
          severity: inc.severity,
          detectionCount: inc.detection_count || 1,
          actionabilityStatus: inc.actionability_status || 'VERIFIED',
          incidentIds: [inc.id],
          evidenceSummary: inc.recommended_action || 'Actionable engineering defect.'
        });
      } else {
        const item = clusterMap.get(fp)!;
        item.detectionCount += (inc.detection_count || 1);
        item.incidentIds.push(inc.id);
      }
    }

    const items = Array.from(clusterMap.values());

    logger.info('[IncidentManager] Internal engineering queue inspected', {
      automatedExternalCreationEnabled: IncidentManager.AUTOMATED_TASK_CREATION_ENABLED,
      actionableClusterCount: items.length
    });

    return {
      automatedExternalCreationEnabled: IncidentManager.AUTOMATED_TASK_CREATION_ENABLED,
      queueLength: items.length,
      items
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
        actionability_status: 'BLOCKED',
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
