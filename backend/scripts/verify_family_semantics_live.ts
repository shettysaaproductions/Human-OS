import axios from 'axios';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '../.env') });

const RENDER_URL = process.env.RENDER_EXTERNAL_URL || 'https://human-os.onrender.com';
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function runVerification() {
  console.log('====================================================');
  console.log('LIVE PRODUCTION VERIFICATION: BUG A & BUG B');
  console.log('====================================================');
  console.log(`Render URL: ${RENDER_URL}`);

  // 1. Health checks
  try {
    const healthRes = await axios.get(`${RENDER_URL}/health`, { timeout: 15000 });
    console.log(`HEALTH: ${healthRes.status} (SHA: ${healthRes.data?.git_commit || healthRes.data?.sha || 'unknown'})`);
    
    const readyRes = await axios.get(`${RENDER_URL}/health/ready`, { timeout: 15000 });
    console.log(`READY: ${readyRes.data?.status || readyRes.status}`);

    const cogRes = await axios.get(`${RENDER_URL}/api/health/cognitive`, { timeout: 15000 });
    console.log(`COGNITIVE: ${cogRes.data?.status || cogRes.status}`);
  } catch (err: any) {
    console.error('Failed health check:', err.message);
  }

  // 2. Create ephemeral test user
  const ephemeralEmail = `family_test_${Date.now()}@humanos.internal`;
  const ephemeralPassword = `TestPass!_${Date.now()}`;
  console.log(`\nCreating ephemeral user: ${ephemeralEmail}`);

  const { data: authData, error: authError } = await supabase.auth.admin.createUser({
    email: ephemeralEmail,
    password: ephemeralPassword,
    email_confirm: true
  });

  if (authError || !authData.user) {
    console.error('Failed to create ephemeral user:', authError);
    return;
  }

  const testUserId = authData.user.id;
  console.log(`User created. ID: ${testUserId}`);

  try {
    // Authenticate user to get session token
    const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
      email: ephemeralEmail,
      password: ephemeralPassword
    });

    if (signInError || !signInData.session) {
      throw new Error(`Failed to sign in ephemeral user: ${signInError?.message}`);
    }

    const token = signInData.session.access_token;
    const authHeaders = { Authorization: `Bearer ${token}` };

    // ── Turn 1: Initial ambiguous statement ─────────────────────────────────
    console.log('\n--- Turn 1: "Mere bete ka naam Tiku hai" ---');
    const msg1Res = await axios.post(
      `${RENDER_URL}/api/chat`,
      {
        message: 'Mere bete ka naam Tiku hai',
        conversation_id: `00000000-0000-0000-0000-${String(Date.now()).padStart(12, '0').slice(-12)}`
      },
      { headers: authHeaders, timeout: 35000 }
    );
    console.log(`Turn 1 reply: ${msg1Res.data?.reply || msg1Res.data?.message || JSON.stringify(msg1Res.data)}`);

    // Wait 5s for background agent / DB writes
    await new Promise(r => setTimeout(r, 5000));

    const { data: memsTurn1 } = await supabase
      .from('memories')
      .select('*')
      .eq('user_id', testUserId);

    console.log('DB Memories after Turn 1:');
    console.table(memsTurn1?.map(m => ({ id: m.id, key: m.key, value: m.value, is_archived: m.is_archived })));

    // ── Turn 2: Explicit clarification ──────────────────────────────────────
    console.log('\n--- Turn 2: "I mean real name Shreshth hai, pyar se nickname Tiku rakha hai" ---');
    const msg2Res = await axios.post(
      `${RENDER_URL}/api/chat`,
      {
        message: 'I mean real name Shreshth hai, pyar se nickname Tiku rakha hai',
        conversation_id: `00000000-0000-0000-0000-${String(Date.now()).padStart(12, '0').slice(-12)}`
      },
      { headers: authHeaders, timeout: 35000 }
    );
    console.log(`Turn 2 reply: ${msg2Res.data?.reply || msg2Res.data?.message || JSON.stringify(msg2Res.data)}`);

    // Wait 5s for background agent / DB writes
    await new Promise(r => setTimeout(r, 5000));

    const { data: memsTurn2 } = await supabase
      .from('memories')
      .select('*')
      .eq('user_id', testUserId);

    console.log('DB Memories after Turn 2:');
    console.table(memsTurn2?.map(m => ({ id: m.id, key: m.key, value: m.value, is_archived: m.is_archived })));

    // ── Turn 3: Analytics /memories endpoint check ─────────────────────────
    console.log('\n--- Testing GET /api/analytics/memories ---');
    const analyticsRes = await axios.get(`${RENDER_URL}/api/analytics/memories`, {
      headers: authHeaders,
      timeout: 15000
    });

    console.log('Analytics response summary:', {
      totalMemories: analyticsRes.data?.totalMemories,
      categories: analyticsRes.data?.categories,
      activeCanonicalMemories: analyticsRes.data?.memories?.map((m: any) => ({
        key: m.key,
        value: m.value,
        type: m.type,
        is_archived: m.is_archived
      }))
    });

    // Check assertions
    const activeMems = memsTurn2?.filter(m => !m.is_archived) || [];
    const sonName = activeMems.find(m => m.key === 'son_name')?.value;
    const sonNickname = activeMems.find(m => m.key === 'son_nickname')?.value;
    const hasUnscopedReal = activeMems.some(m => m.key === 'real_name');
    const hasUnscopedNick = activeMems.some(m => m.key === 'nickname');

    console.log('\n================ VERIFICATION RESULTS ================');
    console.log(`son_name (active): ${sonName} ${sonName === 'Shreshth' ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`son_nickname (active): ${sonNickname} ${sonNickname === 'Tiku' ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`No unscoped real_name: ${!hasUnscopedReal ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`No unscoped nickname: ${!hasUnscopedNick ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`Analytics endpoint excluded archived: ${!analyticsRes.data?.memories?.some((m: any) => m.is_archived) ? '✅ PASS' : '❌ FAIL'}`);

  } finally {
    // 3. Clean up ephemeral test user
    console.log(`\nCleaning up ephemeral user ${testUserId}...`);
    await supabase.from('memories').delete().eq('user_id', testUserId);
    await supabase.from('messages').delete().eq('user_id', testUserId);
    await supabase.from('reminders').delete().eq('user_id', testUserId);
    await supabase.auth.admin.deleteUser(testUserId);
    console.log('Ephemeral user cleaned up.');
  }
}

runVerification().catch(err => {
  console.error('Fatal error during verification:', err);
  process.exit(1);
});
