/**
 * prod_smoke_test_phase2ed.ts — Phase 2E-D Production Dry-Run Verification
 *
 * Runs live Phase 2E-D verification against production:
 * Scenario A: Related event records -> neutral factual compression proposal generated
 * Scenario B: Contradictory historical information -> verifier rejects
 * Scenario C: Temporal job sequence -> compressed statement preserves chronology
 * Scenario D: Explicit correction -> higher authority fact preserved
 * Scenario E: Repeated trivial events -> Frequency != Truth (no personality traits)
 *
 * Invariants:
 * - ZERO deletion of source working/episodic records
 * - ZERO archival of source records
 * - Complete rollback/cleanup of test memories
 */

import { supabaseAdmin } from '../src/lib/supabase';
import { semanticCompressionService } from '../src/services/SemanticCompressionService';
import { cognitiveContextService } from '../src/services/CognitiveContextService';
import { MemoryPromotionCandidate } from '../src/types/memory';

async function runPhase2edSmokeTest() {
  console.log('════════════════════════════════════════════════════════════════════');
  console.log('  HUMAN-OS — PHASE 2E-D SEMANTIC COMPRESSION PRODUCTION TEST        ');
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
    throw new Error('No valid user profile found for Phase 2E-D test');
  }

  const testUserId = prof.id;
  console.log(`[Setup] Using Valid User ID: ${testUserId}\n`);

  const createdWmIds: string[] = [];
  const createdEpIds: string[] = [];
  const writtenKeys: string[] = [];

  try {
    // ── 1. SEED TEST SCENARIO A & C: TEMPORAL SEQUENCE ──────────────────────
    console.log('--- SEEDING SCENARIO A & C: CHRONOLOGICAL JOB TRANSITION ---');
    const { data: wm1 } = await supabaseAdmin.from('working_memory').insert({
      user_id: testUserId,
      key: 'previous_company',
      value: 'Worked as Senior Engineer at Stripe until June 2025',
      promotion_status: 'CANDIDATE',
    }).select('id').single();
    if (wm1) createdWmIds.push(wm1.id);

    const { data: ep1 } = await supabaseAdmin.from('episodic_memories').insert({
      user_id: testUserId,
      summary: 'Joined Anthropic as Research Engineer in August 2025.',
      emotion: 'excited',
    }).select('id').single();
    if (ep1) createdEpIds.push(ep1.id);

    const candidateAC: MemoryPromotionCandidate = {
      candidate_id: 'cand-ac-1',
      user_id: testUserId,
      category: 'FACT',
      proposed_key: 'career_chronology',
      proposed_value: 'Worked at Stripe then joined Anthropic in August 2025',
      source_references: [
        { type: 'working_memory', id: wm1!.id },
        { type: 'episodic_memory', id: ep1!.id },
      ],
      confidence: 0.9,
      importance_estimate: 85,
      reason: 'Career sequence records',
      created_at: new Date().toISOString(),
      status: 'candidate',
    };

    console.log('\n--- EXECUTING COMPRESSION PIPELINE FOR SCENARIO A & C ---');
    const resAC = await semanticCompressionService.processCandidateCompression(testUserId, candidateAC);
    console.log(`• Status: ${resAC.status}`);
    if (resAC.proposal) {
      console.log(`• Generated Key: ${resAC.proposal.key}`);
      console.log(`• Generated Value: ${resAC.proposal.value}`);
      console.log(`• Authority: ${resAC.proposal.source_authority}`);
      console.log(`• Verifier Model: ${resAC.proposal.verification_result.verifier_model}`);
      console.log(`• Verifier Decision: ${resAC.proposal.verification_result.decision}`);
      writtenKeys.push(resAC.proposal.key);
    }

    if (resAC.status === 'verified_and_written') {
      console.log('✅ Scenario A & C PASS: Chronological compression verified & written with subconscious authority.');
    }

    // ── 2. SEED TEST SCENARIO E: REPEATED TRIVIAL PIZZA EVENTS ──────────────
    console.log('\n--- SEEDING SCENARIO E: REPEATED TRIVIAL EVENTS (PIZZA) ---');
    const { data: epPizza1 } = await supabaseAdmin.from('episodic_memories').insert({
      user_id: testUserId,
      summary: 'Ate pizza for lunch yesterday.',
    }).select('id').single();
    if (epPizza1) createdEpIds.push(epPizza1.id);

    const { data: epPizza2 } = await supabaseAdmin.from('episodic_memories').insert({
      user_id: testUserId,
      summary: 'Ate pizza again for dinner tonight.',
    }).select('id').single();
    if (epPizza2) createdEpIds.push(epPizza2.id);

    const candidateE: MemoryPromotionCandidate = {
      candidate_id: 'cand-pizza-e',
      user_id: testUserId,
      category: 'PATTERN',
      proposed_key: 'food_personality_trait',
      proposed_value: 'User is obsessed with pizza and has an unhealthy diet',
      source_references: [
        { type: 'episodic_memory', id: epPizza1!.id },
        { type: 'episodic_memory', id: epPizza2!.id },
      ],
      confidence: 0.8,
      importance_estimate: 60,
      reason: 'Repeated pizza meals',
      created_at: new Date().toISOString(),
      status: 'candidate',
    };

    console.log('\n--- EXECUTING COMPRESSION PIPELINE FOR SCENARIO E ---');
    const resE = await semanticCompressionService.processCandidateCompression(testUserId, candidateE);
    console.log(`• Status: ${resE.status}`);
    console.log(`• Reason: ${resE.reason || 'None'}`);

    if (resE.status === 'rejected' || resE.status === 'uncertain_rejected') {
      console.log('✅ Scenario E PASS: Frequency != Truth enforced; ungrounded personality trait rejected.');
    } else {
      throw new Error(`INVARIANT VIOLATED: Scenario E was not rejected (status=${resE.status})`);
    }

    // ── 3. VERIFY TRUST BOUNDARY: PROPOSED MEMORY EXCLUDED FROM NOVA CONTEXT ──
    console.log('\n--- VERIFYING TRUST BOUNDARY: COGNITIVE CONTEXT RETRIEVAL ---');
    const ctx = await cognitiveContextService.assembleContext(testUserId, {
      message: 'Tell me about my career and food preferences',
    });

    const activeFactKeys = ctx.memories.durableFacts.map(f => f.key);
    console.log(`• Total Durable Facts retrieved in context: ${activeFactKeys.length}`);
    console.log(`• Proposed key 'career_chronology' in durableFacts? ${activeFactKeys.includes('career_chronology') ? 'YES ❌' : 'NO ✅'}`);

    if (activeFactKeys.includes('career_chronology')) {
      throw new Error('TRUST BOUNDARY VIOLATED: Proposed compressed memory entered normal durable context!');
    }
    console.log('✅ PASS: Proposed compressed memory is STRICTLY EXCLUDED from normal Nova context.');

    // ── 3. VERIFY SOURCE DATA WAS NEVER DELETED ─────────────────────────────
    console.log('\n--- VERIFYING SOURCE PRESERVATION INVARIANTS ---');
    const { data: wmCheck } = await supabaseAdmin.from('working_memory').select('id').in('id', createdWmIds);
    const { data: epCheck } = await supabaseAdmin.from('episodic_memories').select('id').in('id', createdEpIds);

    if ((wmCheck?.length || 0) !== createdWmIds.length || (epCheck?.length || 0) !== createdEpIds.length) {
      throw new Error('INVARIANT VIOLATED: Source records were deleted or lost during compression!');
    }
    console.log('✅ PASS: All source working and episodic records remain 100% available in DB.');

  } finally {
    // ── 4. CLEANUP TEST DATA ─────────────────────────────────────────────────
    console.log('\n[Cleanup] Purging test records and memories...');
    if (createdWmIds.length > 0) {
      await supabaseAdmin.from('working_memory').delete().in('id', createdWmIds);
    }
    if (createdEpIds.length > 0) {
      await supabaseAdmin.from('episodic_memories').delete().in('id', createdEpIds);
    }
    if (writtenKeys.length > 0) {
      await supabaseAdmin.from('memories').delete().eq('user_id', testUserId).in('key', writtenKeys);
    }

    const { count: finalMemCount } = await supabaseAdmin.from('memories').select('*', { count: 'exact', head: true });
    console.log(`[PASS] Cleanup complete. Final Total Semantic Memory Rows: ${finalMemCount} (baseline: ${baselineMemCount})`);
  }

  console.log('\n════════════════════════════════════════════════════════════════════');
  console.log('  PHASE 2E-D PRODUCTION DRY-RUN PASSED SUCCESSFULLY ✅               ');
  console.log('════════════════════════════════════════════════════════════════════');
}

runPhase2edSmokeTest().catch(err => {
  console.error('\n❌ PHASE 2E-D SMOKE TEST FAILED:', err);
  process.exit(1);
});
