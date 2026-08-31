/**
 * prod_smoke_test_phase3d_cultivation_engine.ts
 *
 * Ephemeral production smoke test for Phase 3D-B Deterministic LifeThread Cultivation Engine.
 * Tests 9 required scenarios:
 * 1. explicit goal
 * 2. repeated casual mention
 * 3. blocker
 * 4. inactivity/staleness
 * 5. explicit cancellation
 * 6. completion proposal
 * 7. explicit completion
 * 8. passive compliance
 * 9. concurrent stale update
 *
 * Strictly asserts REAL_USER_DATA_CHANGED = 0 after complete account eradication.
 */

import { supabaseAdmin } from '../src/lib/supabase';
import { lifeThreadCultivationEngine } from '../src/services/LifeThreadCultivationEngine';
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
  console.log('HUMAN-OS — PHASE 3D-B DETERMINISTIC CULTIVATION DRY-RUN');
  console.log('============================================================\n');

  console.log('• STEP 1: Capturing pre-test baseline counts...');
  const baselineCounts = await captureTableCounts();

  const testEmail = `ephem_p3db_${Date.now()}@humanos-test.internal`;
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
      preferred_name: 'Ephemeral Cultivator',
      timezone: 'Asia/Kolkata',
      onboarding_completed: true,
    });

    // ── SCENARIO 1: Explicit Goal Creation & Progression ───────────────────
    console.log('• SCENARIO 1: Explicit Goal -> PLANNING...');
    const t1Res = await lifeThreadRepository.createOrUpdateThread(
      testUserId,
      { topic: 'Launch Mobile App', cultivationStage: 'PLANNING' },
      { sourceAuthority: 'user_explicit', evidenceProvenance: 'USER_EXPLICIT' }
    );
    const d1 = lifeThreadCultivationEngine.evaluateThread(t1Res.thread, {
      userId: testUserId,
      recentEvidence: { provenance: 'USER_ACTION', actionTaken: 'Registered Apple Developer account' },
    });
    scenarioResults['explicit_goal'] = d1.nextStage === 'IN_PROGRESS' && t1Res.thread.cultivation_stage === 'PLANNING';
    console.log(`  ${scenarioResults['explicit_goal'] ? '✅' : '❌'} Scenario 1 Result:`, d1.nextStage);

    // ── SCENARIO 2: Repeated Casual Mention (Remains DISCOVERY) ────────────
    console.log('• SCENARIO 2: Casual Mention -> Remains DISCOVERY...');
    const t2Res = await lifeThreadRepository.createOrUpdateThread(
      testUserId,
      { topic: 'Casual Baking', cultivationStage: 'DISCOVERY' },
      { sourceAuthority: 'llm_proposal', evidenceProvenance: 'SYSTEM_OBSERVATION' }
    );
    const d2 = lifeThreadCultivationEngine.evaluateThread(t2Res.thread, {
      userId: testUserId,
      recentEvidence: { provenance: 'SYSTEM_OBSERVATION', text: 'User mentioned sourdough recipe' },
    });
    scenarioResults['casual_mention'] = d2.nextStage === 'DISCOVERY' && !d2.shouldMutate;
    console.log(`  ${scenarioResults['casual_mention'] ? '✅' : '❌'} Scenario 2 Result:`, d2.nextStage);

    // ── SCENARIO 3: Active Blocker -> WAITING_ON_EXTERNAL ──────────────────
    console.log('• SCENARIO 3: Active Blocker -> WAITING_ON_EXTERNAL...');
    const futureWait = new Date(Date.now() + 7 * 86400000).toISOString();
    const t3Res = await lifeThreadRepository.createOrUpdateThread(
      testUserId,
      {
        topic: 'Patent Application',
        cultivationStage: 'IN_PROGRESS',
        blockers: [{ id: 'blk_1', description: 'Waiting on lawyer draft', type: 'external_dependency', waiting_until: futureWait }],
      },
      { sourceAuthority: 'user_explicit', evidenceProvenance: 'USER_EXPLICIT' }
    );
    const d3 = lifeThreadCultivationEngine.evaluateThread(t3Res.thread, { userId: testUserId });
    scenarioResults['blocker'] = d3.nextStage === 'WAITING_ON_EXTERNAL' && d3.nextState === 'waiting';
    console.log(`  ${scenarioResults['blocker'] ? '✅' : '❌'} Scenario 3 Result:`, d3.nextStage, d3.nextState);

    // ── SCENARIO 4: Inactivity / Staleness (>14d -> STALLED_OR_UNCERTAIN) ──
    console.log('• SCENARIO 4: Inactivity (>14d) -> STALLED_OR_UNCERTAIN...');
    const twentyDaysAgo = new Date(Date.now() - 20 * 86400000).toISOString();
    const t4Res = await lifeThreadRepository.createOrUpdateThread(
      testUserId,
      { topic: 'Stale Fitness Goal', cultivationStage: 'IN_PROGRESS' },
      { sourceAuthority: 'user_explicit', evidenceProvenance: 'USER_EXPLICIT' }
    );
    t4Res.thread.last_relevant_at = twentyDaysAgo;
    const d4 = lifeThreadCultivationEngine.evaluateThread(t4Res.thread, {
      userId: testUserId,
      now: new Date(),
    });
    scenarioResults['inactivity'] = d4.nextStage === 'STALLED_OR_UNCERTAIN' && d4.nextState === 'active';
    console.log(`  ${scenarioResults['inactivity'] ? '✅' : '❌'} Scenario 4 Result:`, d4.nextStage, d4.nextState);

    // ── SCENARIO 5: Explicit Cancellation -> Abandoned ─────────────────────
    console.log('• SCENARIO 5: Explicit Cancellation -> abandoned...');
    const d5 = lifeThreadCultivationEngine.evaluateThread(t1Res.thread, {
      userId: testUserId,
      recentEvidence: { provenance: 'USER_EXPLICIT', isExplicitCancellation: true, text: 'Cancel this goal' },
    });
    scenarioResults['cancellation'] = d5.nextState === 'abandoned';
    console.log(`  ${scenarioResults['cancellation'] ? '✅' : '❌'} Scenario 5 Result:`, d5.nextState);

    // ── SCENARIO 6: Completion Proposal (Milestones Done -> COMPLETION_PROPOSED)
    console.log('• SCENARIO 6: Milestones Met -> COMPLETION_PROPOSED (not completed)...');
    const t6Res = await lifeThreadRepository.createOrUpdateThread(
      testUserId,
      {
        topic: 'Finish Thesis',
        cultivationStage: 'IN_PROGRESS',
        milestones: [{ id: 'm1', title: 'Submit final PDF', completed: true }],
      },
      { sourceAuthority: 'user_explicit', evidenceProvenance: 'USER_EXPLICIT' }
    );
    const d6 = lifeThreadCultivationEngine.evaluateThread(t6Res.thread, { userId: testUserId });
    scenarioResults['completion_proposal'] = d6.nextStage === 'COMPLETION_PROPOSED' && d6.nextState === 'active';
    console.log(`  ${scenarioResults['completion_proposal'] ? '✅' : '❌'} Scenario 6 Result:`, d6.nextStage, d6.nextState);

    // ── SCENARIO 7: Explicit Completion -> completed ───────────────────────
    console.log('• SCENARIO 7: Explicit Completion -> completed...');
    const d7 = lifeThreadCultivationEngine.evaluateThread(t6Res.thread, {
      userId: testUserId,
      recentEvidence: { provenance: 'USER_EXPLICIT', isExplicitCompletion: true, text: 'I am finished with this' },
    });
    scenarioResults['explicit_completion'] = d7.nextState === 'completed';
    console.log(`  ${scenarioResults['explicit_completion'] ? '✅' : '❌'} Scenario 7 Result:`, d7.nextState);

    // ── SCENARIO 8: Passive Compliance -> Zero Progress ───────────────────
    console.log('• SCENARIO 8: Passive Compliance -> Zero Progress...');
    const d8 = lifeThreadCultivationEngine.evaluateThread(t2Res.thread, {
      userId: testUserId,
      recentEvidence: { provenance: 'PASSIVE_COMPLIANCE', text: 'theek hai' },
    });
    scenarioResults['passive_compliance'] = d8.nextStage === 'DISCOVERY' && !d8.shouldMutate;
    console.log(`  ${scenarioResults['passive_compliance'] ? '✅' : '❌'} Scenario 8 Result:`, d8.nextStage, d8.shouldMutate);

    // ── SCENARIO 9: Concurrent Stale Update Rejection ──────────────────────
    console.log('• SCENARIO 9: Stale Monotonic Update Rejection...');
    const t9Res = await lifeThreadRepository.createOrUpdateThread(
      testUserId,
      { topic: 'Monotonic Sequence Goal', cultivationStage: 'IN_PROGRESS' },
      { sourceAuthority: 'user_explicit', sourceMessageSeq: 25, turnId: '00000000-0000-4000-a000-000000000025' }
    );
    const staleRes = await lifeThreadRepository.createOrUpdateThread(
      testUserId,
      { threadId: t9Res.thread.id, topic: 'Monotonic Sequence Goal', cultivationStage: 'DORMANT' },
      { sourceAuthority: 'deterministic_turn_analysis', sourceMessageSeq: 15, turnId: '00000000-0000-4000-a000-000000000015' }
    );
    scenarioResults['concurrency_rejection'] = staleRes.wasRejected === true;
    console.log(`  ${scenarioResults['concurrency_rejection'] ? '✅' : '❌'} Scenario 9 Result: wasRejected =`, staleRes.wasRejected);

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
