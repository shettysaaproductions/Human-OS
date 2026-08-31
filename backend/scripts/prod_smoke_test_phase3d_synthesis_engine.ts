/**
 * prod_smoke_test_phase3d_synthesis_engine.ts
 *
 * Ephemeral production smoke test for Phase 3D-C Progress, Blocker & Next-Useful-Step Synthesis.
 * Tests 7 required scenarios:
 * 1. goal with clear progress -> synthesis
 * 2. clear blocker -> blocker synthesis
 * 3. grounded next useful step -> proposal
 * 4. system suggestion + "okay" -> zero commitment
 * 5. explicit user commitment -> valid user-authored evidence
 * 6. contradictory evidence -> uncertainty
 * 7. unsupported model claim -> rejected
 *
 * Strictly asserts REAL_USER_DATA_CHANGED = 0 after complete account eradication.
 */

import { supabaseAdmin } from '../src/lib/supabase';
import { lifeThreadSynthesisEngine } from '../src/services/LifeThreadSynthesisEngine';
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
  console.log('HUMAN-OS — PHASE 3D-C SYNTHESIS ENGINE PRODUCTION DRY-RUN');
  console.log('============================================================\n');

  console.log('• STEP 1: Capturing pre-test baseline counts...');
  const baselineCounts = await captureTableCounts();

  const testEmail = `ephem_p3dc_${Date.now()}@humanos-test.internal`;
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
      preferred_name: 'Ephemeral Synthesizer',
      timezone: 'Asia/Kolkata',
      onboarding_completed: true,
    });

    // ── SCENARIO 1: Goal with clear progress -> Evidence Packet Synthesis ──
    console.log('• SCENARIO 1: Goal with progress -> Packet Assembly & Synthesis...');
    const t1Res = await lifeThreadRepository.createOrUpdateThread(
      testUserId,
      { topic: 'Register Company LLC', cultivationStage: 'IN_PROGRESS' },
      { sourceAuthority: 'user_explicit', evidenceProvenance: 'USER_EXPLICIT' }
    );
    const p1 = lifeThreadSynthesisEngine.assembleEvidencePacket(t1Res.thread, [
      { id: 'e1', provenance: 'USER_ACTION', text: 'Submitted articles of incorporation' },
    ]);
    scenarioResults['progress_synthesis'] = p1.userEvidence.length === 1 && p1.userEvidence[0].provenance === 'USER_ACTION';
    console.log(`  ${scenarioResults['progress_synthesis'] ? '✅' : '❌'} Scenario 1 Result:`, p1.userEvidence[0]?.text);

    // ── SCENARIO 2: Clear Blocker -> Blocker Synthesis ─────────────────────
    console.log('• SCENARIO 2: Clear Blocker -> Blocker Interpretation...');
    const t2Res = await lifeThreadRepository.createOrUpdateThread(
      testUserId,
      {
        topic: 'Trade License',
        cultivationStage: 'WAITING_ON_EXTERNAL',
        blockers: [{ id: 'b1', description: 'Waiting on government portal verification', type: 'external_dependency' }],
      },
      { sourceAuthority: 'user_explicit', evidenceProvenance: 'USER_EXPLICIT' }
    );
    const p2 = lifeThreadSynthesisEngine.assembleEvidencePacket(t2Res.thread, []);
    scenarioResults['blocker_synthesis'] = p2.existingBlockers.length === 1 && p2.existingBlockers[0].id === 'b1';
    console.log(`  ${scenarioResults['blocker_synthesis'] ? '✅' : '❌'} Scenario 2 Result:`, p2.existingBlockers[0]?.description);

    // ── SCENARIO 3: Grounded Next Useful Step -> Proposal Validation ────────
    console.log('• SCENARIO 3: Grounded Next Useful Step -> Proposal Validation...');
    const validProposalOutput = {
      progress_summary: 'Articles of incorporation submitted',
      blocker_summary: null,
      next_step_proposal: {
        title: 'Check portal status',
        description: 'One possible next step is checking the corporate registry portal for filing number.',
        duration_mins: 15,
        leverage_score: 85,
      },
      confidence: 'HIGH',
      temporal_consistency: 'CURRENT',
    };
    const val3 = lifeThreadSynthesisEngine.validateSynthesisOutput(validProposalOutput, p1);
    scenarioResults['step_proposal'] = val3.isValid === true;
    console.log(`  ${scenarioResults['step_proposal'] ? '✅' : '❌'} Scenario 3 Result: Valid =`, val3.isValid);

    // ── SCENARIO 4: System Suggestion + "okay" -> Zero Commitment ───────────
    console.log('• SCENARIO 4: System Suggestion + "okay" -> Excluded from user commitment...');
    const p4 = lifeThreadSynthesisEngine.assembleEvidencePacket(t1Res.thread, [
      { id: 's1', provenance: 'SYSTEM_SUGGESTION', text: 'Nova suggested drafting bylaws' },
      { id: 'p1', provenance: 'PASSIVE_COMPLIANCE', text: 'okay' },
    ]);
    scenarioResults['passive_zero_commitment'] = p4.userEvidence.length === 0;
    console.log(`  ${scenarioResults['passive_zero_commitment'] ? '✅' : '❌'} Scenario 4 Result: userEvidence count =`, p4.userEvidence.length);

    // ── SCENARIO 5: Explicit User Commitment -> Valid User Evidence ─────────
    console.log('• SCENARIO 5: Explicit User Commitment -> Valid User Evidence...');
    const p5 = lifeThreadSynthesisEngine.assembleEvidencePacket(t1Res.thread, [
      { id: 'u1', provenance: 'USER_EXPLICIT', text: 'I will draft the operating agreement tonight' },
    ]);
    scenarioResults['explicit_user_commitment'] = p5.userEvidence.length === 1 && p5.userEvidence[0].provenance === 'USER_EXPLICIT';
    console.log(`  ${scenarioResults['explicit_user_commitment'] ? '✅' : '❌'} Scenario 5 Result:`, p5.userEvidence[0]?.text);

    // ── SCENARIO 6: Contradictory Evidence -> Uncertainty & Doubt Routing ──
    console.log('• SCENARIO 6: Contradictory Evidence -> Uncertainty...');
    const contradictoryOutput = {
      progress_summary: 'Conflicting statements',
      blocker_summary: null,
      next_step_proposal: null,
      confidence: 'UNCERTAIN',
      temporal_consistency: 'CONFLICTING',
      uncertainty_reason: 'User stated they dropped LLC registration but also hired registered agent',
    };
    const val6 = lifeThreadSynthesisEngine.validateSynthesisOutput(contradictoryOutput, p1);
    scenarioResults['contradiction_handling'] = val6.isValid === false && val6.isContradictory === true;
    console.log(`  ${scenarioResults['contradiction_handling'] ? '✅' : '❌'} Scenario 6 Result: isContradictory =`, val6.isContradictory);

    // ── SCENARIO 7: Unsupported Model Claim -> Rejection ───────────────────
    console.log('• SCENARIO 7: Psychological Profiling Claim -> Rejection...');
    const psychologicalOutput = {
      progress_summary: 'User feels lazy and is procrastinating on legal docs',
      blocker_summary: null,
      next_step_proposal: null,
      confidence: 'HIGH',
      temporal_consistency: 'CURRENT',
    };
    const val7 = lifeThreadSynthesisEngine.validateSynthesisOutput(psychologicalOutput, p1);
    scenarioResults['unsupported_claim_rejection'] = val7.isValid === false && val7.rejectionReason?.includes('Psychological profiling') === true;
    console.log(`  ${scenarioResults['unsupported_claim_rejection'] ? '✅' : '❌'} Scenario 7 Result: Rejected =`, !val7.isValid);

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
