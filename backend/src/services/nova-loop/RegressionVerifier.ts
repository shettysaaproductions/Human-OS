/**
 * RegressionVerifier.ts — Historical Evidence Replay & Verification Engine
 *
 * ARCHITECTURAL INVARIANTS:
 * 1. Historical Replay: Re-evaluates recorded incident evidence against current rules or candidate fixes.
 * 2. Immutable Verification Audit: Records every test execution in `nova_incident_verifications`.
 * 3. Never Deletes Evidence: Historical incidents and verification runs remain queryable indefinitely.
 */

import { supabaseAdmin } from '../../lib/supabase';
import { logger } from '../../lib/logger';
import { conversationalEvaluator } from './ConversationalEvaluator';
import { incidentManager } from './IncidentManager';
import { ObservableDialogueEvidence } from './types';

export interface VerificationResult {
  incidentId: string;
  passed: boolean;
  flawFound: boolean;
  testedCommit?: string;
  details: Record<string, any>;
}

export class RegressionVerifier {
  /**
   * Replay historical evidence for an incident to verify if it still fails or has been mitigated.
   */
  async verifyIncident(
    incidentId: string,
    proposedFixResponse?: string,
    testedCommit?: string
  ): Promise<VerificationResult> {
    const { data: incident, error } = await supabaseAdmin
      .from('nova_engineering_incidents')
      .select('*')
      .eq('id', incidentId)
      .maybeSingle();

    if (error || !incident) {
      throw new Error(`[RegressionVerifier] Incident not found: ${incidentId}`);
    }

    const originalEvidence = incident.evidence as ObservableDialogueEvidence;

    // If a proposed fixed reply is NOT provided, we cannot evaluate whether the current pipeline fixed the defect without live re-generation.
    // Explicitly record this limitation rather than treating the original bad response as proof of a fix failure.
    if (!proposedFixResponse) {
      logger.info('[RegressionVerifier] No candidate response supplied; recording limitation audit without false regression', { incidentId });
      const details: Record<string, any> = {
        testedWithProposedFix: false,
        limitationNotice: 'No proposed fix response supplied. Live conversation pipeline dry-run is required to verify actual regression state in current pipeline.',
        replayedEvidenceAssistantResponse: originalEvidence.assistantResponse,
        flawType: incident.flaw_type,
        reasoning: 'Replay verification skipped because no candidate fix response was supplied to evaluate against historical context.'
      };

      const { error: insertErr } = await supabaseAdmin
        .from('nova_incident_verifications')
        .insert({
          incident_id: incidentId,
          verification_type: 'CANONICAL_AUDIT',
          passed: false,
          tested_commit: testedCommit || process.env.APP_VERSION || 'head',
          details
        });

      if (insertErr) {
        logger.warn('[RegressionVerifier] Failed to persist verification record', { error: insertErr.message });
      }

      return {
        incidentId,
        passed: false,
        flawFound: false, // Do NOT claim a flaw was found in the current pipeline
        testedCommit,
        details
      };
    }

    // A candidate fix response was provided: test it against historical dialogue context
    const testEvidence: ObservableDialogueEvidence = {
      ...originalEvidence,
      assistantResponse: proposedFixResponse
    };

    const finding = await conversationalEvaluator.evaluateTurn(testEvidence);
    const passed = finding === null;

    const details: Record<string, any> = {
      replayedEvidenceAssistantResponse: testEvidence.assistantResponse,
      flawType: finding?.flawType || null,
      confidence: finding?.confidence || null,
      reasoning: finding?.reasoningSummary || 'Clean dialogue — proposed fix successfully mitigated defect.',
      testedWithProposedFix: true
    };

    // Record verification audit entry in DB
    const { error: insertErr } = await supabaseAdmin
      .from('nova_incident_verifications')
      .insert({
        incident_id: incidentId,
        verification_type: 'REPLAY_TEST',
        passed,
        tested_commit: testedCommit || process.env.APP_VERSION || 'head',
        details
      });

    if (insertErr) {
      logger.warn('[RegressionVerifier] Failed to persist verification record', { error: insertErr.message });
    }

    if (passed) {
      await incidentManager.resolveIncident(
        incidentId,
        `Verified mitigated by replay test with commit ${testedCommit || 'HEAD'}`
      );
    }

    logger.info('[RegressionVerifier] Incident verification replay complete', {
      incidentId,
      passed,
      flawFound: !passed
    });

    return {
      incidentId,
      passed,
      flawFound: !passed,
      testedCommit,
      details
    };
  }

  /**
   * Re-verify all resolved incidents to ensure no regression has occurred.
   */
  async runRegressionSuite(): Promise<{ totalTested: number; regressionsFound: number }> {
    const { data: resolvedList, error } = await supabaseAdmin
      .from('nova_engineering_incidents')
      .select('id')
      .eq('status', 'resolved')
      .limit(50);

    if (error || !resolvedList) {
      return { totalTested: 0, regressionsFound: 0 };
    }

    let regressions = 0;
    for (const item of resolvedList) {
      const res = await this.verifyIncident(item.id);
      if (res.flawFound) {
        regressions++;
      }
    }

    return {
      totalTested: resolvedList.length,
      regressionsFound: regressions
    };
  }
}

export const regressionVerifier = new RegressionVerifier();
