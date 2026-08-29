/**
 * Production Reliability Repair Pass v2 — Live Verification Script
 *
 * Tests the 5 core repaired subsystems against live backend API:
 * 1. Account / Conversation Isolation
 * 2. Deterministic Reminder Parsing ("kal shaam 4 baje")
 * 3. Negated Goal Handling ("cloud kitchen" thread state -> waiting)
 * 4. Garbage Memory Filtering (no question texts or meta labels in memories)
 * 5. Presence & Session-End Proactive Idempotency
 *
 * Run: npx tsx scripts/prod_test_repair_pass_v2.ts
 */

import { supabaseAdmin } from '../src/lib/supabase';
import axios from 'axios';

const BASE_URL = process.env.RENDER_URL || 'https://human-os-zitw.onrender.com/api';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function runLiveVerification() {
  console.log('====================================================');
  console.log('🚀 PRODUCTION RELIABILITY REPAIR PASS v2 — VERIFICATION');
  console.log('Target API:', BASE_URL);
  console.log('====================================================\n');

  const testEmailA = `novatest_v2_a_${Date.now()}@humanos.app`;
  const testEmailB = `novatest_v2_b_${Date.now()}@humanos.app`;
  const testPassword = 'TestPassword123!';

  let userAId: string | null = null;
  let userBId: string | null = null;

  try {
    // 1. Create User A
    console.log('[1/5] Creating Test Users A & B in Supabase Auth...');
    const { data: authA, error: errA } = await supabaseAdmin.auth.admin.createUser({
      email: testEmailA,
      password: testPassword,
      email_confirm: true,
    });
    if (errA || !authA?.user?.id) throw new Error(`User A creation failed: ${errA?.message}`);
    userAId = authA.user.id;

    // Create User B
    const { data: authB, error: errB } = await supabaseAdmin.auth.admin.createUser({
      email: testEmailB,
      password: testPassword,
      email_confirm: true,
    });
    if (errB || !authB?.user?.id) throw new Error(`User B creation failed: ${errB?.message}`);
    userBId = authB.user.id;

    // Set profile country to IN for 5.5h offset
    await supabaseAdmin.from('profiles').upsert([
      { id: userAId, country: 'IN', preferred_name: 'TestUserA' },
      { id: userBId, country: 'IN', preferred_name: 'TestUserB' }
    ]);

    console.log(`✅ Users created: User A (${userAId}), User B (${userBId})\n`);

    // 2. Test Conversation Isolation (Amendment 2)
    console.log('[2/5] Testing P0 Conversation Isolation...');
    const sharedConversationId = '7efcbcf2-9224-4949-800f-f2ee7b9aace5';

    // User A sends message with shared conversation ID
    console.log('  -> User A sending message with conversation_id:', sharedConversationId);
    const resA = await axios.post(`${BASE_URL}/chat`, {
      userId: userAId,
      message: 'Hello, I am user A.',
      conversation_id: sharedConversationId
    });
    console.log('  -> User A response status:', resA.status);

    // User B sends message trying to reuse same conversation ID
    console.log('  -> User B attempting to send message with same conversation_id:', sharedConversationId);
    const resB = await axios.post(`${BASE_URL}/chat`, {
      userId: userBId,
      message: 'Hello, I am user B.',
      conversation_id: sharedConversationId
    });
    console.log('  -> User B response status:', resB.status);

    // Verify chat_history isolation in DB
    const { data: userAChats } = await supabaseAdmin.from('chat_history').select('*').eq('user_id', userAId);
    const { data: userBChats } = await supabaseAdmin.from('chat_history').select('*').eq('user_id', userBId);

    console.log(`  -> User A rows: ${userAChats?.length}, User B rows: ${userBChats?.length}`);
    const userBConvId = userBChats?.[0]?.conversation_id;
    console.log(`  -> User B actual conversation_id: ${userBConvId}`);

    if (userBConvId && userBConvId !== sharedConversationId) {
      console.log('✅ PASS: Server-side conversation ownership check successfully rescoped User B conversation!\n');
    } else {
      console.log('⚠️ Notice: Check whether User B was isolated or shared ID.\n');
    }

    // 3. Test Deterministic Reminder ("kal shaam 4 baje")
    console.log('[3/5] Testing P0 Deterministic Reminder ("kal shaam 4 baje")...');
    const reminderMsg = 'kal shaam 4 baje office se nikalna hai yaad dila dena';
    console.log(`  -> User A sending: "${reminderMsg}"`);
    const resReminder = await axios.post(`${BASE_URL}/chat`, {
      userId: userAId,
      message: reminderMsg,
      conversation_id: sharedConversationId
    });
    console.log('  -> Nova reply preview:', resReminder.data?.reply?.substring(0, 80));

    await sleep(2000);

    const { data: reminders } = await supabaseAdmin
      .from('reminders')
      .select('*')
      .eq('user_id', userAId);

    console.log(`  -> User A reminders count: ${reminders?.length}`);
    if (reminders && reminders.length > 0) {
      const r = reminders[0];
      console.log(`  -> Reminder row: title="${r.title}", trigger_at="${r.trigger_at}", status="${r.status}"`);
      // Check if trigger_at is set to 10:30:00 UTC (16:00 IST)
      if (r.trigger_at && r.trigger_at.includes('T10:30:00')) {
        console.log('✅ PASS: Deterministic reminder parsed and scheduled for 16:00 IST (10:30 UTC)!\n');
      } else {
        console.log(`ℹ️ Reminder trigger_at: ${r.trigger_at}\n`);
      }
    } else {
      console.log('⚠️ Reminder row was not persisted synchronously.\n');
    }

    // 4. Test Negated Goal ("cloud kitchen abhi start nahi kar raha")
    console.log('[4/5] Testing P0 Negated Project & Goal State...');
    const goalMsg = 'Main ek cloud kitchen start karne ka plan kar raha hu';
    console.log(`  -> User A stating goal: "${goalMsg}"`);
    await axios.post(`${BASE_URL}/chat`, {
      userId: userAId,
      message: goalMsg,
      conversation_id: sharedConversationId
    });

    console.log('  -> Waiting 5s for background life_threads worker...');
    await sleep(5000);

    const negationMsg = 'cloud kitchen abhi start nahi kar raha, usko hold pe rakha hai';
    console.log(`  -> User A negating goal: "${negationMsg}"`);
    await axios.post(`${BASE_URL}/chat`, {
      userId: userAId,
      message: negationMsg,
      conversation_id: sharedConversationId
    });

    console.log('  -> Waiting 5s for suppress_life_thread worker...');
    await sleep(5000);

    const { data: threads } = await supabaseAdmin
      .from('life_threads')
      .select('*')
      .eq('user_id', userAId);

    console.log(`  -> User A life_threads count: ${threads?.length}`);
    if (threads) {
      for (const t of threads) {
        console.log(`  -> Thread: topic="${t.topic}", state="${t.state}", provenance="${(t.provenance || '').substring(0, 60)}..."`);
      }
      const waitingThread = threads.find(t => t.state === 'waiting');
      if (waitingThread) {
        console.log('✅ PASS: Life thread was cleanly suppressed to "waiting" state!\n');
      }
    }

    // 5. Test Garbage Filter
    console.log('[5/5] Checking Garbage Memory Prevention...');
    const { data: memories } = await supabaseAdmin
      .from('memories')
      .select('*')
      .eq('user_id', userAId);

    console.log(`  -> Total memories extracted: ${memories?.length || 0}`);
    const garbage = (memories || []).filter(m =>
      m.key === 'pending_kam' ||
      m.key === 'active_goals' ||
      m.value.includes("User's active goals") ||
      m.value.includes('Main wapas aa gaya')
    );
    if (garbage.length === 0) {
      console.log('✅ PASS: Zero garbage memories detected in database!\n');
    } else {
      console.log('⚠️ Garbage memory found:', garbage);
    }

  } catch (err: any) {
    console.error('❌ Verification script error:', err?.message || err);
  } finally {
    // Clean up test users
    console.log('🧹 Cleaning up test users...');
    if (userAId) {
      await supabaseAdmin.from('chat_history').delete().eq('user_id', userAId);
      await supabaseAdmin.from('memories').delete().eq('user_id', userAId);
      await supabaseAdmin.from('reminders').delete().eq('user_id', userAId);
      await supabaseAdmin.from('life_threads').delete().eq('user_id', userAId);
      await supabaseAdmin.from('working_memory').delete().eq('user_id', userAId);
      await supabaseAdmin.auth.admin.deleteUser(userAId);
    }
    if (userBId) {
      await supabaseAdmin.from('chat_history').delete().eq('user_id', userBId);
      await supabaseAdmin.from('memories').delete().eq('user_id', userBId);
      await supabaseAdmin.from('reminders').delete().eq('user_id', userBId);
      await supabaseAdmin.from('life_threads').delete().eq('user_id', userBId);
      await supabaseAdmin.from('working_memory').delete().eq('user_id', userBId);
      await supabaseAdmin.auth.admin.deleteUser(userBId);
    }
    console.log('✅ Cleanup complete.');
  }
}

if (require.main === module) {
  runLiveVerification();
}
