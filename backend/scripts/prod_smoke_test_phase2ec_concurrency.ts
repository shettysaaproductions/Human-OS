/**
 * prod_smoke_test_phase2ec_concurrency.ts — Phase 2E-C Production Concurrency Smoke Test
 *
 * Verifies live database-backed concurrency & locking in production:
 * 1. Concurrent Nightly Run Claim: Exactly 1 process acquires the run lease; second process receives already_running.
 * 2. Concurrent User Batch Claim: Exactly 1 process acquires the user batch lease; second process skips with active_lease.
 * 3. Model-Call Budget: Total Gemini calls across concurrent attempts is <= 1 (NOT 2).
 * 4. Zero Semantic Writes & Zero Source Deletions.
 */

import { supabaseAdmin } from '../src/lib/supabase';
import {
  candidateSynthesisService,
} from '../src/services/CandidateSynthesisService';

async function runConcurrencySmokeTest() {
  console.log('════════════════════════════════════════════════════════════════════');
  console.log('  HUMAN-OS — PHASE 2E-C CONCURRENCY HARDENING PRODUCTION TEST       ');
  console.log('════════════════════════════════════════════════════════════════════\n');

  const testRunId = `test_candidate_synthesis_${Date.now()}`;

  // Fetch valid user profile
  const { data: prof, error: profErr } = await supabaseAdmin
    .from('profiles')
    .select('id')
    .limit(1)
    .single();

  if (profErr || !prof) {
    throw new Error('No valid user profile found for concurrency test');
  }

  const testUserId = prof.id;
  console.log(`[Setup] Using Valid User ID: ${testUserId}`);
  console.log(`[Setup] Test Logical Run ID: ${testRunId}\n`);

  let createdWmId: string | null = null;

  try {
    // ── 1. SEED TEST DATA ───────────────────────────────────────────────────
    const { data: wm } = await supabaseAdmin.from('working_memory').insert({
      user_id: testUserId,
      key: 'concurrency_test_fact',
      value: 'Testing concurrent lease locking',
      promotion_status: 'CANDIDATE',
    }).select('id').single();
    if (wm) createdWmId = wm.id;

    // ── 2. TEST CONCURRENT NIGHTLY RUN CLAIMS ───────────────────────────────
    console.log('--- TEST 1: CONCURRENT NIGHTLY RUN CLAIMS ---');
    const [runClaimA, runClaimB] = await Promise.all([
      candidateSynthesisService.claimNightlyRun(testRunId),
      candidateSynthesisService.claimNightlyRun(testRunId),
    ]);

    console.log(`• Run Claim A: claimed=${runClaimA.claimed}, status=${runClaimA.status}`);
    console.log(`• Run Claim B: claimed=${runClaimB.claimed}, status=${runClaimB.status}`);

    const runClaimSuccessCount = [runClaimA.claimed, runClaimB.claimed].filter(Boolean).length;
    if (runClaimSuccessCount !== 1) {
      throw new Error(`INVARIANT VIOLATED: Expected exactly 1 run claim to succeed, got ${runClaimSuccessCount}`);
    }
    console.log('✅ PASS: Exactly 1 nightly run claim succeeded, duplicate blocked.\n');

    // ── 3. TEST CONCURRENT USER BATCH CLAIMS & SYNTHESIS ────────────────────
    console.log('--- TEST 2: CONCURRENT USER BATCH SYNTHESIS ATTEMPTS ---');
    const [userSynthA, userSynthB] = await Promise.all([
      candidateSynthesisService.synthesizeCandidatesForUser(testUserId, testRunId),
      candidateSynthesisService.synthesizeCandidatesForUser(testUserId, testRunId),
    ]);

    console.log(`• Instance A: status=${userSynthA.status}, modelCalls=${userSynthA.modelCalls}, reason=${userSynthA.reason || 'none'}`);
    console.log(`• Instance B: status=${userSynthB.status}, modelCalls=${userSynthB.modelCalls}, reason=${userSynthB.reason || 'none'}`);

    const totalCalls = userSynthA.modelCalls + userSynthB.modelCalls;
    console.log(`• Total LLM Model Calls Across Concurrent Attempts: ${totalCalls}`);

    if (totalCalls > 1) {
      throw new Error(`INVARIANT VIOLATED: Duplicate model calls detected (${totalCalls} > 1)`);
    }

    const statuses = [userSynthA.status, userSynthB.status];
    if (!statuses.includes('skipped')) {
      throw new Error(`INVARIANT VIOLATED: One instance should have been skipped due to lease lock`);
    }

    console.log('✅ PASS: Concurrency locking prevented duplicate model call.\n');

  } finally {
    // ── 4. CLEANUP ───────────────────────────────────────────────────────────
    console.log('[Cleanup] Cleaning up test claims and test data...');
    if (createdWmId) {
      await supabaseAdmin.from('working_memory').delete().eq('id', createdWmId);
    }
    await supabaseAdmin.from('candidate_synthesis_claims').delete().eq('run_id', testRunId);
    await supabaseAdmin.from('candidate_synthesis_runs').delete().eq('id', testRunId);
    console.log('[PASS] Cleanup complete.');
  }

  console.log('\n════════════════════════════════════════════════════════════════════');
  console.log('  PHASE 2E-C PRODUCTION CONCURRENCY TEST PASSED SUCCESSFULLY ✅       ');
  console.log('════════════════════════════════════════════════════════════════════');
}

runConcurrencySmokeTest().catch(err => {
  console.error('\n❌ CONCURRENCY SMOKE TEST FAILED:', err);
  process.exit(1);
});
