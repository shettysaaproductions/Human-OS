/**
 * prod_smoke_test_phase2fc.ts — Phase 2F-C Cognitive Doubt Anti-Loop Smoke Test
 *
 * PRODUCTION SAFETY:
 * Uses ONE isolated ephemeral authenticated test user.
 * ZERO destructive memory/source mutations.
 *
 * Scenarios:
 * 1. Scenario A: Family ambiguity ("Mere family mein 5 members hain" with 4 grounded).
 *    Create doubt, present once, repeat same evidence -> NO duplicate created.
 *
 * 2. Scenario B: Provide ambiguous reply ("He's the one I told you about").
 *    Doubt remains unresolved, bounded, and records ambiguous reply.
 *
 * 3. Scenario C: Provide explicit authoritative resolution ("My brother Rohan").
 *    Existing doubt resolves cleanly with resolution turn ID.
 *
 * 4. Scenario D: Introduce genuinely changed contradiction ("Actually family mein 6 log hain").
 *    Reopens doubt with new evidence version while preserving lifetime history.
 *
 * Usage:
 *   npx tsx scripts/prod_smoke_test_phase2fc.ts
 */

import { supabaseAdmin } from '../src/lib/supabase';
import { cognitiveDoubtService } from '../src/services/CognitiveDoubtService';
import { memoryRepository } from '../src/services/memoryRepository';
import crypto from 'crypto';

interface TestSummaryResult {
  scenario: string;
  passed: boolean;
  notes: string;
}

async function runPhase2fcSmokeTest() {
  console.log('════════════════════════════════════════════════════════════════════');
  console.log('  HUMAN-OS — PHASE 2F-C COGNITIVE DOUBT ANTI-LOOP SMOKE TEST        ');
  console.log('════════════════════════════════════════════════════════════════════\n');

  const testResults: TestSummaryResult[] = [];

  // Capture production baselines
  const { count: baselineMemCount } = await supabaseAdmin.from('memories').select('*', { count: 'exact', head: true });
  const { count: baselineDoubtCount } = await supabaseAdmin.from('nova_cognitive_doubts').select('*', { count: 'exact', head: true });

  console.log(`[Baseline] Memories: ${baselineMemCount}, CognitiveDoubts: ${baselineDoubtCount}\n`);

  // Create isolated ephemeral test user
  const email = `test-phase2fc-${crypto.randomUUID().substring(0, 8)}@humanos.internal`;
  const { data: authUser, error: authErr } = await supabaseAdmin.auth.admin.createUser({
    email,
    password: crypto.randomUUID(),
    email_confirm: true,
  });

  if (authErr || !authUser.user) {
    throw new Error(`Failed to create ephemeral user: ${authErr?.message}`);
  }

  const userId = authUser.user.id;
  console.log(`[Setup] Ephemeral User: ${userId} (${email})\n`);

  // Create profile
  await supabaseAdmin.from('profiles').insert({
    id: userId,
    preferred_name: 'Phase 2FC Test User',
    country: 'IN',
    timezone: 'Asia/Kolkata',
  });

  try {
    // ══════════════════════════════════════════════════════════════════════
    // SCENARIO A: FAMILY AMBIGUITY + SAME EVIDENCE REUSE
    // ══════════════════════════════════════════════════════════════════════
    console.log('--- SCENARIO A: SAME EVIDENCE REUSE & ANTI-LOOP ---');

    // 1. Ground 3 family members in memories table (User + 3 = 4 total)
    await memoryRepository.upsertMemory(
      userId,
      { type: 'family', key: 'wife_name', value: 'Sakshi', importance: 90, confidence: 0.95, shouldPersist: true, source_authority: 'explicit_user' },
      'Wife Sakshi'
    );
    await memoryRepository.upsertMemory(
      userId,
      { type: 'family', key: 'mother_name', value: 'Sunita', importance: 90, confidence: 0.95, shouldPersist: true, source_authority: 'explicit_user' },
      'Mother Sunita'
    );
    await memoryRepository.upsertMemory(
      userId,
      { type: 'family', key: 'father_name', value: 'Ramesh', importance: 90, confidence: 0.95, shouldPersist: true, source_authority: 'explicit_user' },
      'Father Ramesh'
    );

    // 2. User asserts "Mere family mein 5 members hain"
    const turn1Text = 'Mere family mein 5 members hain';
    const doubt1 = await cognitiveDoubtService.detectFamilyKnowledgeGap(userId, turn1Text, 'turn_1');
    if (!doubt1) throw new Error('Scenario A failed: detectFamilyKnowledgeGap did not create doubt');

    console.log(`• Created doubt: ${doubt1.id} (fingerprint: ${doubt1.fingerprint.substring(0, 12)}...)`);
    console.log(`• Evidence Version: ${doubt1.evidence?.evidence_version?.substring(0, 12)}...`);

    // 3. Mark presented
    const presented1 = await cognitiveDoubtService.markPresented(doubt1.id);
    console.log(`• Marked presented. Presentation count: ${presented1?.presentation_count}`);

    // 4. Reprocess identical user statement (same evidence)
    const doubtDuplicate = await cognitiveDoubtService.detectFamilyKnowledgeGap(userId, turn1Text, 'turn_2');
    console.log(`• Duplicate submission returned ID: ${doubtDuplicate?.id}`);

    const { data: allUserDoubts } = await supabaseAdmin
      .from('nova_cognitive_doubts')
      .select('id')
      .eq('user_id', userId);

    const sAPass = (allUserDoubts?.length === 1) && (doubtDuplicate?.id === doubt1.id);
    if (!sAPass) throw new Error('Scenario A failed: Duplicate doubt was inserted for same evidence!');
    console.log('• Scenario A PASS: Same evidence reused existing doubt with 0 duplicate rows ✅\n');

    testResults.push({
      scenario: 'Scenario A: Same Evidence Reuse & Anti-Loop',
      passed: sAPass,
      notes: 'Identical evidence reuses existing doubt without creating duplicates or resetting attempts.',
    });

    // ══════════════════════════════════════════════════════════════════════
    // SCENARIO B: AMBIGUOUS RESPONSE HANDLING
    // ══════════════════════════════════════════════════════════════════════
    console.log('--- SCENARIO B: AMBIGUOUS RESPONSE HANDLING ---');

    const ambiguousText = "He's the one I told you about";
    const ambMatch = await cognitiveDoubtService.checkResolutionOnUserTurn(userId, 'turn_amb_1', ambiguousText);
    console.log(`• Ambiguous match result: matched=${ambMatch.matched}, isResolved=${ambMatch.isResolved}, isAmbiguous=${ambMatch.isAmbiguous}`);

    const { data: doubtAfterAmb } = await supabaseAdmin
      .from('nova_cognitive_doubts')
      .select('status, evidence')
      .eq('id', doubt1.id)
      .single();

    const sBPass =
      ambMatch.matched === true &&
      ambMatch.isResolved === false &&
      ambMatch.isAmbiguous === true &&
      doubtAfterAmb?.status === 'presented' &&
      doubtAfterAmb?.evidence?.last_ambiguous_reply === ambiguousText;

    if (!sBPass) throw new Error('Scenario B failed: Ambiguous response was improperly handled!');
    console.log('• Scenario B PASS: Ambiguous response kept doubt unresolved and bounded ✅\n');

    testResults.push({
      scenario: 'Scenario B: Ambiguous Response Handling',
      passed: sBPass,
      notes: 'Ambiguous reply recorded in evidence without resolving or duplicating the doubt.',
    });

    // ══════════════════════════════════════════════════════════════════════
    // SCENARIO C: AUTHORITATIVE EXPLICIT RESOLUTION
    // ══════════════════════════════════════════════════════════════════════
    console.log('--- SCENARIO C: AUTHORITATIVE RESOLUTION ---');

    const resolutionText = 'My brother is Rohan';
    const resMatch = await cognitiveDoubtService.checkResolutionOnUserTurn(userId, 'turn_res_1', resolutionText);
    console.log(`• Resolution match result: matched=${resMatch.matched}, isResolved=${resMatch.isResolved}, resolvedKey=${resMatch.resolvedEntityKey}, resolvedValue=${resMatch.resolvedEntityValue}`);

    const { data: doubtAfterRes } = await supabaseAdmin
      .from('nova_cognitive_doubts')
      .select('status, resolution_turn_id, evidence')
      .eq('id', doubt1.id)
      .single();

    const sCPass =
      resMatch.matched === true &&
      resMatch.isResolved === true &&
      doubtAfterRes?.status === 'resolved' &&
      doubtAfterRes?.resolution_turn_id === 'turn_res_1' &&
      doubtAfterRes?.evidence?.resolution?.resolvedName === 'Rohan';

    if (!sCPass) throw new Error('Scenario C failed: Authoritative resolution did not resolve doubt cleanly!');
    console.log('• Scenario C PASS: Authoritative answer resolved existing doubt with full provenance ✅\n');

    testResults.push({
      scenario: 'Scenario C: Authoritative Resolution',
      passed: sCPass,
      notes: 'Explicit statement cleanly resolved doubt, recorded resolution_turn_id and timestamp.',
    });

    // ══════════════════════════════════════════════════════════════════════
    // SCENARIO D: CHANGED EVIDENCE REOPENS RESOLVED DOUBT
    // ══════════════════════════════════════════════════════════════════════
    console.log('--- SCENARIO D: CHANGED EVIDENCE REOPENING ---');

    // User now states "Actually family mein 6 members hain!" (Claimed 6 vs Grounded 5)
    const turn4Text = 'Actually family mein 6 members hain!';
    const doubtReopened = await cognitiveDoubtService.detectFamilyKnowledgeGap(userId, turn4Text, 'turn_4');

    console.log(`• Reopened doubt ID: ${doubtReopened?.id}`);
    console.log(`• Status: ${doubtReopened?.status} (Expected: open)`);
    console.log(`• Presentation count: ${doubtReopened?.presentation_count} (Expected: 0)`);
    console.log(`• Lifetime count: ${doubtReopened?.evidence?.lifetime_presentation_count} (Expected: 1)`);

    const { data: allUserDoubtsFinal } = await supabaseAdmin
      .from('nova_cognitive_doubts')
      .select('id')
      .eq('user_id', userId);

    const sDPass =
      doubtReopened?.id === doubt1.id &&
      doubtReopened?.status === 'open' &&
      doubtReopened?.presentation_count === 0 &&
      doubtReopened?.evidence?.lifetime_presentation_count === 1 &&
      allUserDoubtsFinal?.length === 1; // Still 1 unique conceptual record in DB!

    if (!sDPass) throw new Error('Scenario D failed: Changed evidence did not reopen cleanly!');
    console.log('• Scenario D PASS: Changed evidence reopened doubt cleanly with preserved lifetime history ✅\n');

    testResults.push({
      scenario: 'Scenario D: Changed Evidence Reopening',
      passed: sDPass,
      notes: 'New contradictory fact reopened resolved doubt in-place while preserving lifetime presentation history.',
    });

  } finally {
    // ══════════════════════════════════════════════════════════════════════
    // CLEANUP EPHEMERAL TEST USER ONLY
    // ══════════════════════════════════════════════════════════════════════
    console.log('--- CLEANING UP EPHEMERAL TEST RECORDS ---');
    await supabaseAdmin.from('memories').delete().eq('user_id', userId);
    await supabaseAdmin.from('nova_cognitive_doubts').delete().eq('user_id', userId);
    await supabaseAdmin.from('profiles').delete().eq('id', userId);

    try {
      await supabaseAdmin.auth.admin.deleteUser(userId);
      console.log(`• Ephemeral auth user ${userId} purged cleanly ✅`);
    } catch (purgeErr: any) {
      console.warn(`• Notice during auth user delete: ${purgeErr?.message}`);
    }

    // Baseline check
    const { count: finalMemCount } = await supabaseAdmin.from('memories').select('*', { count: 'exact', head: true });
    const { count: finalDoubtCount } = await supabaseAdmin.from('nova_cognitive_doubts').select('*', { count: 'exact', head: true });

    console.log(`\n• Final Memories: ${finalMemCount} (baseline: ${baselineMemCount}) ${finalMemCount === baselineMemCount ? '✅' : '❌'}`);
    console.log(`• Final Doubts:   ${finalDoubtCount} (baseline: ${baselineDoubtCount}) ${finalDoubtCount === baselineDoubtCount ? '✅' : '❌'}`);
  }

  console.log('\n════════════════════════════════════════════════════════════════════');
  console.log('  PHASE 2F-C SMOKE TEST RESULTS SUMMARY                             ');
  console.log('════════════════════════════════════════════════════════════════════');
  for (const r of testResults) {
    console.log(`[${r.passed ? 'PASS' : 'FAIL'}] ${r.scenario}`);
    console.log(`       ${r.notes}`);
  }

  const allPassed = testResults.every(r => r.passed);
  if (!allPassed) {
    throw new Error('One or more Phase 2F-C smoke test scenarios failed.');
  }

  console.log('\n✅ ALL PHASE 2F-C PRODUCTION SMOKE TESTS PASSED CLEANLY.\n');
}

runPhase2fcSmokeTest().catch(err => {
  console.error('\n❌ Smoke test failed with exception:', err);
  process.exit(1);
});
