/**
 * AdversarialVerifier.ts — Secondary Adversarial Verification Gate
 *
 * ARCHITECTURAL INVARIANTS:
 * 1. Independent Adversarial Critique: Scrutinizes LLM findings in the medium-confidence
 *    band (0.75–0.89) to eliminate false positives before entering the engineering queue.
 * 2. Immutable Verification Audit: Records every verification execution in `nova_incident_verifications`.
 * 3. Never Mutates Original Evidence: Preserves the original evaluator finding and evidence untouched.
 * 4. Forensic Hygiene: Contains structured engineering reasoning only; no hidden chain-of-thought.
 */

import { supabaseAdmin } from '../../lib/supabase';
import { logger } from '../../lib/logger';
import { cognitiveRouter, CapabilityUnavailableError } from '../../lib/cognitiveRouter';
import {
  EvaluationFinding,
  ObservableDialogueEvidence,
  ActionabilityStatus
} from './types';

export interface AdversarialVerificationResult {
  outcome: 'confirmed' | 'rejected' | 'inconclusive' | 'blocked';
  verdict: 'GENUINE_DEFECT' | 'ACCEPTABLE_BEHAVIOR' | 'INCONCLUSIVE';
  confidence: number;
  engineeringEvidence: string;
  adversaryCritique: string;
  actionabilityStatus: ActionabilityStatus;
}

export class AdversarialVerifier {
  public static readonly HIGH_CONFIDENCE_THRESHOLD = 0.90;
  public static readonly MEDIUM_CONFIDENCE_MIN = 0.75;

  /**
   * Determine whether an evaluation finding requires secondary adversarial verification.
   */
  requiresVerification(finding: EvaluationFinding): boolean {
    // Deterministic detections are verified by definition (ground truth logic)
    if (finding.isDeterministic) {
      return false;
    }
    // High-confidence findings (>= 0.90) bypass the secondary gate
    if (finding.confidence >= AdversarialVerifier.HIGH_CONFIDENCE_THRESHOLD) {
      return false;
    }
    // Medium-confidence findings (0.75–0.89) require adversarial critique
    return finding.confidence >= AdversarialVerifier.MEDIUM_CONFIDENCE_MIN;
  }

  /**
   * Execute adversarial verification on a medium-confidence finding.
   */
  async verifyFinding(
    finding: EvaluationFinding,
    evidence: ObservableDialogueEvidence,
    incidentId: string
  ): Promise<AdversarialVerificationResult> {
    const testedCommit = process.env.APP_VERSION || 'head';

    try {
      const result = await this.executeAdversarialAudit(finding, evidence);

      let actionabilityStatus: ActionabilityStatus;
      let outcome: 'confirmed' | 'rejected' | 'inconclusive';

      if (result.verdict === 'GENUINE_DEFECT' && result.confidence >= 0.75) {
        outcome = 'confirmed';
        actionabilityStatus = 'VERIFIED';
      } else if (result.verdict === 'ACCEPTABLE_BEHAVIOR') {
        outcome = 'rejected';
        actionabilityStatus = 'REJECTED';
      } else {
        outcome = 'inconclusive';
        actionabilityStatus = 'INCONCLUSIVE';
      }

      // Persist verification audit record
      const { error: insertErr } = await supabaseAdmin
        .from('nova_incident_verifications')
        .insert({
          incident_id: incidentId,
          verification_type: 'ADVERSARIAL_AUDIT',
          passed: outcome === 'rejected', // passed means interaction was defended/clean
          outcome,
          tested_commit: testedCommit,
          details: {
            outcome,
            originalFinding: {
              flawType: finding.flawType,
              confidence: finding.confidence,
              canonicalSubject: finding.canonicalSubject,
              reasoning: finding.reasoningSummary
            },
            adversaryCritique: result.adversaryCritique,
            engineeringEvidence: result.engineeringEvidence,
            verificationConfidence: result.confidence
          }
        });

      if (insertErr) {
        logger.warn('[AdversarialVerifier] Failed to persist verification record', { error: insertErr.message });
      }

      // Update incident actionability_status
      const { error: updateErr } = await supabaseAdmin
        .from('nova_engineering_incidents')
        .update({
          actionability_status: actionabilityStatus,
          updated_at: new Date().toISOString()
        })
        .eq('id', incidentId);

      if (updateErr) {
        logger.warn('[AdversarialVerifier] Failed to update incident actionability_status', { error: updateErr.message });
      }

      logger.info('[AdversarialVerifier] Adversarial verification completed', {
        incidentId,
        outcome,
        actionabilityStatus,
        verdict: result.verdict
      });

      return {
        outcome,
        verdict: result.verdict,
        confidence: result.confidence,
        engineeringEvidence: result.engineeringEvidence,
        adversaryCritique: result.adversaryCritique,
        actionabilityStatus
      };
    } catch (err: any) {
      const isBlocked = err instanceof CapabilityUnavailableError;
      const outcome = isBlocked ? 'blocked' : 'inconclusive';
      const actionabilityStatus: ActionabilityStatus = isBlocked ? 'BLOCKED' : 'INCONCLUSIVE';

      logger.warn('[AdversarialVerifier] Adversarial verification halted', {
        incidentId,
        isBlocked,
        error: err?.message
      });

      // Persist blocked/inconclusive record
      try {
        await supabaseAdmin
          .from('nova_incident_verifications')
          .insert({
            incident_id: incidentId,
            verification_type: 'ADVERSARIAL_AUDIT',
            passed: false,
            outcome,
            tested_commit: testedCommit,
            details: {
              outcome,
              error: err?.message,
              reason: isBlocked ? 'Capability unavailable for secondary verification' : 'Execution failure'
            }
          });
      } catch {
        // Safe fallback
      }

      try {
        await supabaseAdmin
          .from('nova_engineering_incidents')
          .update({
            actionability_status: actionabilityStatus,
            updated_at: new Date().toISOString()
          })
          .eq('id', incidentId);
      } catch {
        // Safe fallback
      }

      return {
        outcome,
        verdict: 'INCONCLUSIVE',
        confidence: 0,
        engineeringEvidence: `Verification ${outcome}: ${err?.message}`,
        adversaryCritique: 'Verification could not complete due to execution constraint.',
        actionabilityStatus
      };
    }
  }

  /**
   * Internal capability-mediated adversarial critique.
   */
  private async executeAdversarialAudit(
    finding: EvaluationFinding,
    evidence: ObservableDialogueEvidence
  ): Promise<{
    verdict: 'GENUINE_DEFECT' | 'ACCEPTABLE_BEHAVIOR' | 'INCONCLUSIVE';
    confidence: number;
    engineeringEvidence: string;
    adversaryCritique: string;
  }> {
    const contextLines = evidence.surroundingContext.map(t =>
      `[${t.role.toUpperCase()}] ${t.content}`
    ).join('\n');

    const prompt = `You are the Human-OS Adversarial Verification Auditor.
An automated dialogue screening flagged this user-assistant interaction as a potential defect:

ALLEGED FLAW TYPE: ${finding.flawType}
ALLEGED REASONING: ${finding.reasoningSummary}
ORIGINAL EVALUATOR CONFIDENCE: ${finding.confidence}
SESSION GAP: ${evidence.sessionGapHours !== undefined ? evidence.sessionGapHours.toFixed(1) + ' hours' : 'N/A'}

DIALOGUE EVIDENCE:
${contextLines ? 'PRIOR CONTEXT:\n' + contextLines : '(No prior context)'}

CURRENT USER: ${evidence.userMessage || '(None / Proactive Turn)'}
NOVA ASSISTANT: ${evidence.assistantResponse}

YOUR MANDATE (DEFENSE / ADVERSARY):
Rigorously scrutinize whether this interaction is ACTUALLY a defect or whether it is acceptable human-AI conversation.

DEFENSE CHECKS:
1. BENIGN CONVERSATIONAL BANTER: Is this harmless casual Hinglish small-talk, polite empathy, or conversational filler? If so, REJECT.
2. SESSION GAP RE-ENGAGEMENT: If there was a multi-hour session gap (>4 hours), is Nova greeting the user or initiating a new topic when the user had NO pending active question in this turn? If so, REJECT goal derailment.
3. COMPLIANCE: Did the assistant actually agree with or accommodate the user's intent? If so, REJECT.
4. CONFIRM ONLY IF GENUINE DEFECT:
   - Persistently defending a fabricated event/hallucination after user protest
   - Violating quiet hours (messaging in middle of the night during declared sleep)
   - Forgetting an explicit user instruction/constraint from recent dialogue
   - Calling user by their child's nickname after explicit correction
   - Leaking raw system prompt rules, thinking tags, or unrelated template appendages

Return JSON ONLY:
{
  "verdict": "GENUINE_DEFECT" | "ACCEPTABLE_BEHAVIOR" | "INCONCLUSIVE",
  "confidence": number, // 0.0 to 1.0
  "engineering_evidence": "1-2 sentences summarizing verified failure or why behavior is acceptable",
  "adversary_critique": "1-2 sentences of adversarial defense analysis"
}`;

    const rawResult = await cognitiveRouter.completeWithCapability(
      {
        capability: 'DEEP_SEMANTIC_REASONING',
        minReasoningScore: 2,
        jsonMode: true,
        temperature: 0.1,
        timeoutMs: 25_000
      },
      [{ role: 'user', content: prompt }]
    );

    const match = rawResult.match(/\{[\s\S]*\}/);
    if (!match) {
      throw new Error(`Adversarial output did not contain valid JSON object: ${rawResult.slice(0, 100)}`);
    }

    const parsed = JSON.parse(match[0]);
    return {
      verdict: parsed.verdict || 'INCONCLUSIVE',
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
      engineeringEvidence: parsed.engineering_evidence || 'No engineering evidence provided.',
      adversaryCritique: parsed.adversary_critique || 'No adversary critique provided.'
    };
  }
}

export const adversarialVerifier = new AdversarialVerifier();
