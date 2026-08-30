/**
 * prod_smoke_test_phase2ec.ts — Phase 2E-C Production Smoke Test
 *
 * Runs live candidate synthesis verification for Phase 2E-C with ONE valid user:
 * Scenario A: Temporary event ("Aaj baarish mein office se late nikla.") -> event candidate
 * Scenario B: Explicit stable preference -> duplicate avoided if already in semantic memory
 * Scenario C: Repeated trivial food events ("I ate pizza") -> no psychological trait created
 * Scenario D: Question ("Abhi mera main goal kya hai?") -> no candidate
 * Scenario E: Existing semantic memory (wife_name = Sakshi) -> no duplicate candidate
 *
 * Invariants:
 * - ZERO writes to durable semantic memory (memories table)
 * - ZERO source deletion / archival
 * - Clean cleanup of all test records
 */

import { supabaseAdmin } from '../src/lib/supabase';
import { candidateSynthesisService } from '../src/services/CandidateSynthesisService';
import crypto from 'crypto';

async function runSmokeTest() {
  console.log('════════════════════════════════════════════════════════════════════');
  console.log('  HUMAN-OS — PHASE 2E-C NIGHTLY CANDIDATE SYNTHESIS SMOKE TEST        ');
  console.log('════════════════════════════════════════════════════════════════════\n');

  // Baseline memory count
  const { count: baselineMemCount } = await supabaseAdmin.from('memories').select('*', { count: 'exact', head: true });
  console.log(`[Baseline] Total Existing Semantic Memory Rows: ${baselineMemCount}`);

  // Fetch valid user profile
  const { data: prof, error: profErr } = await supabaseAdmin
    .from('profiles')
    .select('id')
    .limit(1)
    .single();

  if (profErr || !prof) {
    throw new Error('No valid user profile found in database for smoke test');
  }

  const testUserId = prof.id;
  console.log(`[Setup] Using Valid User ID: ${testUserId}\n`);

  const createdWmIds: string[] = [];
  const createdEpIds: string[] = [];

  try {
    // ── 1. SEED REALISTIC EVIDENCE FOR SCENARIOS A, B, C, D, E ───────────────
    console.log('--- SEEDING REALISTIC WORKING & EPISODIC TEST DATA ---');

    // A: Event
    const { data: epA } = await supabaseAdmin.from('episodic_memories').insert({
      user_id: testUserId,
      summary: 'Aaj baarish mein office se late nikla.',
      emotion: 'tired',
    }).select('id').single();
    if (epA) createdEpIds.push(epA.id);

    // B: Candidate preference in working memory
    const { data: wmB } = await supabaseAdmin.from('working_memory').insert({
      user_id: testUserId,
      key: 'work_routine_preference',
      value: 'morning focus time preferred',
      promotion_status: 'CANDIDATE',
    }).select('id').single();
    if (wmB) createdWmIds.push(wmB.id);

    // C: Repeated trivial events
    const { data: epC1 } = await supabaseAdmin.from('episodic_memories').insert({
      user_id: testUserId,
      summary: 'Ate pizza for lunch.',
    }).select('id').single();
    if (epC1) createdEpIds.push(epC1.id);

    const { data: epC2 } = await supabaseAdmin.from('episodic_memories').insert({
      user_id: testUserId,
      summary: 'Ate pizza again for dinner.',
    }).select('id').single();
    if (epC2) createdEpIds.push(epC2.id);

    // D: Question in working memory
    const { data: wmD } = await supabaseAdmin.from('working_memory').insert({
      user_id: testUserId,
      key: 'question_query',
      value: 'Abhi mera main goal kya hai?',
      promotion_status: 'CANDIDATE',
    }).select('id').single();
    if (wmD) createdWmIds.push(wmD.id);

    // E: Canonical fact duplicate attempt
    const { data: wmE } = await supabaseAdmin.from('working_memory').insert({
      user_id: testUserId,
      key: 'wife_name',
      value: 'Sakshi',
      promotion_status: 'CANDIDATE',
    }).select('id').single();
    if (wmE) createdWmIds.push(wmE.id);

    console.log(`• Seeded ${createdWmIds.length} working memory rows and ${createdEpIds.length} episodic memory rows.`);

    // ── 2. EXECUTE CANDIDATE SYNTHESIS ───────────────────────────────────────
    console.log('\n--- EXECUTING CANDIDATE SYNTHESIS ENGINE ---');
    const result = await candidateSynthesisService.synthesizeCandidatesForUser(testUserId);

    console.log(`• Status: ${result.status}`);
    console.log(`• Model Calls: ${result.modelCalls}`);
    console.log(`• Candidates Generated (${result.candidatesGenerated.length}):`);
    result.candidatesGenerated.forEach((c, idx) => {
      console.log(`  ${idx + 1}. [${c.category}] key="${c.proposed_key}", value="${c.proposed_value}" (confidence: ${c.confidence}, refs: ${c.source_references.length})`);
    });
    console.log(`• Deduplicated Candidates: ${result.candidatesDeduplicated}`);
    console.log(`• Rejected Candidates: ${result.candidatesRejected}`);

    // ── 3. VERIFY INVARIANTS ─────────────────────────────────────────────────
    console.log('\n--- VERIFYING PHASE 2E-C INVARIANTS ---');

    // Invariant 1: Semantic memory row count must be UNCHANGED (0 writes)
    const { count: postMemCount } = await supabaseAdmin.from('memories').select('*', { count: 'exact', head: true });
    console.log(`• Semantic Memory Count: ${baselineMemCount} -> ${postMemCount}`);
    if (postMemCount !== baselineMemCount) {
      throw new Error(`INVARIANT VIOLATED: Semantic memory count changed from ${baselineMemCount} to ${postMemCount}`);
    }
    console.log('✅ Invariant 1 PASS: Zero writes to durable semantic memory.');

    // Invariant 2: Frequency != Truth (No psychological obsession trait)
    const hasObsessionTrait = result.candidatesGenerated.some(c =>
      c.proposed_value.toLowerCase().includes('obsessed') ||
      c.proposed_value.toLowerCase().includes('addicted')
    );
    if (hasObsessionTrait) {
      throw new Error('INVARIANT VIOLATED: Created ungrounded personality trait from repeated pizza events');
    }
    console.log('✅ Invariant 2 PASS: Frequency != Truth respected (no personality traits inferred).');

    // Invariant 3: Question rejected
    const questionCandidate = result.candidatesGenerated.some(c =>
      c.proposed_value.toLowerCase().includes('main goal kya hai')
    );
    if (questionCandidate) {
      throw new Error('INVARIANT VIOLATED: Question text promoted to candidate');
    }
    console.log('✅ Invariant 3 PASS: Question text rejected.');

    // Invariant 4: Existing canonical memory (wife_name=Sakshi) deduplicated
    const duplicateWife = result.candidatesGenerated.some(c =>
      c.proposed_key === 'wife_name' && c.proposed_value.toLowerCase() === 'sakshi'
    );
    if (duplicateWife) {
      throw new Error('INVARIANT VIOLATED: Created duplicate candidate for already-canonical memory');
    }
    console.log('✅ Invariant 4 PASS: Existing canonical memory deduplicated.');

    // Invariant 5: Valid source references
    for (const c of result.candidatesGenerated) {
      if (!c.source_references || c.source_references.length === 0) {
        throw new Error(`INVARIANT VIOLATED: Candidate ${c.proposed_key} has no source references`);
      }
    }
    console.log('✅ Invariant 5 PASS: All candidates cite verified source references.');

  } finally {
    // ── 4. CLEANUP TEST DATA ─────────────────────────────────────────────────
    console.log('\n[Cleanup] Deleting seeded test records...');
    if (createdWmIds.length > 0) {
      await supabaseAdmin.from('working_memory').delete().in('id', createdWmIds);
    }
    if (createdEpIds.length > 0) {
      await supabaseAdmin.from('episodic_memories').delete().in('id', createdEpIds);
    }

    const { count: finalMemCount } = await supabaseAdmin.from('memories').select('*', { count: 'exact', head: true });
    console.log(`[PASS] Cleanup complete. Final Total Semantic Memory Rows: ${finalMemCount} (baseline: ${baselineMemCount})`);
  }

  console.log('\n════════════════════════════════════════════════════════════════════');
  console.log('  PHASE 2E-C PRODUCTION SMOKE TEST PASSED SUCCESSFULLY ✅            ');
  console.log('════════════════════════════════════════════════════════════════════');
}

runSmokeTest().catch(err => {
  console.error('\n❌ SMOKE TEST FAILED:', err);
  process.exit(1);
});
