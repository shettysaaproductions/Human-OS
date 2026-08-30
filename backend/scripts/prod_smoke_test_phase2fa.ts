/**
 * prod_smoke_test_phase2fa.ts — Phase 2F-A Production Smoke Test
 *
 * PRODUCTION SAFETY:
 * Uses ONE ephemeral authenticated test user.
 *
 * Scenario 1 (Authoritative Correction):
 * 1. "My wife is Priya." -> CURRENT fact
 * 2. "Actually meri wife ka naam Sakshi hai." -> Explicit correction
 * Verifies:
 * • wife_name current = Sakshi
 * • Priya = SUPERSEDED (is_archived = true, superseded_by = Sakshi ID)
 * • No duplicate current wife_name
 * • Normal durable context excludes Priya
 *
 * Scenario 2 (Historical Fact Preservation):
 * 1. "Worked at Company A in 2023." -> HISTORICAL fact
 * 2. "Now I work at Company B." -> CURRENT fact
 * Verifies:
 * • Company A remains HISTORICAL (is_archived = false)
 * • Company B remains CURRENT (is_archived = false)
 * • Company A is not superseded by Company B
 *
 * Usage:
 *   npx tsx scripts/prod_smoke_test_phase2fa.ts
 */

import { memoryRepository } from '../src/services/memoryRepository';
import { cognitiveContextService } from '../src/services/CognitiveContextService';
import { supabaseAdmin } from '../src/lib/supabase';
import crypto from 'crypto';

interface TestSummaryResult {
  scenario: string;
  passed: boolean;
  notes: string;
}

async function runPhase2faSmokeTest() {
  console.log('════════════════════════════════════════════════════════════════════');
  console.log('  HUMAN-OS — PHASE 2F-A MEMORY SUPERSESSION PRODUCTION SMOKE TEST   ');
  console.log('════════════════════════════════════════════════════════════════════\n');

  const testResults: TestSummaryResult[] = [];

  // Capture production baselines
  const { count: baselineMemCount } = await supabaseAdmin
    .from('memories')
    .select('*', { count: 'exact', head: true });

  console.log(`[Baseline] Production Memories Count: ${baselineMemCount}\n`);

  // Create isolated ephemeral test user
  const ephemeralEmail = `test-phase2fa-${crypto.randomUUID().substring(0, 8)}@humanos.internal`;
  const { data: authData, error: authErr } = await supabaseAdmin.auth.admin.createUser({
    email: ephemeralEmail,
    password: crypto.randomUUID(),
    email_confirm: true,
  });

  if (authErr || !authData.user) {
    throw new Error(`Failed to create ephemeral auth user: ${authErr?.message}`);
  }

  const testUserId = authData.user.id;
  console.log(`[Setup] Ephemeral Test User Created: ${testUserId} (${ephemeralEmail})`);

  // Create profile
  await supabaseAdmin.from('profiles').insert({
    id: testUserId,
    preferred_name: 'Phase 2FA Test User',
    country: 'IN',
    timezone: 'Asia/Kolkata',
  });

  try {
    // ══════════════════════════════════════════════════════════════════════
    // SCENARIO 1: EXPLICIT CORRECTION SUPERSESSION
    // ══════════════════════════════════════════════════════════════════════
    console.log('\n--- SCENARIO 1: EXPLICIT CORRECTION & SUPERSESSION ---');

    // Step 1.1: Insert initial fact "My wife is Priya."
    console.log('1.1 Asserting initial fact: "My wife is Priya"');
    await memoryRepository.upsertMemory(
      testUserId,
      {
        type: 'family',
        key: 'wife_name',
        value: 'Priya',
        importance: 90,
        confidence: 0.95,
        shouldPersist: true,
        source_authority: 'explicit_user',
      },
      'My wife is Priya'
    );

    const { data: initialMems } = await supabaseAdmin
      .from('memories')
      .select('id, key, value, lifecycle_state, is_archived, superseded_by')
      .eq('user_id', testUserId)
      .eq('key', 'wife_name');

    const priyaRow = (initialMems || []).find((m: any) => m.value === 'Priya');
    console.log(`• Initial row created: id=${priyaRow?.id}, value=${priyaRow?.value}, state=${priyaRow?.lifecycle_state}, archived=${priyaRow?.is_archived}`);

    if (!priyaRow || priyaRow.is_archived || priyaRow.lifecycle_state !== 'CURRENT') {
      throw new Error('Initial memory was not properly set to CURRENT');
    }

    // Step 1.2: Assert explicit correction "Actually meri wife ka naam Sakshi hai."
    console.log('1.2 Asserting explicit correction: "Actually meri wife ka naam Sakshi hai."');
    await memoryRepository.upsertMemory(
      testUserId,
      {
        type: 'family',
        key: 'wife_name',
        value: 'Sakshi',
        importance: 90,
        confidence: 0.98,
        shouldPersist: true,
        source_authority: 'explicit_user',
        correction_intent: true,
      },
      'Actually meri wife ka naam Sakshi hai.'
    );

    const { data: postCorrectionMems } = await supabaseAdmin
      .from('memories')
      .select('id, key, value, lifecycle_state, is_archived, superseded_by, superseded_at, supersession_reason')
      .eq('user_id', testUserId)
      .eq('key', 'wife_name');

    const currentRows = (postCorrectionMems || []).filter((m: any) => !m.is_archived);
    const supersededRows = (postCorrectionMems || []).filter((m: any) => m.is_archived && m.lifecycle_state === 'SUPERSEDED');

    console.log(`• Post-correction rows: Total=${postCorrectionMems?.length}, Current=${currentRows.length}, Superseded=${supersededRows.length}`);

    const sakshiRow = currentRows.find((m: any) => m.value === 'Sakshi');
    const priyaSupersededRow = supersededRows.find((m: any) => m.value === 'Priya');

    console.log(`• CURRENT row: id=${sakshiRow?.id}, value=${sakshiRow?.value}, state=${sakshiRow?.lifecycle_state}`);
    console.log(`• SUPERSEDED row: id=${priyaSupersededRow?.id}, value=${priyaSupersededRow?.value}, state=${priyaSupersededRow?.lifecycle_state}, superseded_by=${priyaSupersededRow?.superseded_by}`);

    const s1SupersessionPass =
      currentRows.length === 1 &&
      sakshiRow?.value === 'Sakshi' &&
      sakshiRow?.lifecycle_state === 'CURRENT' &&
      supersededRows.length === 1 &&
      priyaSupersededRow?.value === 'Priya' &&
      priyaSupersededRow?.superseded_by === sakshiRow?.id;

    if (!s1SupersessionPass) {
      throw new Error('Supersession invariants failed in database state!');
    }
    console.log('• Database state supersession verified ✅');

    // Step 1.3: Context retrieval verification
    console.log('1.3 Verifying normal context assembly excludes superseded fact...');
    const ctx = await cognitiveContextService.assembleContext({
      userId: testUserId,
      effectiveMessage: 'Tell me about my wife',
    });

    const durableFactValues = ctx.memories.durableFacts.map(f => f.value);
    console.log(`• Context Durable Facts for wife_name: [${durableFactValues.join(', ')}]`);

    const s1ContextPass = durableFactValues.includes('Sakshi') && !durableFactValues.includes('Priya');
    if (!s1ContextPass) {
      throw new Error('Context assembly still returned the superseded memory value!');
    }
    console.log('• Context exclusion of superseded fact verified ✅');

    testResults.push({
      scenario: 'Scenario 1: Explicit Correction Supersession',
      passed: s1SupersessionPass && s1ContextPass,
      notes: 'Priya was cleanly superseded by Sakshi. Superseded row archived and linked via superseded_by. Context strictly excluded Priya.',
    });

    // ══════════════════════════════════════════════════════════════════════
    // SCENARIO 2: HISTORICAL FACTS PRESERVATION
    // ══════════════════════════════════════════════════════════════════════
    console.log('\n--- SCENARIO 2: HISTORICAL FACTS PRESERVATION ---');

    // Step 2.1: Insert historical fact "Worked at Company A in 2023."
    console.log('2.1 Asserting historical fact: "Worked at Company A in 2023."');
    await memoryRepository.upsertMemory(
      testUserId,
      {
        type: 'work',
        key: 'company_name',
        value: 'Worked at Company A in 2023',
        importance: 70,
        confidence: 0.9,
        shouldPersist: true,
        source_authority: 'explicit_user',
      },
      'I worked at Company A in 2023.'
    );

    // Step 2.2: Insert current fact "Now I work at Company B."
    console.log('2.2 Asserting current fact: "Now I work at Company B."');
    await memoryRepository.upsertMemory(
      testUserId,
      {
        type: 'work',
        key: 'company_name',
        value: 'Company B',
        importance: 85,
        confidence: 0.95,
        shouldPersist: true,
        source_authority: 'explicit_user',
      },
      'Now I work at Company B.'
    );

    const { data: workMems } = await supabaseAdmin
      .from('memories')
      .select('id, key, value, lifecycle_state, is_archived')
      .eq('user_id', testUserId)
      .eq('key', 'company_name');

    console.log(`• Work memory records found: count=${workMems?.length}`);
    for (const m of workMems || []) {
      console.log(`  - id=${m.id}, value="${m.value}", state=${m.lifecycle_state}, archived=${m.is_archived}`);
    }

    const histCompanyA = (workMems || []).find((m: any) => m.value.includes('Company A'));
    const currCompanyB = (workMems || []).find((m: any) => m.value === 'Company B');

    const s2HistoricalPass =
      histCompanyA?.lifecycle_state === 'HISTORICAL' &&
      histCompanyA?.is_archived === false &&
      currCompanyB?.lifecycle_state === 'CURRENT' &&
      currCompanyB?.is_archived === false;

    if (!s2HistoricalPass) {
      throw new Error('Historical preservation invariants failed!');
    }
    console.log('• Historical Company A and Current Company B coexist cleanly without supersession ✅');

    testResults.push({
      scenario: 'Scenario 2: Historical Fact Preservation',
      passed: s2HistoricalPass,
      notes: 'Company A preserved as HISTORICAL (unarchived). Company B inserted as CURRENT. Zero accidental supersession.',
    });

  } finally {
    // ══════════════════════════════════════════════════════════════════════
    // CLEANUP EPHEMERAL TEST USER ONLY
    // ══════════════════════════════════════════════════════════════════════
    console.log('\n--- CLEANING UP EPHEMERAL TEST RECORDS ---');
    await supabaseAdmin.from('memories').delete().eq('user_id', testUserId);
    await supabaseAdmin.from('profiles').delete().eq('id', testUserId);

    try {
      await supabaseAdmin.auth.admin.deleteUser(testUserId);
      console.log(`• Ephemeral test user ${testUserId} purged cleanly ✅`);
    } catch (purgeErr: any) {
      console.warn(`• Notice during test user auth delete: ${purgeErr?.message}`);
    }

    // Verify baseline restored
    const { count: finalMemCount } = await supabaseAdmin
      .from('memories')
      .select('*', { count: 'exact', head: true });

    console.log(`\n• Final Memories Count: ${finalMemCount} (baseline: ${baselineMemCount}) ${finalMemCount === baselineMemCount ? '✅' : '❌'}`);
  }

  console.log('\n════════════════════════════════════════════════════════════════════');
  console.log('  PHASE 2F-A SMOKE TEST RESULTS SUMMARY                             ');
  console.log('════════════════════════════════════════════════════════════════════');
  for (const r of testResults) {
    console.log(`[${r.passed ? 'PASS' : 'FAIL'}] ${r.scenario}`);
    console.log(`       ${r.notes}`);
  }

  const allPassed = testResults.every(r => r.passed);
  if (!allPassed) {
    throw new Error('One or more Phase 2F-A smoke test scenarios failed.');
  }

  console.log('\n✅ ALL PHASE 2F-A PRODUCTION SMOKE TESTS PASSED CLEANLY.\n');
}

runPhase2faSmokeTest().catch(err => {
  console.error('\n❌ Smoke test failed with exception:', err);
  process.exit(1);
});
