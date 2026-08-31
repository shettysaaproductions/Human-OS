/**
 * prod_smoke_test_phase3d_e2e_validation.ts
 *
 * Ephemeral production smoke test for Phase 3D-E Integrated Adversarial Validation.
 * Tests 10 comprehensive end-to-end scenarios across the entire Phase 3D pipeline:
 * 1. Explicit goal + same-topic conversation -> natural continuity
 * 2. Unrelated conversation -> 0 weaving
 * 3. Next-step proposal -> valid structured proposal
 * 4. Passive "okay" -> zero false commitment
 * 5. Explicit commitment -> valid user-authored evidence
 * 6. Later -> 24h deferral window
 * 7. Stop -> permanent thread suppression
 * 8. Dormant thread -> silent without explicit return
 * 9. Contradictory evidence -> CognitiveDoubt routing
 * 10. Sensitive context -> immediate suppression
 *
 * Strictly asserts REAL_USER_DATA_CHANGED = 0 after complete account eradication.
 */

import { supabaseAdmin } from '../src/lib/supabase';
import { lifeThreadCultivationEngine } from '../src/services/LifeThreadCultivationEngine';
import { lifeThreadSynthesisEngine } from '../src/services/LifeThreadSynthesisEngine';
import { lifeThreadConversationWeaver } from '../src/services/LifeThreadConversationWeaver';
import { lifeThreadRepository } from '../src/services/lifeThreadRepository';
import { accountLifecycleService } from '../src/services/AccountLifecycleService';

const TRACKED_TABLES = [
  'profiles',
  'life_threads',
  'nova_actions',
  'cognitive_doubts',
  'chat_history',
  'working_memory',
  'episodic_memory',
  'semantic_memory',
  'user_presence',
];

async function captureTableCounts(): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const table of TRACKED_TABLES) {
    const { count, error } = await supabaseAdmin
      .from(table)
      .select('*', { count: 'exact', head: true });
    if (error) {
      console.warn(`[DryRun] Count failed for ${table}:`, error.message);
      counts[table] = 0;
    } else {
      counts[table] = count || 0;
    }
  }
  return counts;
}

async function runProductionDryRun() {
  console.log('============================================================');
  console.log('HUMAN-OS — PHASE 3D-E INTEGRATED E2E PRODUCTION DRY-RUN');
  console.log('============================================================\n');

  console.log('• STEP 1: Capturing pre-test baseline counts...');
  const baselineCounts = await captureTableCounts();

  const testEmail = `ephem_p3de_${Date.now()}@humanos-test.internal`;
  const testPassword = `TestPass!_${Date.now()}`;

  console.log(`\n• Creating ephemeral auth user: ${testEmail}...`);
  const { data: createData, error: createErr } = await supabaseAdmin.auth.admin.createUser({
    email: testEmail,
    password: testPassword,
    email_confirm: true,
  });

  if (createErr || !createData.user) {
    throw new Error(`Failed to create ephemeral user: ${createErr?.message}`);
  }

  const testUserId = createData.user.id;
  console.log(`  ✅ Auth user created with ID: ${testUserId}`);

  let scenarioResults: Record<string, boolean> = {};

  try {
    // Setup profile
    await supabaseAdmin.from('profiles').insert({
      id: testUserId,
      preferred_name: 'Ephemeral E2E Validator',
      timezone: 'Asia/Kolkata',
      onboarding_completed: true,
    });

    // ── SCENARIO 1: Explicit Goal + Same-Topic Continuity ──────────────────
    console.log('• SCENARIO 1: Explicit Goal + Same-Topic Continuity...');
    const t1Res = await lifeThreadRepository.createOrUpdateThread(
      testUserId,
      {
        topic: 'Launch Artisan Bakery',
        cultivationStage: 'IN_PROGRESS',
        nextUsefulStep: { title: 'Order commercial oven', description: 'Review quote', duration_mins: 20, leverage_score: 85 },
      },
      { sourceAuthority: 'user_explicit', evidenceProvenance: 'USER_EXPLICIT' }
    );
    const d1 = await lifeThreadConversationWeaver.evaluateConversationalWeaving([t1Res.thread], {
      userId: testUserId,
      userTurnText: 'I am reviewing the bakery equipment list today',
    });
    scenarioResults['same_topic_continuity'] = d1.shouldWeave === true && d1.packet?.topic === 'Launch Artisan Bakery';
    console.log(`  ${scenarioResults['same_topic_continuity'] ? '✅' : '❌'} Scenario 1 Result:`, d1.packet?.naturalBridge);

    // ── SCENARIO 2: Unrelated Conversation -> 0 Weaving ───────────────────
    console.log('• SCENARIO 2: Unrelated Conversation -> 0 Weaving...');
    const d2 = await lifeThreadConversationWeaver.evaluateConversationalWeaving([t1Res.thread], {
      userId: testUserId,
      userTurnText: 'What is quantum computing?',
    });
    scenarioResults['unrelated_ignored'] = d2.shouldWeave === false;
    console.log(`  ${scenarioResults['unrelated_ignored'] ? '✅' : '❌'} Scenario 2 Result: shouldWeave =`, d2.shouldWeave);

    // ── SCENARIO 3: Next-Step Proposal Validation ─────────────────────────
    console.log('• SCENARIO 3: Next-Step Proposal Validation...');
    const validProposal = {
      progress_summary: 'Equipment list reviewed',
      blocker_summary: null,
      next_step_proposal: { title: 'Confirm oven electrical requirements', description: 'Check with building manager', duration_mins: 15, leverage_score: 80 },
      confidence: 'HIGH',
      temporal_consistency: 'CURRENT',
    };
    const p3 = lifeThreadSynthesisEngine.assembleEvidencePacket(t1Res.thread, []);
    const val3 = lifeThreadSynthesisEngine.validateSynthesisOutput(validProposal, p3);
    scenarioResults['step_proposal'] = val3.isValid === true;
    console.log(`  ${scenarioResults['step_proposal'] ? '✅' : '❌'} Scenario 3 Result: Valid =`, val3.isValid);

    // ── SCENARIO 4: Passive "okay" -> Zero False Commitment ────────────────
    console.log('• SCENARIO 4: Passive "okay" -> Zero False Commitment...');
    const c4 = lifeThreadConversationWeaver.classifyUserResponse('theek hai');
    scenarioResults['passive_zero_commitment'] = c4.type === 'PASSIVE_COMPLIANCE' && c4.hasExplicitCommitment === false;
    console.log(`  ${scenarioResults['passive_zero_commitment'] ? '✅' : '❌'} Scenario 4 Result: Type =`, c4.type, 'Commitment =', c4.hasExplicitCommitment);

    // ── SCENARIO 5: Explicit Commitment -> Valid User Evidence ─────────────
    console.log('• SCENARIO 5: Explicit Commitment -> Valid User Evidence...');
    const c5 = lifeThreadConversationWeaver.classifyUserResponse('I will check the building wiring tonight');
    scenarioResults['explicit_commitment'] = c5.type === 'ACCEPT' && c5.hasExplicitCommitment === true;
    console.log(`  ${scenarioResults['explicit_commitment'] ? '✅' : '❌'} Scenario 5 Result: Type =`, c5.type, 'Commitment =', c5.hasExplicitCommitment);

    // ── SCENARIO 6: LATER -> 24h Deferral Window ───────────────────────────
    console.log('• SCENARIO 6: LATER -> 24h Deferral Window...');
    const r6 = await lifeThreadConversationWeaver.processConversationalResponse(testUserId, t1Res.thread.id, 'baad mein karenge');
    const deferredThread = await lifeThreadRepository.getThreadById(testUserId, t1Res.thread.id);
    scenarioResults['later_deferral'] = r6.classifiedUserResponse?.type === 'LATER' && !!deferredThread?.next_relevant_time;
    console.log(`  ${scenarioResults['later_deferral'] ? '✅' : '❌'} Scenario 6 Result: next_relevant_time =`, deferredThread?.next_relevant_time);

    // ── SCENARIO 7: STOP -> Permanent Thread Suppression ───────────────────
    console.log('• SCENARIO 7: STOP -> Permanent Thread Suppression...');
    const t7Res = await lifeThreadRepository.createOrUpdateThread(
      testUserId,
      { topic: 'Pottery Workshop', cultivationStage: 'IN_PROGRESS' },
      { sourceAuthority: 'user_explicit' }
    );
    const r7 = await lifeThreadConversationWeaver.processConversationalResponse(testUserId, t7Res.thread.id, 'stop reminding me about this');
    const stoppedThread = await lifeThreadRepository.getThreadById(testUserId, t7Res.thread.id);
    scenarioResults['stop_suppression'] = r7.classifiedUserResponse?.type === 'STOP' && stoppedThread?.state === 'abandoned';
    console.log(`  ${scenarioResults['stop_suppression'] ? '✅' : '❌'} Scenario 7 Result: state =`, stoppedThread?.state);

    // ── SCENARIO 8: Dormant Thread -> Silent Without Match ─────────────────
    console.log('• SCENARIO 8: Dormant Thread -> Silent Without Match...');
    const t8Res = await lifeThreadRepository.createOrUpdateThread(
      testUserId,
      { topic: 'Learn Spanish', cultivationStage: 'DORMANT' },
      { sourceAuthority: 'user_explicit' }
    );
    const d8 = await lifeThreadConversationWeaver.evaluateConversationalWeaving([t8Res.thread], {
      userId: testUserId,
      userTurnText: 'general travel discussion',
    });
    scenarioResults['dormant_silent'] = d8.shouldWeave === false;
    console.log(`  ${scenarioResults['dormant_silent'] ? '✅' : '❌'} Scenario 8 Result: shouldWeave =`, d8.shouldWeave);

    // ── SCENARIO 9: Contradictory Evidence -> CognitiveDoubt Validation ────
    console.log('• SCENARIO 9: Contradictory Evidence -> Uncertainty & Doubt...');
    const conflictingOutput = {
      progress_summary: 'Conflicting statements',
      blocker_summary: null,
      next_step_proposal: null,
      confidence: 'UNCERTAIN',
      temporal_consistency: 'CONFLICTING',
      uncertainty_reason: 'User stated they both sold the bakery and bought new ovens',
    };
    const val9 = lifeThreadSynthesisEngine.validateSynthesisOutput(conflictingOutput, p3);
    scenarioResults['contradiction_handling'] = val9.isValid === false && val9.isContradictory === true;
    console.log(`  ${scenarioResults['contradiction_handling'] ? '✅' : '❌'} Scenario 9 Result: isContradictory =`, val9.isContradictory);

    // ── SCENARIO 10: Sensitive Context Protection ──────────────────────────
    console.log('• SCENARIO 10: Sensitive Context Protection...');
    const d10 = await lifeThreadConversationWeaver.evaluateConversationalWeaving([t1Res.thread], {
      userId: testUserId,
      userTurnText: 'I am at the hospital with my father who had an emergency',
    });
    scenarioResults['sensitive_protection'] = d10.shouldWeave === false && d10.suppressionReason?.includes('Sensitive context') === true;
    console.log(`  ${scenarioResults['sensitive_protection'] ? '✅' : '❌'} Scenario 10 Result: suppressed =`, !d10.shouldWeave);

  } finally {
    console.log('\n• CLEANUP: Eradicating ephemeral test account...');
    await accountLifecycleService.deleteAccount(testUserId);
  }

  console.log('\n• STEP 3: Comparing table counts against pre-test baseline...');
  const postCounts = await captureTableCounts();
  let realUserDataChanged = 0;
  for (const table of TRACKED_TABLES) {
    const diff = (postCounts[table] ?? 0) - (baselineCounts[table] ?? 0);
    if (diff !== 0) {
      console.log(`  ⚠️ Table ${table} delta: ${diff}`);
      realUserDataChanged += Math.abs(diff);
    } else {
      console.log(`  ✅ Table ${table.padEnd(24)}: unchanged (${postCounts[table]})`);
    }
  }

  const allPassed = Object.values(scenarioResults).every(v => v === true) && realUserDataChanged === 0;

  console.log('\n============================================================');
  console.log('DRY-RUN RESULTS');
  console.log('============================================================');
  for (const [s, pass] of Object.entries(scenarioResults)) {
    console.log(`SCENARIO [${s}]: ${pass ? 'PASS' : 'FAIL'}`);
  }
  console.log(`REAL_USER_DATA_CHANGED = ${realUserDataChanged}`);
  console.log(`STATUS = ${allPassed ? 'PASS' : 'FAIL'}`);
  console.log('============================================================');

  if (!allPassed) {
    process.exit(1);
  }
}

runProductionDryRun().catch(err => {
  console.error('Dry-run failed:', err);
  process.exit(1);
});
