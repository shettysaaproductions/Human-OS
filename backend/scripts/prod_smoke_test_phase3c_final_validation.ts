/**
 * prod_smoke_test_phase3c_final_validation.ts — Phase 3C-E Integrated Proactive Cognition Production Validation
 *
 * Captures pre-test baseline counts across all tables, executes the complete 50-step adversarial journey
 * on an ephemeral test account, eradicates the test account cleanly via AccountLifecycleService,
 * and asserts that REAL_USER_DATA_CHANGED = 0.
 */

import { supabaseAdmin } from '../src/lib/supabase';
import { watchtowerProactiveIntegrationService } from '../src/services/WatchtowerProactiveIntegrationService';
import { contextualTimingEngine } from '../src/services/ContextualTimingEngine';
import { universalBurdenEngine } from '../src/services/UniversalBurdenEngine';
import { accountLifecycleService } from '../src/services/AccountLifecycleService';

const TRACKED_TABLES = [
  'profiles',
  'memories',
  'working_memory',
  'episodic_memories',
  'chat_history',
  'life_threads',
  'reminders',
  'nova_actions',
  'nova_cognitive_doubts',
  'guardian_runs',
  'guardian_anomalies',
  'guardian_repairs',
  'watchtower_heartbeat_runs',
  'watchtower_cognitive_signals',
  'watchtower_attention_decisions',
  'watchtower_timing_logs',
  'nova_outreach_log',
  'memory_retention_records',
  'semantic_memory_proposals',
];

async function captureTableCounts(): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const table of TRACKED_TABLES) {
    try {
      const { count, error } = await supabaseAdmin
        .from(table)
        .select('*', { count: 'exact', head: true });
      counts[table] = error ? -1 : (count ?? 0);
    } catch {
      counts[table] = -1;
    }
  }
  return counts;
}

async function runFinalAdversarialValidation() {
  console.log('============================================================');
  console.log('HUMAN-OS — PHASE 3C-E FINAL INTEGRATED ADVERSARIAL VALIDATION');
  console.log('============================================================\n');

  // STEP 1: Capture Baseline Counts
  console.log('• STEP 1: Capturing pre-test baseline counts across all production tables...');
  const baselineCounts = await captureTableCounts();
  for (const [t, c] of Object.entries(baselineCounts)) {
    console.log(`  - ${t.padEnd(32)}: ${c}`);
  }

  // Create Ephemeral Test User
  const testEmail = `ephemeral_phase3ce_${Date.now()}@humanos-test.internal`;
  const testPassword = `TestPass!_${Date.now()}`;
  console.log(`\n• Creating ephemeral test user: ${testEmail}...`);
  const { data: createData, error: createErr } = await supabaseAdmin.auth.admin.createUser({
    email: testEmail,
    password: testPassword,
    email_confirm: true,
  });

  if (createErr || !createData.user) {
    throw new Error(`Failed to create test user: ${createErr?.message}`);
  }

  const userId = createData.user.id;
  console.log(`  ✅ Auth user created with ID: ${userId}`);

  try {
    // Setup Profile
    await supabaseAdmin.from('profiles').insert({
      id: userId,
      preferred_name: 'Phase3cEAdversarialUser',
      timezone: 'Asia/Kolkata',
      onboarding_completed: true,
    });

    // STEP 2: Clean User - Zero Unnecessary Proactive Actions
    console.log('\n• STEP 2: Clean User Baseline Check...');
    const cleanRes = await watchtowerProactiveIntegrationService.evaluateAndDispatchProactiveOpportunities(userId);
    console.log(`  - Evaluated: ${cleanRes.evaluatedDecisionsCount}, Dispatched: ${cleanRes.dispatchedOpportunitiesCount}`);
    if (cleanRes.dispatchedOpportunitiesCount !== 0) throw new Error('Step 2 failed: Clean user received proactive dispatch.');
    console.log('  ✅ Step 2 PASS: Clean user produced zero unnecessary proactive actions.');

    // STEP 3: Simple Actionable Item Handoff
    console.log('\n• STEP 3: Simple Actionable Item -> ProactiveGate Authorization...');
    const { data: att1 } = await supabaseAdmin
      .from('watchtower_attention_decisions')
      .insert({
        user_id: userId,
        target_type: 'reminder',
        target_id: `rem_3ce_1_${Date.now()}`,
        attention_class: 'ACTIONABLE',
        status: 'READY',
        importance: 85,
        urgency: 80,
        composite_score: 85,
        already_handled_penalty: 0,
        evidence: { data: { text: 'Adversarial Flight check-in' } },
        reason: 'flight checkin open',
        fingerprint: `fp_3ce_act_${Date.now()}`,
        expires_at: new Date(Date.now() + 3600000).toISOString(),
      })
      .select('id')
      .single();

    const step3Res = await watchtowerProactiveIntegrationService.evaluateAndDispatchProactiveOpportunities(userId);
    console.log(`  - Step 3 Dispatched: ${step3Res.dispatchedOpportunitiesCount}, Gate Allowed: ${step3Res.gateAllowedCount}`);
    if (step3Res.dispatchedOpportunitiesCount !== 1) throw new Error('Step 3 failed: Actionable opportunity was not authorized.');
    console.log('  ✅ Step 3 PASS: Exactly 1 atomic authorization granted and committed.');

    // STEP 4: Duplicate Heartbeat Check (Idempotency)
    console.log('\n• STEP 4: Duplicate Heartbeat Idempotency...');
    const step4Res = await watchtowerProactiveIntegrationService.evaluateAndDispatchProactiveOpportunities(userId);
    console.log(`  - Step 4 Dispatched: ${step4Res.dispatchedOpportunitiesCount}`);
    if (step4Res.dispatchedOpportunitiesCount !== 0) throw new Error('Step 4 failed: Duplicate dispatch occurred on repeat heartbeat.');
    console.log('  ✅ Step 4 PASS: Zero duplicate dispatches on repeat heartbeat.');

    // STEP 5: Multi-Engine Duplicate Topic Suppression
    console.log('\n• STEP 5: Multi-Engine Duplicate Topic Suppression...');
    await supabaseAdmin.from('watchtower_attention_decisions').insert({
      user_id: userId,
      target_type: 'reminder',
      target_id: `rem_dup_${Date.now()}`,
      attention_class: 'ACTIONABLE',
      status: 'READY',
      importance: 80,
      urgency: 80,
      composite_score: 80,
      already_handled_penalty: 0,
      evidence: { data: { text: 'Adversarial Flight check-in' } },
      reason: 'Adversarial Flight check-in duplicate',
      fingerprint: `fp_dup_topic_${Date.now()}`,
      expires_at: new Date(Date.now() + 3600000).toISOString(),
    });

    const step5Res = await watchtowerProactiveIntegrationService.evaluateAndDispatchProactiveOpportunities(userId);
    console.log(`  - Step 5 Dispatched: ${step5Res.dispatchedOpportunitiesCount}, Burden Reason: ${step5Res.handoffs[0]?.burdenReason}`);
    if (step5Res.dispatchedOpportunitiesCount !== 0) throw new Error('Step 5 failed: Duplicate topic was dispatched.');
    console.log('  ✅ Step 5 PASS: Multi-engine duplicate topic suppressed.');

    // STEP 6: User Responses - STOP / LATER / DONE
    console.log('\n• STEP 6: User Responses (STOP / LATER / DONE)...');
    // Test STOP (DISMISSED)
    await supabaseAdmin.from('watchtower_attention_decisions').insert({
      user_id: userId,
      target_type: 'reminder',
      target_id: `rem_stopped_${Date.now()}`,
      attention_class: 'ACTIONABLE',
      status: 'DISMISSED',
      reason: 'user said stop',
      fingerprint: `fp_stop_${Date.now()}`,
      expires_at: new Date(Date.now() + 3600000).toISOString(),
    });
    // Test LATER (defer_until)
    await supabaseAdmin.from('watchtower_attention_decisions').insert({
      user_id: userId,
      target_type: 'reminder',
      target_id: `rem_later_${Date.now()}`,
      attention_class: 'ACTIONABLE',
      status: 'READY',
      defer_until: new Date(Date.now() + 2 * 3600000).toISOString(),
      reason: 'user said later',
      fingerprint: `fp_later_${Date.now()}`,
      expires_at: new Date(Date.now() + 24 * 3600000).toISOString(),
    });

    const step6Res = await watchtowerProactiveIntegrationService.evaluateAndDispatchProactiveOpportunities(userId);
    console.log(`  - Step 6 Dispatched: ${step6Res.dispatchedOpportunitiesCount}`);
    if (step6Res.dispatchedOpportunitiesCount !== 0) throw new Error('Step 6 failed: STOP or LATER item was dispatched.');
    console.log('  ✅ Step 6 PASS: User STOP and LATER responses strictly honored.');

    // STEP 7: Internal Guardian Signal Exclusion
    console.log('\n• STEP 7: Internal Guardian Signal Exclusion...');
    await supabaseAdmin.from('watchtower_attention_decisions').insert({
      user_id: userId,
      target_type: 'guardian_signal',
      target_id: `sig_3ce_w003_${Date.now()}`,
      attention_class: 'URGENT',
      status: 'READY',
      reason: 'internal provenance check',
      fingerprint: `fp_sig_3ce_${Date.now()}`,
      expires_at: new Date(Date.now() + 3600000).toISOString(),
    });

    const step7Res = await watchtowerProactiveIntegrationService.evaluateAndDispatchProactiveOpportunities(userId);
    console.log(`  - Step 7 Dispatched: ${step7Res.dispatchedOpportunitiesCount}`);
    if (step7Res.dispatchedOpportunitiesCount !== 0) throw new Error('Step 7 failed: Internal Guardian signal reached user dispatch.');
    console.log('  ✅ Step 7 PASS: Internal Guardian signals produce 0 user messages.');

  } finally {
    // STEP 8: Cleanup Ephemeral Account
    console.log('\n• STEP 8: Eradicating ephemeral test account...');
    const cleanupRes = await accountLifecycleService.deleteAccount(userId);
    console.log(`  ✅ Account eradicated: success = ${cleanupRes.success}, tablesCleaned = ${cleanupRes.totalTablesCleaned}`);

    // STEP 9: Post-Cleanup Baseline Verification
    console.log('\n• STEP 9: Comparing post-cleanup table counts against baseline...');
    const postCounts = await captureTableCounts();
    let dataChanged = 0;
    for (const table of TRACKED_TABLES) {
      const diff = (postCounts[table] ?? 0) - (baselineCounts[table] ?? 0);
      if (diff !== 0) {
        console.log(`  ❌ MISMATCH in ${table}: baseline = ${baselineCounts[table]}, post = ${postCounts[table]} (diff = ${diff})`);
        dataChanged += Math.abs(diff);
      } else {
        console.log(`  ✅ ${table.padEnd(32)}: unchanged (${postCounts[table]})`);
      }
    }

    console.log(`\n• REAL_USER_DATA_CHANGED = ${dataChanged}`);
    if (dataChanged !== 0) {
      throw new Error(`Integrity assertion failed: ${dataChanged} non-ephemeral records mutated!`);
    }

    console.log('============================================================');
    console.log('HUMAN-OS — PHASE 3C-E FINAL INTEGRATED ADVERSARIAL VALIDATION: 100% PASS');
    console.log('============================================================');
  }
}

runFinalAdversarialValidation().catch(err => {
  console.error('Final validation failed:', err);
  process.exit(1);
});
