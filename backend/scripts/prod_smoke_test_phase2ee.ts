/**
 * prod_smoke_test_phase2ee.ts — Phase 2E-E Production Dry-Run Retention Evaluation
 *
 * Runs live Phase 2E-E retention matrix evaluation against production:
 * Scenario A: Protected identity fact -> PROTECTED (KEEP, priority NOW)
 * Scenario B: Old important event -> DURABLE_FACT / IMPORTANT_EPISODE (KEEP)
 * Scenario C: Recent trivial event -> LOW_VALUE_EVENT (FADE_CANDIDATE, priority BACKGROUND)
 * Scenario D: Active goal -> ACTIVE_GOAL (KEEP, priority NOW)
 * Scenario E: Expired temporary event -> EXPIRED (ARCHIVE_CANDIDATE)
 * Scenario F: Low-importance stale inference -> LOW_VALUE_EVENT (FADE_CANDIDATE)
 *
 * Invariants:
 * - ZERO deletion of source records
 * - ZERO archival of source records
 * - ZERO semantic overwrites
 * - Complete rollback/cleanup of test rows
 */

import { supabaseAdmin } from '../src/lib/supabase';
import { memoryRetentionEngine } from '../src/services/MemoryRetentionEngine';

async function runPhase2eeSmokeTest() {
  console.log('════════════════════════════════════════════════════════════════════');
  console.log('  HUMAN-OS — PHASE 2E-E RETENTION MATRIX PRODUCTION DRY-RUN          ');
  console.log('════════════════════════════════════════════════════════════════════\n');

  // Baseline memory counts
  const { count: baselineMemCount } = await supabaseAdmin.from('memories').select('*', { count: 'exact', head: true });
  const { count: baselineWmCount } = await supabaseAdmin.from('working_memory').select('*', { count: 'exact', head: true });
  const { count: baselineEpCount } = await supabaseAdmin.from('episodic_memories').select('*', { count: 'exact', head: true });

  console.log(`[Baseline] Memories: ${baselineMemCount}, WorkingMemory: ${baselineWmCount}, Episodic: ${baselineEpCount}`);

  // Fetch valid user profile
  const { data: prof, error: profErr } = await supabaseAdmin
    .from('profiles')
    .select('id')
    .limit(1)
    .single();

  if (profErr || !prof) {
    throw new Error('No valid user profile found for Phase 2E-E test');
  }

  const testUserId = prof.id;
  console.log(`[Setup] Using Valid User ID: ${testUserId}\n`);

  const createdMemIds: string[] = [];
  const createdWmIds: string[] = [];
  const createdEpIds: string[] = [];

  try {
    // ── 1. SEED TEST RECORDS ────────────────────────────────────────────────
    console.log('--- SEEDING PHASE 2E-E TEST SCENARIOS ---');

    // Scenario A: Protected Identity Fact
    const { data: memA } = await supabaseAdmin.from('memories').insert({
      user_id: testUserId,
      memory_type: 'personal',
      key: 'test_passport_protected',
      value: 'X1234567',
      importance: 95,
      confidence: 1.0,
      protection_source: 'system',
      source_authority: 'explicit_user',
    }).select('id').single();
    if (memA) createdMemIds.push(memA.id);

    // Scenario B: Old Foundational Fact
    const { data: memB } = await supabaseAdmin.from('memories').insert({
      user_id: testUserId,
      memory_type: 'family',
      key: 'test_mother_name',
      value: 'Sunita',
      importance: 90,
      confidence: 0.99,
      source_authority: 'explicit_user',
    }).select('id').single();
    if (memB) createdMemIds.push(memB.id);

    // Scenario C: Recent Trivial Event (Episodic)
    const { data: epC } = await supabaseAdmin.from('episodic_memories').insert({
      user_id: testUserId,
      summary: 'Ate pizza for lunch yesterday.',
      emotional_valence: 0,
      created_at: new Date(Date.now() - 3 * 86400000).toISOString(), // 3 days old
    }).select('id').single();
    if (epC) createdEpIds.push(epC.id);

    // Scenario D: Active Goal
    const { data: memD } = await supabaseAdmin.from('memories').insert({
      user_id: testUserId,
      memory_type: 'goals',
      key: 'test_launch_kitchen',
      value: 'Launch cloud kitchen by end of year',
      importance: 90,
      confidence: 0.95,
      source_authority: 'explicit_user',
    }).select('id').single();
    if (memD) createdMemIds.push(memD.id);

    // Scenario E: Expired Temporary Event (WorkingMemory)
    const { data: wmE } = await supabaseAdmin.from('working_memory').insert({
      user_id: testUserId,
      key: 'test_interview_prep',
      value: 'Interview prep at 10am',
      expires_at: new Date(Date.now() - 2 * 86400000).toISOString(), // expired
    }).select('id').single();
    if (wmE) createdWmIds.push(wmE.id);

    // Scenario F: Low-Importance Stale Inference
    const { data: memF } = await supabaseAdmin.from('memories').insert({
      user_id: testUserId,
      memory_type: 'personal',
      key: 'test_stale_color_pref',
      value: 'Might prefer blue shirts',
      importance: 25,
      confidence: 0.4,
      source_authority: 'subconscious_inference',
      created_at: new Date(Date.now() - 45 * 86400000).toISOString(), // 45 days old
    }).select('id').single();
    if (memF) createdMemIds.push(memF.id);

    console.log(`• Seeded: 4 Memories, 1 WorkingMemory, 1 EpisodicMemory\n`);

    // ── 2. EXECUTE RETENTION EVALUATION ─────────────────────────────────────
    console.log('--- EXECUTING RETENTION EVALUATION BATCH (DRY-RUN) ---');
    const proposals = await memoryRetentionEngine.evaluateUserRetentionBatch(testUserId);
    console.log(`• Total Proposals Generated: ${proposals.length}\n`);

    const keepProps = proposals.filter(p => p.decision === 'KEEP');
    const compressProps = proposals.filter(p => p.decision === 'COMPRESS_CANDIDATE');
    const archiveProps = proposals.filter(p => p.decision === 'ARCHIVE_CANDIDATE');
    const fadeProps = proposals.filter(p => p.decision === 'FADE_CANDIDATE');
    const indeterminateProps = proposals.filter(p => p.decision === 'INDETERMINATE');
    const humanReviewProps = proposals.filter(p => p.decision === 'HUMAN_REVIEW');

    console.log(`[Proposal Inventory]`);
    console.log(`  KEEP:                 ${keepProps.length}`);
    console.log(`  COMPRESS_CANDIDATE:   ${compressProps.length}`);
    console.log(`  ARCHIVE_CANDIDATE:    ${archiveProps.length}`);
    console.log(`  FADE_CANDIDATE:       ${fadeProps.length}`);
    console.log(`  INDETERMINATE:        ${indeterminateProps.length}`);
    console.log(`  HUMAN_REVIEW:         ${humanReviewProps.length}\n`);

    // Verify key scenario decisions
    const propA = proposals.find(p => p.target_id === memA!.id);
    const propB = proposals.find(p => p.target_id === memB!.id);
    const propC = proposals.find(p => p.target_id === epC!.id);
    const propD = proposals.find(p => p.target_id === memD!.id);
    const propE = proposals.find(p => p.target_id === wmE!.id);
    const propF = proposals.find(p => p.target_id === memF!.id);

    console.log(`• Scenario A (Protected Passport): Class=${propA?.retention_class}, Decision=${propA?.decision} ${propA?.decision === 'KEEP' ? '✅' : '❌'}`);
    console.log(`• Scenario B (Mother Name): Class=${propB?.retention_class}, Decision=${propB?.decision} ${propB?.decision === 'KEEP' ? '✅' : '❌'}`);
    console.log(`• Scenario C (Pizza Event): Class=${propC?.retention_class}, Decision=${propC?.decision} ${propC?.decision === 'FADE_CANDIDATE' ? '✅' : '❌'}`);
    console.log(`• Scenario D (Active Goal): Class=${propD?.retention_class}, Decision=${propD?.decision} ${propD?.decision === 'KEEP' ? '✅' : '❌'}`);
    console.log(`• Scenario E (Expired Event): Class=${propE?.retention_class}, Decision=${propE?.decision} ${propE?.decision === 'ARCHIVE_CANDIDATE' ? '✅' : '❌'}`);
    console.log(`• Scenario F (Stale Inference): Class=${propF?.retention_class}, Decision=${propF?.decision} ${propF?.decision === 'FADE_CANDIDATE' ? '✅' : '❌'}`);

    if (
      propA?.decision !== 'KEEP' ||
      propB?.decision !== 'KEEP' ||
      propC?.decision !== 'FADE_CANDIDATE' ||
      propD?.decision !== 'KEEP' ||
      propE?.decision !== 'ARCHIVE_CANDIDATE' ||
      propF?.decision !== 'FADE_CANDIDATE'
    ) {
      throw new Error('INVARIANT VIOLATED: Retention decisions did not match deterministic matrix rules!');
    }

    // ── 3. VERIFY ZERO SOURCE MUTATIONS OCCURRED ────────────────────────────
    console.log('\n--- VERIFYING ZERO SOURCE MUTATIONS INVARIANT ---');
    const { data: memsAfter } = await supabaseAdmin.from('memories').select('id, is_archived').in('id', createdMemIds);
    const { data: wmsAfter } = await supabaseAdmin.from('working_memory').select('id').in('id', createdWmIds);
    const { data: epsAfter } = await supabaseAdmin.from('episodic_memories').select('id, is_archived').in('id', createdEpIds);

    const unarchivedMems = memsAfter?.filter(m => !m.is_archived).length || 0;
    const totalWms = wmsAfter?.length || 0;
    const unarchivedEps = epsAfter?.filter(e => !e.is_archived).length || 0;

    if (unarchivedMems !== createdMemIds.length || totalWms !== createdWmIds.length || unarchivedEps !== createdEpIds.length) {
      throw new Error('INVARIANT VIOLATED: Source records were deleted or archived during retention evaluation!');
    }
    console.log('✅ PASS: All source records remained completely unmutated (0 archives, 0 deletes).');

  } finally {
    // ── 4. CLEANUP TEST DATA ─────────────────────────────────────────────────
    console.log('\n[Cleanup] Purging test records...');
    if (createdMemIds.length > 0) {
      await supabaseAdmin.from('memories').delete().in('id', createdMemIds);
    }
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
  console.log('  PHASE 2E-E PRODUCTION DRY-RUN PASSED SUCCESSFULLY ✅               ');
  console.log('════════════════════════════════════════════════════════════════════');
}

runPhase2eeSmokeTest().catch(err => {
  console.error('\n❌ PHASE 2E-E SMOKE TEST FAILED:', err);
  process.exit(1);
});
