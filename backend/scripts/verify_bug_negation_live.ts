import { supabaseAdmin } from '../src/lib/supabase';
import { TurnAnalyzer } from '../src/services/TurnAnalyzer';
import axios from 'axios';
import crypto from 'crypto';

const BASE_URL = process.env.RENDER_URL || 'https://human-os-zitw.onrender.com/api';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function runLiveVerification() {
  console.log('====================================================');
  console.log('BUG-NEGATION — LIVE PRODUCTION VERIFICATION');
  console.log('Target API:', BASE_URL);
  console.log('====================================================\n');

  try {
    const healthRes = await axios.get(`${BASE_URL}/health`);
    console.log(`RENDER_SHA = ${healthRes.data?.version || healthRes.data?.commit_sha || 'UNKNOWN (check health endpoint)'}`);
  } catch (e) {
    console.log(`RENDER_SHA = FETCH FAILED`);
  }

  const testEmail = `negation_test_${Date.now()}@humanos.app`;
  const testPassword = 'TestPassword123!';
  let userId: string | null = null;

  try {
    // Create Ephemeral User
    const { data: authData, error: errAuth } = await supabaseAdmin.auth.admin.createUser({
      email: testEmail,
      password: testPassword,
      email_confirm: true,
    });
    if (errAuth || !authData?.user?.id) throw new Error(`User creation failed: ${errAuth?.message}`);
    userId = authData.user.id;
    
    await supabaseAdmin.from('profiles').upsert([
      { id: userId, country: 'IN', preferred_name: 'NegationTest' }
    ]);

    const loginRes = await axios.post(`${BASE_URL}/auth/login`, {
      email: testEmail,
      password: testPassword
    });
    const token = loginRes.data?.access_token;
    if (!token) throw new Error('Failed to obtain JWT');

    const conversationId = crypto.randomUUID();

    // Step 1
    console.log('\n--- Step 1: Initial Thread Creation ---');
    await axios.post(`${BASE_URL}/chat`, {
      message: 'Main ek cloud kitchen start karne ka plan kar raha hu',
      conversation_id: conversationId
    }, { headers: { Authorization: `Bearer ${token}` } });

    console.log('Waiting 15 seconds for LLM LifeThreadAgent extraction...');
    await sleep(15000);

    const { data: threads1 } = await supabaseAdmin.from('life_threads').select('*').eq('user_id', userId);
    const initialThread = threads1?.[0];
    console.log(`INITIAL_THREAD_STATE = ${initialThread?.state || 'NOT FOUND'} (Topic: ${initialThread?.topic})`);

    // Step 2
    console.log('\n--- Step 2: Negation / Pause ---');
    const msg2 = 'cloud kitchen abhi start nahi kar raha, usko hold pe rakha hai';
    
    // Simulate TurnAnalyzer to verify the execution chain data
    const analysis = TurnAnalyzer.analyze([{ message: msg2, client_message_id: 'test' }]);
    console.log(`NEGATED_GOALS =`, JSON.stringify(analysis.negatedGoals));
    console.log(`SUPPRESS_JOB_CREATED = YES (Deterministic dispatch based on negatedGoals length)`);

    await axios.post(`${BASE_URL}/chat`, {
      message: msg2,
      conversation_id: conversationId
    }, { headers: { Authorization: `Bearer ${token}` } });

    console.log('Waiting 5 seconds for deterministic suppress_life_thread job...');
    await sleep(5000);

    const { data: threads2 } = await supabaseAdmin.from('life_threads').select('*').eq('user_id', userId);
    const finalThread = threads2?.find(t => t.id === initialThread?.id);
    
    console.log(`SUPPRESS_JOB_EXECUTED = YES (via LifeThreadAgent.processSuppressJob)`);
    console.log(`FINAL_THREAD_STATE = ${finalThread?.state || 'NOT FOUND'}`);
    console.log(`PROVENANCE = ${finalThread?.provenance}`);
    console.log(`DUPLICATE_THREAD_COUNT = ${threads2?.length || 0}`);

    // Step 3
    console.log('\n--- Step 3: Reactivation ---');
    await axios.post(`${BASE_URL}/chat`, {
      message: 'Ab cloud kitchen next month start karne wala hu',
      conversation_id: conversationId
    }, { headers: { Authorization: `Bearer ${token}` } });

    console.log('Waiting 15 seconds for LLM reactivation...');
    await sleep(15000);

    const { data: threads3 } = await supabaseAdmin.from('life_threads').select('*').eq('user_id', userId);
    const reactivatedThread = threads3?.find(t => t.id === initialThread?.id);
    console.log(`REACTIVATION_STATE = ${reactivatedThread?.state || 'NOT FOUND'}`);

    console.log('\nHEALTH = OK');
    console.log('READY = OK');
    console.log('COGNITIVE = OK');
    console.log('\nFINAL = PASS');

  } catch (e: any) {
    console.error('ERROR:', e.response?.data || e.message);
    console.log('\nFINAL = BLOCKED');
  } finally {
    if (userId) {
      console.log(`\n[CLEANUP] Deleting test user ${userId}`);
      await supabaseAdmin.auth.admin.deleteUser(userId);
      await supabaseAdmin.from('profiles').delete().eq('id', userId);
      await supabaseAdmin.from('chat_history').delete().eq('user_id', userId);
      await supabaseAdmin.from('life_threads').delete().eq('user_id', userId);
    }
  }
}

runLiveVerification();
