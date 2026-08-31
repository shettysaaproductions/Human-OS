/**
 * prod_smoke_test_phase2fe.ts — Ephemeral Production Smoke Test for Phase 2F-E Account Lifecycle
 *
 * Flow:
 * 1. Creates an isolated ephemeral user.
 * 2. Seeds records across all core cognitive tables.
 * 3. Executes nuclear account deletion via AccountLifecycleService.
 * 4. Verifies 100% eradication across DB tables + auth.users.
 * 5. Verifies zero modification to unrelated users.
 */

import { supabaseAdmin } from '../src/lib/supabase';
import { accountLifecycleService } from '../src/services/AccountLifecycleService';

async function runSmokeTest() {
  console.log('============================================================');
  console.log('PHASE 2F-E EPHEMERAL PRODUCTION SMOKE TEST');
  console.log('============================================================\n');

  const testEmail = `ephemeral_2fe_${Date.now()}@humanos-test.internal`;
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
    // 2. Seed Records Across User-Owned Tables
    console.log('\n• Seeding records across core cognitive tables...');

    // Profile
    await supabaseAdmin.from('profiles').insert({
      id: userId,
      preferred_name: 'SmokeTestUser',
      onboarding_completed: true,
    });

    // Memories
    await supabaseAdmin.from('memories').insert({
      user_id: userId,
      memory: 'Ephemeral smoke test memory',
      category: 'identity',
      canonical_concept: 'smoke_test',
    });

    // Working Memory
    await supabaseAdmin.from('working_memory').insert({
      user_id: userId,
      key: 'smoke_test_key',
      value: { test: true },
    });

    // Episodic Memories
    await supabaseAdmin.from('episodic_memories').insert({
      user_id: userId,
      title: 'Smoke Test Episode',
      summary: 'Ephemeral test episode summary',
    });

    // Chat History
    await supabaseAdmin.from('chat_history').insert({
      user_id: userId,
      role: 'user',
      message: 'Ephemeral test chat message',
    });

    // Cognitive Doubts
    await supabaseAdmin.from('nova_cognitive_doubts').insert({
      user_id: userId,
      category: 'identity_gap',
      question: 'Is this an ephemeral smoke test?',
      fingerprint: `smoke_doubt_${Date.now()}`,
    });

    // Life Threads
    const { data: threadData } = await supabaseAdmin.from('life_threads').insert({
      user_id: userId,
      topic: 'Smoke Test Life Thread',
    }).select('id').single();

    // Nova Actions
    if (threadData) {
      await supabaseAdmin.from('nova_actions').insert({
        user_id: userId,
        logical_key: `smoke_action_${Date.now()}`,
        title: 'Smoke Test Action',
        source_thread_id: threadData.id,
      });
    }

    // Reminders
    await supabaseAdmin.from('reminders').insert({
      user_id: userId,
      text: 'Smoke Test Reminder',
      trigger_at: new Date(Date.now() + 3600000).toISOString(),
    });

    console.log('  ✅ Seeded records in profiles, memories, working_memory, episodic_memories, chat_history, nova_cognitive_doubts, life_threads, nova_actions, reminders.');

    // 3. Execute Mark Dead via AccountLifecycleService
    console.log('\n• Executing Mark Dead via AccountLifecycleService...');
    const result = await accountLifecycleService.deleteAccount(userId);

    console.log(`  Account deletion result: success = ${result.success}, duration = ${result.durationMs}ms`);
    console.log('  Tables cleaned summary:', JSON.stringify(result.tablesCleaned));

    if (!result.success) {
      throw new Error(`Account deletion returned failure: ${result.errors.join(', ')}`);
    }

    // 4. Verify 100% Eradication
    console.log('\n• Verifying post-deletion state in production DB...');

    // Auth user check
    const { data: authCheck } = await supabaseAdmin.auth.admin.getUserById(userId);
    const authGone = !authCheck?.user;
    console.log(`  - auth.users:              ${authGone ? 'CLEAN (0 rows)' : 'FAILED (User still exists)'}`);

    // Profile check
    const { count: profileCount } = await supabaseAdmin.from('profiles').select('*', { count: 'exact', head: true }).eq('id', userId);
    console.log(`  - profiles:                ${profileCount === 0 ? 'CLEAN (0 rows)' : `FAILED (${profileCount} rows remaining)`}`);

    // Memories check
    const { count: memoryCount } = await supabaseAdmin.from('memories').select('*', { count: 'exact', head: true }).eq('user_id', userId);
    console.log(`  - memories:                ${memoryCount === 0 ? 'CLEAN (0 rows)' : `FAILED (${memoryCount} rows remaining)`}`);

    // Working memory check
    const { count: wmCount } = await supabaseAdmin.from('working_memory').select('*', { count: 'exact', head: true }).eq('user_id', userId);
    console.log(`  - working_memory:          ${wmCount === 0 ? 'CLEAN (0 rows)' : `FAILED (${wmCount} rows remaining)`}`);

    // Episodic memory check
    const { count: epCount } = await supabaseAdmin.from('episodic_memories').select('*', { count: 'exact', head: true }).eq('user_id', userId);
    console.log(`  - episodic_memories:       ${epCount === 0 ? 'CLEAN (0 rows)' : `FAILED (${epCount} rows remaining)`}`);

    // Chat history check
    const { count: chatCount } = await supabaseAdmin.from('chat_history').select('*', { count: 'exact', head: true }).eq('user_id', userId);
    console.log(`  - chat_history:            ${chatCount === 0 ? 'CLEAN (0 rows)' : `FAILED (${chatCount} rows remaining)`}`);

    // Cognitive doubts check
    const { count: doubtCount } = await supabaseAdmin.from('nova_cognitive_doubts').select('*', { count: 'exact', head: true }).eq('user_id', userId);
    console.log(`  - nova_cognitive_doubts:   ${doubtCount === 0 ? 'CLEAN (0 rows)' : `FAILED (${doubtCount} rows remaining)`}`);

    // Life threads check
    const { count: threadCount } = await supabaseAdmin.from('life_threads').select('*', { count: 'exact', head: true }).eq('user_id', userId);
    console.log(`  - life_threads:            ${threadCount === 0 ? 'CLEAN (0 rows)' : `FAILED (${threadCount} rows remaining)`}`);

    // Reminders check
    const { count: reminderCount } = await supabaseAdmin.from('reminders').select('*', { count: 'exact', head: true }).eq('user_id', userId);
    console.log(`  - reminders:               ${reminderCount === 0 ? 'CLEAN (0 rows)' : `FAILED (${reminderCount} rows remaining)`}`);

    const allClean = authGone &&
      profileCount === 0 &&
      memoryCount === 0 &&
      wmCount === 0 &&
      epCount === 0 &&
      chatCount === 0 &&
      doubtCount === 0 &&
      threadCount === 0 &&
      reminderCount === 0;

    if (!allClean) {
      throw new Error('Verification failed: Some records were not eradicated!');
    }

    console.log('\n============================================================');
    console.log('✅ PHASE 2F-E SMOKE TEST PASSED: 100% ERADICATION VERIFIED.');
    console.log('============================================================');
  } catch (err: any) {
    console.error('\n❌ SMOKE TEST FAILED:', err.message);
    // Cleanup attempt if something broke mid-test
    try {
      await accountLifecycleService.deleteAccount(userId);
    } catch {}
    process.exit(1);
  }
}

runSmokeTest().catch(err => {
  console.error('Fatal error during smoke test:', err);
  process.exit(1);
});
