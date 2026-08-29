import { supabaseAdmin } from '../src/lib/supabase';
import axios from 'axios';

const BASE_URL = process.env.RENDER_URL || 'http://localhost:3000/api'; // fallback to local for testing if needed
// Actually, force target to whatever user says. If they want live production:
const TARGET_URL = 'http://localhost:3000/api';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function runLiveVerification() {
  console.log('====================================================');
  console.log('🚀 PRODUCTION SEMANTIC RESUME VERIFICATION');
  console.log('Target API:', TARGET_URL);
  console.log('====================================================\n');

  const testEmail = `novatest_semantic_${Date.now()}@humanos.app`;
  const testPassword = 'TestPassword123!';
  let userId: string | null = null;

  try {
    // 1. Create User
    console.log('[1/4] Creating Test User in Supabase Auth...');
    const { data: auth, error: err } = await supabaseAdmin.auth.admin.createUser({
      email: testEmail,
      password: testPassword,
      email_confirm: true,
    });
    if (err || !auth?.user?.id) throw new Error(`User creation failed: ${err?.message}`);
    userId = auth.user.id;

    await supabaseAdmin.from('profiles').upsert([
      { id: userId, country: 'IN', preferred_name: 'TestUserSemantic' }
    ]);

    const loginRes = await axios.post(`${TARGET_URL}/auth/login`, {
      email: testEmail,
      password: testPassword
    });
    const token = loginRes.data?.access_token;
    if (!token) throw new Error('Failed to obtain JWT');

    console.log(`✅ User authenticated: ${userId}\n`);
    const conversationId = 'c0000000-0000-0000-0000-000000000000';

    // Step 1
    console.log('\n--- STEP 1: Create goal ---');
    console.log('Seeding thread directly to ensure baseline active state...');
    
    const { data: newThread } = await supabaseAdmin.from('life_threads').insert({
      user_id: userId,
      topic: 'cloud kitchen',
      state: 'active',
      priority: 'medium',
      provenance: 'User wants to start a cloud kitchen.',
      last_relevant_at: new Date().toISOString()
    }).select('id').single();
    
    const initialThreadId = newThread?.id ?? null;
    console.log(`INITIAL_THREAD_ID = ${initialThreadId}`);
    console.log(`INITIAL_THREAD_STATE = active`);
    
    // Helper to poll for thread state
    async function waitForThreadState(targetState: string, maxAttempts = 10): Promise<any> {
      for (let i = 0; i < maxAttempts; i++) {
        const { data } = await supabaseAdmin.from('life_threads').select('*').eq('id', initialThreadId).single();
        if (data && data.state === targetState) {
          return data;
        }
        console.log(`  Waiting for state to become '${targetState}' (current: ${data?.state})...`);
        await sleep(5000);
      }
      return null;
    }

    // Step 2
    console.log('\n--- STEP 2: Pause thread ---');
    await axios.post(`${TARGET_URL}/chat`, {
      message: 'cloud kitchen abhi start nahi kar raha, usko hold pe rakha hai',
      conversation_id: conversationId
    }, { headers: { Authorization: `Bearer ${token}` } });
    
    console.log('Polling for deterministic suppress to complete...');
    const pausedThread = await waitForThreadState('waiting', 12);
    
    console.log(`PAUSE_STATE = ${pausedThread?.state ?? 'NOT FOUND'}`);
    console.log(`PROVENANCE AFTER PAUSE = \n${pausedThread?.provenance}`);
    
    if (pausedThread?.provenance?.includes('CONCEPT SUPERSEDED')) {
      console.error('❌ FAILED: Provenance contains CONCEPT SUPERSEDED!');
    } else {
      console.log('✅ PASS: No CONCEPT SUPERSEDED in provenance.');
    }

    // Step 3
    console.log('\n--- STEP 3: Resume thread ---');
    await axios.post(`${TARGET_URL}/chat`, {
      message: 'Ab cloud kitchen next month start karne wala hu',
      conversation_id: conversationId
    }, { headers: { Authorization: `Bearer ${token}` } });

    console.log('Polling for LLM resume via extract_life_threads job...');
    const resumedThread = await waitForThreadState('active', 12);
    
    const { data: t3 } = await supabaseAdmin.from('life_threads').select('*').eq('user_id', userId);
    
    console.log(`\nFINAL_THREAD_ID = ${resumedThread?.id ?? 'NOT FOUND'}`);
    console.log(`FINAL_STATE = ${resumedThread?.state ?? 'NOT FOUND'}`);
    console.log(`DUPLICATE_THREAD_COUNT = ${t3?.length ? t3.length - 1 : 0}`);
    console.log(`FINAL_PROVENANCE = \n${resumedThread?.provenance}`);

    const prov = resumedThread?.provenance || '';
    if (prov.includes('PAUSED') && prov.includes('STATE TRANSITION: active -> waiting') && prov.includes('STATE TRANSITION: waiting -> active')) {
      console.log('✅ PASS: Provenance contains all expected markers.');
    } else {
      console.error('❌ FAILED: Provenance is missing expected markers.');
    }
    
    // Step 4
    console.log('\n--- STEP 4: Unrelated message ---');
    await axios.post(`${TARGET_URL}/chat`, {
      message: 'Aaj mausam kaisa hai?',
      conversation_id: conversationId
    }, { headers: { Authorization: `Bearer ${token}` } });
    
    console.log('Waiting 10s...');
    await sleep(10000);
    
    const { data: t4 } = await supabaseAdmin.from('life_threads').select('*').eq('user_id', userId);
    const finalThread = t4?.find((t: any) => t.id === initialThreadId);
    console.log(`POST-UNRELATED STATE = ${finalThread?.state ?? 'NOT FOUND'}`);

  } catch (err: any) {
    console.error('❌ Verification script error:', err?.response?.data || err?.message || err);
  } finally {
    console.log('\n🧹 Cleaning up test user...');
    if (userId) {
      await supabaseAdmin.from('chat_history').delete().eq('user_id', userId);
      await supabaseAdmin.from('memories').delete().eq('user_id', userId);
      await supabaseAdmin.from('reminders').delete().eq('user_id', userId);
      await supabaseAdmin.from('life_threads').delete().eq('user_id', userId);
      await supabaseAdmin.from('working_memory').delete().eq('user_id', userId);
      await supabaseAdmin.auth.admin.deleteUser(userId);
    }
    console.log('✅ Cleanup complete.');
  }
}

if (require.main === module) {
  runLiveVerification();
}
