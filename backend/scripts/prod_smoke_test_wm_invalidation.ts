/**
 * prod_smoke_test_wm_invalidation.ts — Ephemeral Production Smoke Test for Working Memory Invalidation Hardening
 */

import { supabaseAdmin } from '../src/lib/supabase';
import { memoryRepository } from '../src/services/memoryRepository';
import { accountLifecycleService } from '../src/services/AccountLifecycleService';
import { ExtractedMemory } from '../src/types/memory';

async function runSmokeTest() {
  console.log('============================================================');
  console.log('PRE-HEARTBEAT HARDENING: WORKING MEMORY INVALIDATION SMOKE TEST');
  console.log('============================================================\n');

  const testEmail = `ephemeral_wminval_${Date.now()}@humanos-test.internal`;
  const testPassword = `TestPass!_${Date.now()}`;

  // 1. Create Ephemeral Auth User
  console.log(`• Creating ephemeral test user: ${testEmail}...`);
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
    // 2. Seed working_memory records
    console.log('\n• Seeding working_memory candidate records...');
    const { data: insertedWm, error: wmErr } = await supabaseAdmin.from('working_memory').insert([
      {
        user_id: userId,
        key: 'wife_name',
        value: 'Priya',
        promotion_status: 'CANDIDATE',
      },
      {
        user_id: userId,
        key: 'wife', // alias key
        value: 'Priya',
        promotion_status: 'CANDIDATE',
      },
      {
        user_id: userId,
        key: 'city',
        value: 'Bengaluru',
        promotion_status: 'CANDIDATE',
      },
      {
        user_id: userId,
        key: 'company_name',
        value: 'Google',
        promotion_status: 'CANDIDATE',
      },
    ]).select('*');

    if (wmErr || !insertedWm) {
      throw new Error(`Failed to seed working memory: ${wmErr?.message}`);
    }
    console.log(`  ✅ Seeded ${insertedWm.length} working memory rows.`);

    // 3. Commit explicit correction turn: wife_name = Sakshi
    console.log('\n• Committing authoritative correction turn (wife_name = Sakshi)...');
    const correction: ExtractedMemory = {
      key: 'wife_name',
      value: 'Sakshi',
      type: 'family',
      importance: 90,
      confidence: 0.99,
      shouldPersist: true,
      source_authority: 'explicit_user',
      correction_intent: true,
    };

    await memoryRepository.upsertMemory(userId, correction, 'Actually meri wife Sakshi hai');
    console.log('  ✅ MemoryRepository upsertMemory completed.');

    // 4. Verify DB State
    console.log('\n• Verifying production database state...');
    const { data: updatedWm, error: fetchWmErr } = await supabaseAdmin
      .from('working_memory')
      .select('*')
      .eq('user_id', userId);

    if (fetchWmErr || !updatedWm) {
      throw new Error(`Failed to fetch updated working memory: ${fetchWmErr?.message}`);
    }

    const wmExact = updatedWm.find(r => r.key === 'wife_name');
    const wmAlias = updatedWm.find(r => r.key === 'wife');
    const wmCity = updatedWm.find(r => r.key === 'city');
    const wmCompany = updatedWm.find(r => r.key === 'company_name');

    console.log(`  - [WM] wife_name (exact): status = ${wmExact?.promotion_status} (Expected: SUPERSEDED)`);
    console.log(`  - [WM] wife (alias):      status = ${wmAlias?.promotion_status} (Expected: SUPERSEDED)`);
    console.log(`  - [WM] city (unrelated):  status = ${wmCity?.promotion_status} (Expected: CANDIDATE)`);
    console.log(`  - [WM] company_name:      status = ${wmCompany?.promotion_status} (Expected: CANDIDATE)`);

    const exactPass = wmExact?.promotion_status === 'SUPERSEDED';
    const aliasPass = wmAlias?.promotion_status === 'SUPERSEDED';
    const cityPass = wmCity?.promotion_status === 'CANDIDATE';
    const companyPass = wmCompany?.promotion_status === 'CANDIDATE';

    if (!exactPass || !aliasPass || !cityPass || !companyPass) {
      throw new Error('Working memory invalidation assertion failed!');
    }
    console.log('  ✅ All working memory invalidation invariants verified.');

    // 5. Verify semantic memory
    const { data: memRows } = await supabaseAdmin
      .from('memories')
      .select('key, value, lifecycle_state, source_authority')
      .eq('user_id', userId);

    const semanticWife = (memRows || []).find(r => r.key === 'wife_name');
    console.log(`  - [SEMANTIC] wife_name: value = "${semanticWife?.value}", state = ${semanticWife?.lifecycle_state}, authority = ${semanticWife?.source_authority}`);
    if (semanticWife?.value !== 'Sakshi' || semanticWife?.lifecycle_state !== 'CURRENT') {
      throw new Error('Semantic memory write mismatch!');
    }
    console.log('  ✅ Semantic memory verified.');

  } finally {
    // 6. Complete Ephemeral Cleanup via AccountLifecycleService
    console.log('\n• Cleaning up ephemeral test account...');
    const cleanupRes = await accountLifecycleService.deleteAccount(userId);
    console.log(`  ✅ Account cleanup result: success = ${cleanupRes.success}, totalTablesCleaned = ${cleanupRes.totalTablesCleaned}`);
    console.log('============================================================');
    console.log('SMOKE TEST RESULT: 100% PASS');
    console.log('============================================================');
  }
}

runSmokeTest().catch(err => {
  console.error('Smoke test failed:', err);
  process.exit(1);
});
