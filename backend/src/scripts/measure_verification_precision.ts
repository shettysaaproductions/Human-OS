/**
 * measure_verification_precision.ts — Offline Precision Measurement & Manual Audit Tool
 *
 * Mandate:
 * 1. Compute empirical distribution across verification outcomes.
 * 2. Never assume model self-verdict is 95% precision ground truth without human audit.
 * 3. Provide sample records with human audit checklists for release gating.
 */

import { adversarialVerifier } from '../services/nova-loop/AdversarialVerifier';
import { incidentManager } from '../services/nova-loop/IncidentManager';
import { logger } from '../lib/logger';

async function main() {
  console.log('================================================================');
  console.log('   NOVA LOOP ADVERSARIAL VERIFICATION PRECISION AUDITOR        ');
  console.log('================================================================\n');

  // 1. Verification Outcome Metrics
  const metrics = await adversarialVerifier.getVerificationMetrics();

  console.log('--- 1. EMPIRICAL VERIFICATION OUTCOME DISTRIBUTION ---');
  console.log(`Total Verifications Recorded: ${metrics.totalVerifications}`);
  console.log(`  - Confirmed Defect:   ${metrics.confirmedCount} (${(metrics.confirmedRatio * 100).toFixed(1)}%)`);
  console.log(`  - Rejected (Clean):   ${metrics.rejectedCount} (${(metrics.rejectedRatio * 100).toFixed(1)}%)`);
  console.log(`  - Inconclusive:       ${metrics.inconclusiveCount} (${(metrics.inconclusiveRatio * 100).toFixed(1)}%)`);
  console.log(`  - Blocked Capability: ${metrics.blockedCount} (${(metrics.blockedRatio * 100).toFixed(1)}%)`);
  console.log('');

  // 2. Engineering Queue Status
  const queue = await incidentManager.getInternalEngineeringQueue();
  console.log('--- 2. INTERNAL ENGINEERING QUEUE ---');
  console.log(`Automated External Ticket Creation: ${queue.automatedExternalCreationEnabled ? 'ENABLED' : 'DISABLED (Protected)'}`);
  console.log(`Actionable Verified Clusters:       ${queue.queueLength}`);
  for (const item of queue.items) {
    console.log(`  - [${item.severity.toUpperCase()}] ${item.flawType} (${item.canonicalSubject}): ${item.detectionCount} occurrence(s)`);
  }
  console.log('');

  // 3. Precision Release Gate Assessment
  console.log('--- 3. 95% PRECISION RELEASE GATE ASSESSMENT ---');
  if (metrics.totalVerifications === 0) {
    console.log('Status: INSUFFICIENT_DATA');
    console.log('Reason: 0 production verifications observed in ledger.');
    console.log('Guidance: Verifier has not yet processed live medium-confidence production traffic.');
  } else {
    console.log(`Model Confirmation Ratio: ${(metrics.confirmedRatio * 100).toFixed(1)}%`);
    console.log('Ground Truth Rule: Model confirmation is NOT accepted as proof of 95% precision.');
    console.log('Human audit is required to confirm whether "confirmed" findings represent genuine defects.');
  }
  console.log('');

  // 4. Sample for Manual Engineering Review
  const samples = await adversarialVerifier.sampleForManualReview(5, 'confirmed');
  console.log(`--- 4. MANUAL REVIEW AUDIT SAMPLES (Count: ${samples.length}) ---`);
  if (samples.length === 0) {
    console.log('(No confirmed verifications available for sample review)');
  } else {
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i];
      console.log(`[Sample ${i + 1}] Verification ID: ${s.verificationId}`);
      console.log(`  Incident ID: ${s.incidentId}`);
      console.log(`  Flaw Type:   ${s.flawType}`);
      console.log(`  Evaluator:   confidence=${s.evaluatorConfidence}, reasoning="${s.evaluatorReasoning}"`);
      console.log(`  Adversary:   "${s.adversaryCritique}"`);
      console.log(`  Evidence:    "${s.engineeringEvidence}"`);
      console.log(`  User:        "${s.dialogueSnippet.userMessage}"`);
      console.log(`  Assistant:   "${s.dialogueSnippet.assistantResponse.slice(0, 100)}..."`);
      console.log(`  Audit Checklist:`);
      console.log(`    [ ] Genuine defect confirmed`);
      console.log(`    [ ] Harmless banter / acceptable`);
      console.log(`    [ ] Expired session boundary`);
      console.log(`  Human Verdict: [PENDING REVIEW]\n`);
    }
  }

  console.log('================================================================\n');
}

main().catch(err => {
  logger.error('[measure_verification_precision] Fatal error', { error: err?.message });
  process.exit(1);
});
