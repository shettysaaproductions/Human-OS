/**
 * prod_smoke_test_phase2fb.ts — Phase 2F-B Source Dependency Protection Smoke Test
 *
 * PRODUCTION SAFETY:
 * Uses TWO isolated ephemeral authenticated test users (User A and User B).
 * ZERO destructive mutations, zero physical source deletions.
 *
 * Scenarios:
 * 1. Scenario A: Trusted compressed memory -> episodic source E:
 *    canPermanentlyDeleteSource(User A, 'episodic_memory', E.id) === false
 *
 * 2. Scenario B: Proposed compressed memory -> working memory W:
 *    canPermanentlyDeleteSource(User A, 'working_memory', W.id) === true
 *
 * 3. Scenario C: Cross-user reference: User A cites User B's episode E_B:
 *    Dependency is REJECTED (CROSS_USER_FORBIDDEN), User B source not locked for User A.
 *
 * 4. Scenario D: Trusted memory superseded -> dependency lock on E is cleanly released.
 *    0 physical source deletes.
 *
 * Usage:
 *   npx tsx scripts/prod_smoke_test_phase2fb.ts
 */

import { supabaseAdmin } from '../src/lib/supabase';
import { memoryRepository } from '../src/services/memoryRepository';
import { sourceDependencyService } from '../src/services/SourceDependencyService';
import crypto from 'crypto';

interface TestSummaryResult {
  scenario: string;
  passed: boolean;
  notes: string;
}

async function runPhase2fbSmokeTest() {
  console.log('════════════════════════════════════════════════════════════════════');
  console.log('  HUMAN-OS — PHASE 2F-B SOURCE DEPENDENCY PROTECTION SMOKE TEST     ');
  console.log('════════════════════════════════════════════════════════════════════\n');

  const testResults: TestSummaryResult[] = [];

  // Capture production baselines
  const { count: baselineMemCount } = await supabaseAdmin.from('memories').select('*', { count: 'exact', head: true });
  const { count: baselineEpCount } = await supabaseAdmin.from('episodic_memories').select('*', { count: 'exact', head: true });
  const { count: baselineWmCount } = await supabaseAdmin.from('working_memory').select('*', { count: 'exact', head: true });

  console.log(`[Baseline] Memories: ${baselineMemCount}, Episodes: ${baselineEpCount}, WorkingMemory: ${baselineWmCount}\n`);

  // Create isolated ephemeral test users
  const emailA = `test-phase2fb-a-${crypto.randomUUID().substring(0, 8)}@humanos.internal`;
  const emailB = `test-phase2fb-b-${crypto.randomUUID().substring(0, 8)}@humanos.internal`;

  const { data: authA, error: authAErr } = await supabaseAdmin.auth.admin.createUser({
    email: emailA,
    password: crypto.randomUUID(),
    email_confirm: true,
  });
  const { data: authB, error: authBErr } = await supabaseAdmin.auth.admin.createUser({
    email: emailB,
    password: crypto.randomUUID(),
    email_confirm: true,
  });

  if (authAErr || !authA.user || authBErr || !authB.user) {
    throw new Error(`Failed to create ephemeral users: ${authAErr?.message || authBErr?.message}`);
  }

  const userA = authA.user.id;
  const userB = authB.user.id;
  console.log(`[Setup] User A: ${userA} (${emailA})`);
  console.log(`[Setup] User B: ${userB} (${emailB})\n`);

  // Create profiles
  await supabaseAdmin.from('profiles').insert([
    { id: userA, preferred_name: 'Phase 2FB User A', country: 'IN', timezone: 'Asia/Kolkata' },
    { id: userB, preferred_name: 'Phase 2FB User B', country: 'IN', timezone: 'Asia/Kolkata' },
  ]);

  try {
    // ══════════════════════════════════════════════════════════════════════
    // SCENARIO A: TRUSTED COMPRESSED MEMORY LOCKS EPISODIC SOURCE
    // ══════════════════════════════════════════════════════════════════════
    console.log('--- SCENARIO A: TRUSTED MEMORY LOCKS EPISODIC SOURCE ---');

    // A.1 Create episodic source E for User A
    const { data: epA, error: epAErr } = await supabaseAdmin
      .from('episodic_memories')
      .insert({
        user_id: userA,
        summary: 'User discussed anniversary with wife Sakshi',
        emotional_valence: 8,
        is_archived: false,
      })
      .select('id')
      .single();

    if (epAErr || !epA) throw new Error(`Failed to create test episode: ${epAErr?.message}`);
    const episodeAId = epA.id;
    console.log(`• Created episodic source E: ${episodeAId}`);

    // A.2 Create trusted compressed memory M referencing E
    await memoryRepository.upsertMemory(
      userA,
      {
        type: 'family',
        key: 'wife_name',
        value: 'Sakshi',
        importance: 90,
        confidence: 0.95,
        shouldPersist: true,
        source_authority: 'subconscious_inference',
        compression_status: 'trusted', // Explicitly TRUSTED
        source_references: [{ type: 'episodic_memory', id: episodeAId }],
      },
      'Semantic compression from episodic memory'
    );
    console.log('• Created active trusted memory referencing episodic source E');

    // A.3 Check canPermanentlyDeleteSource
    const canDeleteA = await sourceDependencyService.canPermanentlyDeleteSource(userA, 'episodic_memory', episodeAId);
    console.log(`• canPermanentlyDeleteSource(UserA, episodeAId): ${canDeleteA} (Expected: false)`);

    const sAPass = canDeleteA === false;
    if (!sAPass) throw new Error('Scenario A failed: Trusted memory did not protect episodic source!');
    console.log('• Scenario A PASS: Episode E is purge-protected by trusted memory ✅\n');

    testResults.push({
      scenario: 'Scenario A: Trusted Memory Locks Episodic Source',
      passed: sAPass,
      notes: 'Active trusted memory correctly locked referenced episode. Permanent deletion guard blocked deletion.',
    });

    // ══════════════════════════════════════════════════════════════════════
    // SCENARIO B: PROPOSED COMPRESSED MEMORY DOES NOT LOCK
    // ══════════════════════════════════════════════════════════════════════
    console.log('--- SCENARIO B: PROPOSED MEMORY EXCLUDED FROM LOCKING ---');

    // B.1 Create working memory W for User A
    const { data: wmA, error: wmAErr } = await supabaseAdmin
      .from('working_memory')
      .insert({
        user_id: userA,
        key: 'temp_goal',
        value: 'Try Mexican cuisine',
      })
      .select('id')
      .single();

    if (wmAErr || !wmA) throw new Error(`Failed to create test working memory: ${wmAErr?.message}`);
    const wmId = wmA.id;
    console.log(`• Created working memory W: ${wmId}`);

    // B.2 Create proposed compressed memory referencing W
    await memoryRepository.upsertMemory(
      userA,
      {
        type: 'preferences',
        key: 'food_preference',
        value: 'Mexican',
        importance: 60,
        confidence: 0.7,
        shouldPersist: true,
        source_authority: 'subconscious_inference',
        compression_status: 'proposed', // PROPOSED (untrusted)
        source_references: [{ type: 'working_memory', id: wmId }],
      },
      'Proposed compression from working memory'
    );
    console.log('• Created proposed compressed memory referencing working memory W');

    // B.3 Check canPermanentlyDeleteSource
    const canDeleteB = await sourceDependencyService.canPermanentlyDeleteSource(userA, 'working_memory', wmId);
    console.log(`• canPermanentlyDeleteSource(UserA, wmId): ${canDeleteB} (Expected: true)`);

    const sBPass = canDeleteB === true;
    if (!sBPass) throw new Error('Scenario B failed: Proposed memory created an invalid lock!');
    console.log('• Scenario B PASS: Proposed memory did NOT create a permanent lock ✅\n');

    testResults.push({
      scenario: 'Scenario B: Proposed Memory Excluded From Locking',
      passed: sBPass,
      notes: 'Proposed memory draft did not lock source. canPermanentlyDeleteSource returned true.',
    });

    // ══════════════════════════════════════════════════════════════════════
    // SCENARIO C: CROSS-USER REFERENCE REJECTION
    // ══════════════════════════════════════════════════════════════════════
    console.log('--- SCENARIO C: CROSS-USER SOURCE REJECTION ---');

    // C.1 Create episode E_B for User B
    const { data: epB, error: epBErr } = await supabaseAdmin
      .from('episodic_memories')
      .insert({
        user_id: userB,
        summary: 'User B private medical consultation',
        emotional_valence: -5,
        is_archived: false,
      })
      .select('id')
      .single();

    if (epBErr || !epB) throw new Error(`Failed to create User B episode: ${epBErr?.message}`);
    const episodeBId = epB.id;
    console.log(`• Created User B private episode E_B: ${episodeBId}`);

    // C.2 User A attempts to create trusted memory referencing User B's episode
    const { data: memCross } = await supabaseAdmin
      .from('memories')
      .insert({
        user_id: userA,
        key: 'adversarial_key',
        value: 'Malicious citation',
        memory_type: 'personal',
        importance: 90,
        confidence: 0.95,
        source_authority: 'subconscious_inference',
        compression_status: 'trusted',
        lifecycle_state: 'CURRENT',
        is_archived: false,
        source_references: [{ type: 'episodic_memory', id: episodeBId }],
      })
      .select('id, user_id, key, source_references, is_archived, lifecycle_state, compression_status')
      .single();

    const provReportCross = await sourceDependencyService.resolveMemoryProvenance(userA, memCross as any);
    console.log(`• Provenance complete: ${provReportCross.provenanceComplete} (Expected: false)`);
    console.log(`• Unresolved reasons: ${provReportCross.provenanceIncompleteReason}`);

    const canDeleteUserBForUserA = await sourceDependencyService.canPermanentlyDeleteSource(userA, 'episodic_memory', episodeBId);
    console.log(`• canPermanentlyDeleteSource(UserA, episodeBId): ${canDeleteUserBForUserA} (Expected: true)`);

    const sCPass =
      provReportCross.provenanceComplete === false &&
      provReportCross.unresolvedDependencies.some(d => d.reason === 'CROSS_USER_FORBIDDEN') &&
      canDeleteUserBForUserA === true;

    if (!sCPass) throw new Error('Scenario C failed: Cross-user source reference was not strictly rejected!');
    console.log('• Scenario C PASS: Cross-user dependency rejected with CROSS_USER_FORBIDDEN ✅\n');

    testResults.push({
      scenario: 'Scenario C: Cross-User Dependency Rejection',
      passed: sCPass,
      notes: 'User A cannot lock User B source records. Rejected with CROSS_USER_FORBIDDEN.',
    });

    // ══════════════════════════════════════════════════════════════════════
    // SCENARIO D: TRUSTED MEMORY SUPERSEDED -> LOCK RELEASED
    // ══════════════════════════════════════════════════════════════════════
    console.log('--- SCENARIO D: SUPERSEDED TRUSTED MEMORY RELEASES LOCK ---');

    // D.1 User A explicitly corrects wife_name -> Sakshi (from Scenario A) gets superseded
    console.log('• User A asserts explicit correction for wife_name');
    await memoryRepository.upsertMemory(
      userA,
      {
        type: 'family',
        key: 'wife_name',
        value: 'Priya', // Explicit correction superseding Sakshi
        importance: 90,
        confidence: 0.99,
        shouldPersist: true,
        source_authority: 'explicit_user',
        correction_intent: true,
      },
      'Actually meri wife ka naam Priya hai'
    );

    // D.2 Check canPermanentlyDeleteSource on episodeAId
    // Since the memory citing episodeAId was superseded (is_archived = true, lifecycle_state = 'SUPERSEDED'),
    // the lock should be released!
    const canDeleteAfterSuperseded = await sourceDependencyService.canPermanentlyDeleteSource(userA, 'episodic_memory', episodeAId);
    console.log(`• canPermanentlyDeleteSource(UserA, episodeAId) after supersession: ${canDeleteAfterSuperseded} (Expected: true)`);

    const sDPass = canDeleteAfterSuperseded === true;
    if (!sDPass) throw new Error('Scenario D failed: Superseded memory did not release source lock!');
    console.log('• Scenario D PASS: Superseded memory cleanly released provenance lock ✅\n');

    testResults.push({
      scenario: 'Scenario D: Superseded Memory Releases Lock',
      passed: sDPass,
      notes: 'When trusted memory was superseded by authoritative correction, its source lock was cleanly released.',
    });

  } finally {
    // ══════════════════════════════════════════════════════════════════════
    // CLEANUP EPHEMERAL TEST USERS ONLY
    // ══════════════════════════════════════════════════════════════════════
    console.log('--- CLEANING UP EPHEMERAL TEST RECORDS ---');
    await supabaseAdmin.from('memories').delete().in('user_id', [userA, userB]);
    await supabaseAdmin.from('episodic_memories').delete().in('user_id', [userA, userB]);
    await supabaseAdmin.from('working_memory').delete().in('user_id', [userA, userB]);
    await supabaseAdmin.from('profiles').delete().in('id', [userA, userB]);

    try {
      await supabaseAdmin.auth.admin.deleteUser(userA);
      await supabaseAdmin.auth.admin.deleteUser(userB);
      console.log(`• Ephemeral auth users ${userA} and ${userB} purged cleanly ✅`);
    } catch (purgeErr: any) {
      console.warn(`• Notice during auth user delete: ${purgeErr?.message}`);
    }

    // Baseline check
    const { count: finalMemCount } = await supabaseAdmin.from('memories').select('*', { count: 'exact', head: true });
    const { count: finalEpCount } = await supabaseAdmin.from('episodic_memories').select('*', { count: 'exact', head: true });
    const { count: finalWmCount } = await supabaseAdmin.from('working_memory').select('*', { count: 'exact', head: true });

    console.log(`\n• Final Memories: ${finalMemCount} (baseline: ${baselineMemCount}) ${finalMemCount === baselineMemCount ? '✅' : '❌'}`);
    console.log(`• Final Episodes: ${finalEpCount} (baseline: ${baselineEpCount}) ${finalEpCount === baselineEpCount ? '✅' : '❌'}`);
    console.log(`• Final Working:  ${finalWmCount} (baseline: ${baselineWmCount}) ${finalWmCount === baselineWmCount ? '✅' : '❌'}`);
  }

  console.log('\n════════════════════════════════════════════════════════════════════');
  console.log('  PHASE 2F-B SMOKE TEST RESULTS SUMMARY                             ');
  console.log('════════════════════════════════════════════════════════════════════');
  for (const r of testResults) {
    console.log(`[${r.passed ? 'PASS' : 'FAIL'}] ${r.scenario}`);
    console.log(`       ${r.notes}`);
  }

  const allPassed = testResults.every(r => r.passed);
  if (!allPassed) {
    throw new Error('One or more Phase 2F-B smoke test scenarios failed.');
  }

  console.log('\n✅ ALL PHASE 2F-B PRODUCTION SMOKE TESTS PASSED CLEANLY.\n');
}

runPhase2fbSmokeTest().catch(err => {
  console.error('\n❌ Smoke test failed with exception:', err);
  process.exit(1);
});
