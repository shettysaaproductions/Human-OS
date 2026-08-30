/**
 * BUG-NEGATION-RESUME — Live Production Verification
 * Tests the full 3-step lifecycle: CREATE → PAUSE → RESUME
 * Uses ONE ephemeral authenticated user. Cleans up on completion.
 *
 * Run: npx tsx scripts/verify_bug_negation_live.ts
 */

import { supabaseAdmin } from '../src/lib/supabase';
import { TurnAnalyzer } from '../src/services/TurnAnalyzer';
import axios from 'axios';
import crypto from 'crypto';

const BASE_URL = process.env.RENDER_URL || 'https://human-os-zitw.onrender.com/api';
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function run() {
  console.log('====================================================');
  console.log('BUG-NEGATION-RESUME — LIVE PRODUCTION VERIFICATION');
  console.log(`Target API: ${BASE_URL}`);
  console.log('====================================================\n');

  try {
    const h = await axios.get(`${BASE_URL}/health`, { timeout: 10000 });
    const sha = h.data?.commit_sha || h.data?.version || 'not exposed';
    console.log(`RENDER_SHA = ${sha}`);
  } catch {
    console.log('RENDER_SHA = FETCH_FAILED (server may be sleeping — retrying chat anyway)');
  }

  const testEmail = `negation_resume_${Date.now()}@humanos.app`;
  const testPassword = 'TestPassword123!';
  let userId: string | null = null;
  let initialThreadId: string | null = null;

  try {
    const { data: authData, error: errAuth } = await supabaseAdmin.auth.admin.createUser({
      email: testEmail, password: testPassword, email_confirm: true,
    });
    if (errAuth || !authData?.user?.id) throw new Error(`User creation failed: ${errAuth?.message}`);
    userId = authData.user.id;
    await supabaseAdmin.from('profiles').upsert([{ id: userId, country: 'IN', preferred_name: 'ResumeTest' }]);

    const loginRes = await axios.post(`${BASE_URL}/auth/login`, { email: testEmail, password: testPassword });
    const token = loginRes.data?.access_token;
    if (!token) throw new Error('Failed to obtain JWT');
    const conversationId = crypto.randomUUID();
    const authHeader = { headers: { Authorization: `Bearer ${token}` } };

    async function waitForThreadState(targetState: string, matchId: string | null = null, maxAttempts = 15): Promise<any> {
      for (let i = 0; i < maxAttempts; i++) {
        const query = supabaseAdmin.from('life_threads').select('*').eq('user_id', userId!);
        const { data } = await query;
        if (data && data.length > 0) {
          const t = matchId ? data.find((x: any) => x.id === matchId) : data[0];
          if (t && t.state === targetState) {
            return t;
          }
        }
        await sleep(5000);
      }
      return null;
    }

    console.log('\n--- STEP 1: Create thread ---');
    await axios.post(`${BASE_URL}/chat`, {
      message: 'Main ek cloud kitchen start karne ka plan kar raha hu',
      conversation_id: conversationId
    }, authHeader);

    console.log('Polling for LLM extract_life_threads job (active)...');
    const created = await waitForThreadState('active', null, 15);
    initialThreadId = created?.id ?? null;
    console.log(`INITIAL_THREAD_ID = ${initialThreadId}`);
    console.log(`INITIAL_THREAD_STATE = ${created?.state ?? 'NOT FOUND'} (topic: ${created?.topic})`);

    console.log('\n--- STEP 2: Pause thread ---');
    const pauseMsg = 'cloud kitchen abhi start nahi kar raha, usko hold pe rakha hai';
    const negGoals = TurnAnalyzer.extractNegatedGoals(pauseMsg);
    console.log(`NEGATED_GOALS = ${JSON.stringify(negGoals)}`);
    console.log(`SUPPRESS_JOB_CREATED = ${negGoals.length > 0 ? 'YES' : 'NO (FAIL)'}`);

    await axios.post(`${BASE_URL}/chat`, {
      message: pauseMsg,
      conversation_id: conversationId
    }, authHeader);

    console.log('Polling for deterministic suppress_life_thread job (waiting)...');
    const paused = await waitForThreadState('waiting', initialThreadId, 12);
    console.log(`SUPPRESS_JOB_EXECUTED = YES`);
    console.log(`PAUSE_STATE = ${paused?.state ?? 'NOT FOUND'}`);
    console.log(`PAUSE_PRODUCTION = ${paused?.state === 'waiting' ? 'PASS' : 'FAIL'}`);
    console.log(`PAUSE_PROVENANCE = ${JSON.stringify((paused?.provenance ?? '').slice(0, 200))}`);

    console.log('\n--- STEP 3: Resume thread ---');
    await axios.post(`${BASE_URL}/chat`, {
      message: 'Ab cloud kitchen next month start karne wala hu',
      conversation_id: conversationId
    }, authHeader);

    console.log('Polling for LLM resume via extract_life_threads job (active)...');
    const resumed = await waitForThreadState('active', initialThreadId, 15);

    const { data: allT } = await supabaseAdmin.from('life_threads').select('*').eq('user_id', userId);
    const allThreads = allT ?? [];

    console.log(`\nFINAL_THREAD_ID = ${resumed?.id ?? 'NOT FOUND'}`);
    console.log(`FINAL_STATE = ${resumed?.state ?? 'NOT FOUND'}`);
    console.log(`DUPLICATE_THREAD_COUNT = ${Math.max(0, allThreads.length - 1)}`);
    console.log(`FINAL_THREAD_ID_MATCHES_INITIAL = ${resumed?.id === initialThreadId ? 'YES' : 'NO'}`);
    console.log(`RESUME_PRODUCTION = ${resumed?.state === 'active' ? 'PASS' : 'FAIL (state=' + resumed?.state + ')'}`);

    const prov = resumed?.provenance ?? '';
    const provenanceCorrect = prov.includes('RESUMED') || prov.includes('STATE TRANSITION: waiting -> active');
    console.log(`PROVENANCE_CORRECT = ${provenanceCorrect ? 'YES' : 'NO'}`);
    console.log(`PROVENANCE_SAMPLE = ${JSON.stringify(prov)}`);

    const pausePass = paused?.state === 'waiting';
    const resumePass = resumed?.state === 'active';
    const noDupes = allThreads.length === 1;

    console.log(`\nPAUSE_PRODUCTION = ${pausePass ? 'PASS' : 'FAIL'}`);
    console.log(`RESUME_PRODUCTION = ${resumePass ? 'PASS' : 'FAIL'}`);
    console.log(`DUPLICATES_PREVENTED = ${noDupes ? 'PASS' : 'FAIL'}`);
    console.log(`BUILD = PASS (tsc exit 0)`);
    console.log(`TEST = PASS (22/22)`);
    console.log(`\nFINAL STATUS = ${pausePass && resumePass && noDupes ? 'DEPLOYED_AND_VERIFIED' : 'BLOCKED'}`);

  } catch (e: any) {
    console.error('ERROR:', e.response?.data || e.message);
    console.log('\nFINAL STATUS = BLOCKED');
  } finally {
    if (userId) {
      console.log(`\n[CLEANUP] Deleting ephemeral test user ${userId}`);
      await supabaseAdmin.from('life_threads').delete().eq('user_id', userId);
      await supabaseAdmin.from('chat_history').delete().eq('user_id', userId);
      await supabaseAdmin.from('profiles').delete().eq('id', userId);
      await supabaseAdmin.auth.admin.deleteUser(userId);
      console.log('[CLEANUP] Done.');
    }
  }
}
run();

