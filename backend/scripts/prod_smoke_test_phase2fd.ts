/**
 * prod_smoke_test_phase2fd.ts — Phase 2F-D Temporal Memory Lifecycle Hardening Smoke Test
 *
 * PRODUCTION SAFETY:
 * Uses ONE isolated ephemeral authenticated test user.
 * ZERO destructive memory/source mutations.
 *
 * Scenarios:
 * 1. Historical Employer: "I worked at Google in 2023" -> lifecycle_state: 'HISTORICAL', valid_from: '2023'.
 * 2. Current Employer: "Now I work at OpenAI" -> lifecycle_state: 'CURRENT', valid_from: '2025'.
 * 3. Future Intent: "I'll start my cloud kitchen next month" -> is_future_intent: true, NOT current fact.
 * 4. Temporal Correction: "Actually now I switched to Anthropic" -> OpenAI SUPERSEDED, Anthropic CURRENT, Google HISTORICAL.
 * 5. Retrieval Separation: CURRENT prioritized in durableFacts, HISTORICAL in historicalFacts, SUPERSEDED excluded.
 *
 * Usage:
 *   npx tsx scripts/prod_smoke_test_phase2fd.ts
 */

import { supabaseAdmin } from '../src/lib/supabase';
import { memoryRepository } from '../src/services/memoryRepository';
import { cognitiveContextService } from '../src/services/CognitiveContextService';
import { TemporalParser } from '../src/utils/temporalParser';
import crypto from 'crypto';

interface TestSummaryResult {
  scenario: string;
  passed: boolean;
  notes: string;
}

async function runPhase2fdSmokeTest() {
  console.log('════════════════════════════════════════════════════════════════════');
  console.log('  HUMAN-OS — PHASE 2F-D TEMPORAL MEMORY LIFECYCLE SMOKE TEST         ');
  console.log('════════════════════════════════════════════════════════════════════\n');

  const testResults: TestSummaryResult[] = [];

  // Capture production baselines
  const { count: baselineMemCount } = await supabaseAdmin.from('memories').select('*', { count: 'exact', head: true });
  console.log(`[Baseline] Memories: ${baselineMemCount}\n`);

  // Create isolated ephemeral test user
  const email = `test-phase2fd-${crypto.randomUUID().substring(0, 8)}@humanos.internal`;
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
    preferred_name: 'Phase 2FD Test User',
    country: 'IN',
    timezone: 'Asia/Kolkata',
  });

  try {
    // ══════════════════════════════════════════════════════════════════════
    // SCENARIO 1: HISTORICAL EMPLOYER PERSISTENCE
    // ══════════════════════════════════════════════════════════════════════
    console.log('--- SCENARIO 1: HISTORICAL EMPLOYER PERSISTENCE ---');

    const histUtterance = 'I worked at Google in 2023';
    const parsedHist = TemporalParser.extractTemporalMetadata(histUtterance);
    console.log(`• Parsed: status=${parsedHist.temporalStatus}, validFrom=${parsedHist.validFrom}, precision=${parsedHist.precision}`);

    await memoryRepository.upsertMemory(
      userId,
      {
        type: 'work',
        key: 'company_name',
        value: 'Google',
        importance: 80,
        confidence: 0.95,
        shouldPersist: true,
        lifecycle_state: 'HISTORICAL',
        temporal_status: parsedHist.temporalStatus,
        valid_from: parsedHist.validFrom,
        temporal_precision: parsedHist.precision,
        temporal_metadata: TemporalParser.toMetadata(parsedHist),
      },
      histUtterance
    );

    const { data: histRow } = await supabaseAdmin
      .from('memories')
      .select('id, key, value, lifecycle_state, is_archived')
      .eq('user_id', userId)
      .eq('value', 'Google')
      .single();

    const s1Pass =
      histRow?.lifecycle_state === 'HISTORICAL' &&
      histRow?.is_archived === false &&
      parsedHist.validFrom === '2023';

    if (!s1Pass) throw new Error('Scenario 1 failed: Historical employer not stored cleanly!');
    console.log('• Scenario 1 PASS: Historical fact stored with lifecycle_state=HISTORICAL and valid_from=2023 ✅\n');

    testResults.push({
      scenario: 'Scenario 1: Historical Employer Persistence',
      passed: s1Pass,
      notes: 'Preserved historical employment with year-only precision without date fabrication.',
    });

    // ══════════════════════════════════════════════════════════════════════
    // SCENARIO 2: CURRENT EMPLOYER PERSISTENCE
    // ══════════════════════════════════════════════════════════════════════
    console.log('--- SCENARIO 2: CURRENT EMPLOYER PERSISTENCE ---');

    const currUtterance = 'Now I work at OpenAI';
    const parsedCurr = TemporalParser.extractTemporalMetadata(currUtterance);

    await memoryRepository.upsertMemory(
      userId,
      {
        type: 'work',
        key: 'company_name',
        value: 'OpenAI',
        importance: 90,
        confidence: 0.95,
        shouldPersist: true,
        source_authority: 'explicit_user',
        lifecycle_state: 'CURRENT',
        temporal_status: parsedCurr.temporalStatus,
        temporal_metadata: TemporalParser.toMetadata(parsedCurr),
      },
      currUtterance
    );

    const { data: allRowsAfterCurr } = await supabaseAdmin
      .from('memories')
      .select('id, key, value, lifecycle_state, is_archived')
      .eq('user_id', userId)
      .order('created_at', { ascending: true });

    const googleRow = allRowsAfterCurr?.find(r => r.value === 'Google');
    const openAiRow = allRowsAfterCurr?.find(r => r.value === 'OpenAI');

    const s2Pass =
      googleRow?.lifecycle_state === 'HISTORICAL' &&
      googleRow?.is_archived === false &&
      openAiRow?.lifecycle_state === 'CURRENT' &&
      openAiRow?.is_archived === false;

    if (!s2Pass) throw new Error('Scenario 2 failed: Historical and Current facts failed to coexist!');
    console.log('• Scenario 2 PASS: Current employer OpenAI coexists with Historical Google cleanly ✅\n');

    testResults.push({
      scenario: 'Scenario 2: Current Employer Persistence',
      passed: s2Pass,
      notes: 'Current fact OpenAI active alongside Historical Google with 0 supersession collision.',
    });

    // ══════════════════════════════════════════════════════════════════════
    // SCENARIO 3: FUTURE INTENT HANDLING
    // ══════════════════════════════════════════════════════════════════════
    console.log('--- SCENARIO 3: FUTURE INTENT HANDLING ---');

    const futureUtterance = "I'll start my cloud kitchen next month";
    const parsedFuture = TemporalParser.extractTemporalMetadata(futureUtterance);
    console.log(`• Parsed: isFutureIntent=${parsedFuture.isFutureIntent}, status=${parsedFuture.temporalStatus}`);

    await memoryRepository.upsertMemory(
      userId,
      {
        type: 'goals',
        key: 'project',
        value: 'Cloud Kitchen',
        importance: 75,
        confidence: 0.9,
        shouldPersist: true,
        is_future_intent: parsedFuture.isFutureIntent,
        temporal_status: parsedFuture.temporalStatus,
        temporal_metadata: TemporalParser.toMetadata(parsedFuture),
      },
      futureUtterance
    );

    const { data: futureRow } = await supabaseAdmin
      .from('memories')
      .select('id, key, value, lifecycle_state')
      .eq('user_id', userId)
      .eq('value', 'Cloud Kitchen')
      .single();

    const s3Pass =
      parsedFuture.isFutureIntent === true &&
      futureRow?.lifecycle_state === 'UNKNOWN'; // Never CURRENT

    if (!s3Pass) throw new Error('Scenario 3 failed: Future intent was mistakenly stored as CURRENT!');
    console.log('• Scenario 3 PASS: Future intent stored as UNKNOWN and not as an active CURRENT fact ✅\n');

    testResults.push({
      scenario: 'Scenario 3: Future Intent Handling',
      passed: s3Pass,
      notes: 'Future statement "next month" recognized as future intent and blocked from CURRENT state.',
    });

    // ══════════════════════════════════════════════════════════════════════
    // SCENARIO 4: TEMPORAL SUPERSESSION UPON CORRECTION
    // ══════════════════════════════════════════════════════════════════════
    console.log('--- SCENARIO 4: TEMPORAL SUPERSESSION UPON CORRECTION ---');

    const switchedUtterance = 'Actually now I switched to Anthropic';
    const parsedSwitched = TemporalParser.extractTemporalMetadata(switchedUtterance);

    await memoryRepository.upsertMemory(
      userId,
      {
        type: 'work',
        key: 'company_name',
        value: 'Anthropic',
        importance: 95,
        confidence: 0.95,
        shouldPersist: true,
        source_authority: 'explicit_user',
        correction_intent: true,
        lifecycle_state: 'CURRENT',
        temporal_status: parsedSwitched.temporalStatus,
        temporal_metadata: TemporalParser.toMetadata(parsedSwitched),
      },
      switchedUtterance
    );

    const { data: allFinalRows } = await supabaseAdmin
      .from('memories')
      .select('id, key, value, lifecycle_state, is_archived, superseded_by')
      .eq('user_id', userId);

    const finalGoogle = allFinalRows?.find(r => r.value === 'Google');
    const finalOpenAI = allFinalRows?.find(r => r.value === 'OpenAI');
    const finalAnthropic = allFinalRows?.find(r => r.value === 'Anthropic');

    const s4Pass =
      finalGoogle?.lifecycle_state === 'HISTORICAL' &&
      finalGoogle?.is_archived === false &&
      finalOpenAI?.lifecycle_state === 'SUPERSEDED' &&
      finalOpenAI?.is_archived === true &&
      finalOpenAI?.superseded_by === finalAnthropic?.id &&
      finalAnthropic?.lifecycle_state === 'CURRENT' &&
      finalAnthropic?.is_archived === false;

    if (!s4Pass) throw new Error('Scenario 4 failed: Temporal supersession did not update states correctly!');
    console.log('• Scenario 4 PASS: OpenAI superseded by Anthropic while Google remains HISTORICAL ✅\n');

    testResults.push({
      scenario: 'Scenario 4: Temporal Supersession Upon Correction',
      passed: s4Pass,
      notes: 'OpenAI marked SUPERSEDED and linked to Anthropic; Historical Google untouched.',
    });

    // ══════════════════════════════════════════════════════════════════════
    // SCENARIO 5: CONTEXT RETRIEVAL SEPARATION
    // ══════════════════════════════════════════════════════════════════════
    console.log('--- SCENARIO 5: CONTEXT RETRIEVAL SEPARATION ---');

    const cognitiveCtx = await cognitiveContextService.assembleContext({
      userId,
      effectiveMessage: 'Where do I work now?',
    });

    const durableFacts = cognitiveCtx.memories.durableFacts;
    const historicalFacts = cognitiveCtx.memories.historicalFacts;

    console.log(`• Durable Facts in context: ${durableFacts.map(f => `${f.key}=${f.value}`).join(', ')}`);
    console.log(`• Historical Facts in context: ${historicalFacts.map(f => `${f.key}=${f.value}`).join(', ')}`);

    const hasAnthropicInDurable = durableFacts.some(f => f.value === 'Anthropic');
    const hasOpenAiInDurable = durableFacts.some(f => f.value === 'OpenAI');
    const hasGoogleInHistorical = historicalFacts.some(f => f.value === 'Google');

    const s5Pass =
      hasAnthropicInDurable &&
      !hasOpenAiInDurable &&
      hasGoogleInHistorical;

    if (!s5Pass) throw new Error('Scenario 5 failed: Retrieval failed to separate current vs historical facts!');
    console.log('• Scenario 5 PASS: Context retrieval prioritized Anthropic as CURRENT, separated Google as HISTORICAL, and excluded SUPERSEDED OpenAI ✅\n');

    testResults.push({
      scenario: 'Scenario 5: Context Retrieval Separation',
      passed: s5Pass,
      notes: 'CURRENT truth prioritized, HISTORICAL segregated into historical context, SUPERSEDED excluded.',
    });

  } finally {
    // ══════════════════════════════════════════════════════════════════════
    // CLEANUP EPHEMERAL TEST USER ONLY
    // ══════════════════════════════════════════════════════════════════════
    console.log('--- CLEANING UP EPHEMERAL TEST RECORDS ---');
    await supabaseAdmin.from('memories').delete().eq('user_id', userId);
    await supabaseAdmin.from('profiles').delete().eq('id', userId);

    try {
      await supabaseAdmin.auth.admin.deleteUser(userId);
      console.log(`• Ephemeral auth user ${userId} purged cleanly ✅`);
    } catch (purgeErr: any) {
      console.warn(`• Notice during auth user delete: ${purgeErr?.message}`);
    }

    // Baseline check
    const { count: finalMemCount } = await supabaseAdmin.from('memories').select('*', { count: 'exact', head: true });
    console.log(`\n• Final Memories: ${finalMemCount} (baseline: ${baselineMemCount}) ${finalMemCount === baselineMemCount ? '✅' : '❌'}`);
  }

  console.log('\n════════════════════════════════════════════════════════════════════');
  console.log('  PHASE 2F-D SMOKE TEST RESULTS SUMMARY                             ');
  console.log('════════════════════════════════════════════════════════════════════');
  for (const r of testResults) {
    console.log(`[${r.passed ? 'PASS' : 'FAIL'}] ${r.scenario}`);
    console.log(`       ${r.notes}`);
  }

  const allPassed = testResults.every(r => r.passed);
  if (!allPassed) {
    throw new Error('One or more Phase 2F-D smoke test scenarios failed.');
  }

  console.log('\n✅ ALL PHASE 2F-D PRODUCTION SMOKE TESTS PASSED CLEANLY.\n');
}

runPhase2fdSmokeTest().catch(err => {
  console.error('\n❌ Smoke test failed with exception:', err);
  process.exit(1);
});
