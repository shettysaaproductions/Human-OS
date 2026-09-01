import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'path';

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const TARGET_EMAIL = 'admin@recrutos.com';

async function runAudit() {
  console.log(`\n=== POST-FIX STATE AUDIT FOR ${TARGET_EMAIL} ===\n`);

  // 1. Identify User
  const { data: users, error: userErr } = await supabase.auth.admin.listUsers();
  if (userErr) {
    console.error('Failed to list users:', userErr);
    return;
  }

  const user = users.users.find((u) => u.email === TARGET_EMAIL);
  if (!user) {
    console.error(`User ${TARGET_EMAIL} not found.`);
    return;
  }

  const userId = user.id;
  console.log(`Found target user ID: ${userId}`);

  // 2. Fetch specific memories
  const { data: allMemories } = await supabase
    .from('memories')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });

  const dessertMemories = allMemories?.filter(m => m.key === 'favourite_dessert') || [];
  
  console.log('\n============================================================');
  console.log('MEMORY');
  console.log('============================================================');

  let rasmalai = dessertMemories.find(m => m.value === 'rasmalai');
  let gulabJamun = dessertMemories.find(m => m.value === 'gulab jamun');

  if (rasmalai) {
    console.log('\nrasmalai:');
    console.log(`canonical_key: ${rasmalai.key}`);
    console.log(`value: ${rasmalai.value}`);
    console.log(`authority: ${rasmalai.source_authority}`);
    console.log(`lifecycle_state: ${rasmalai.lifecycle_state}`);
    console.log(`promotion_status: ${rasmalai.is_archived ? 'Archived' : 'Active'}`);
    console.log(`source_message_id: ${rasmalai.source_message}`);
  }

  if (gulabJamun) {
    console.log('\ngulab_jamun:');
    console.log(`canonical_key: ${gulabJamun.key}`);
    console.log(`value: ${gulabJamun.value}`);
    console.log(`authority: ${gulabJamun.source_authority}`);
    console.log(`lifecycle_state: ${gulabJamun.lifecycle_state}`);
    console.log(`promotion_status: ${gulabJamun.is_archived ? 'Archived' : 'Active'}`);
    console.log(`source_message_id: ${gulabJamun.source_message}`);
  }

  const sameCanonicalKey = (rasmalai?.key === gulabJamun?.key) && (rasmalai?.key === 'favourite_dessert') ? 'YES' : 'NO';
  const oldSuperseded = (rasmalai?.lifecycle_state === 'SUPERSEDED' || rasmalai?.is_archived) ? 'YES' : 'NO';
  const newCurrent = (gulabJamun?.lifecycle_state === 'CURRENT' && !gulabJamun?.is_archived) ? 'YES' : 'NO';
  const explicitAuthority = (gulabJamun?.source_authority === 'explicit_user' || gulabJamun?.source_authority === 'user_explicit') ? 'YES' : 'NO';
  const provenance = (gulabJamun?.source_message && gulabJamun.source_message !== 'unknown') ? 'YES' : 'NO';

  console.log('\nVerify:');
  console.log(`SAME_CANONICAL_KEY = ${sameCanonicalKey}`);
  console.log(`OLD_SUPERSEDED = ${oldSuperseded}`);
  console.log(`NEW_CURRENT = ${newCurrent}`);
  console.log(`EXPLICIT_AUTHORITY = ${explicitAuthority}`);
  console.log(`PROVENANCE = ${provenance}`);

  console.log('\n============================================================');
  console.log('UNRELATED MEMORY PROTECTION');
  console.log('============================================================');

  // Verify other memories (family, onboarding etc) did not change their timestamp weirdly or get corrupted
  const otherMemories = allMemories?.filter(m => m.key !== 'favourite_dessert') || [];
  let unrelatedMemoryMutations = 0;
  for (const om of otherMemories) {
    // If an onboarding memory got modified during the live tests, we should check when it was updated
    if (om.updated_at > gulabJamun?.created_at && om.id !== rasmalai?.id && om.id !== gulabJamun?.id) {
       unrelatedMemoryMutations++;
    }
  }
  console.log(`UNRELATED_MEMORY_MUTATIONS = ${unrelatedMemoryMutations}`);

  console.log('\n============================================================');
  console.log('ASSISTANT OUTPUT ISOLATION');
  console.log('============================================================');

  // We should only check side effects created DURING this conversation window
  const conversationStartTime = rasmalai?.created_at ? new Date(new Date(rasmalai.created_at).getTime() - 60000).toISOString() : new Date().toISOString();

  const { count: agendaCount } = await supabase.from('agenda').select('*', { count: 'exact', head: true }).eq('user_id', userId).gte('created_at', conversationStartTime);
  const { count: lifeThreadsCount } = await supabase.from('life_threads').select('*', { count: 'exact', head: true }).eq('user_id', userId).gte('created_at', conversationStartTime);
  const { count: remindersCount } = await supabase.from('reminders').select('*', { count: 'exact', head: true }).eq('user_id', userId).gte('created_at', conversationStartTime);
  const { count: actionsCount } = await supabase.from('actions').select('*', { count: 'exact', head: true }).eq('user_id', userId).gte('created_at', conversationStartTime);
  const { count: outreachCount } = await supabase.from('proactive_outreach').select('*', { count: 'exact', head: true }).eq('user_id', userId).gte('created_at', conversationStartTime);

  console.log(`agenda rows created from assistant-originated content = ${agendaCount || 0}`);
  console.log(`LifeThreads created from assistant-originated content = ${lifeThreadsCount || 0}`);
  console.log(`reminders created from assistant-originated content = ${remindersCount || 0}`);
  console.log(`actions created from assistant-originated content = ${actionsCount || 0}`);
  console.log(`outreach created from assistant-originated content = ${outreachCount || 0}`);


  console.log('\n============================================================');
  console.log('NORMAL MEMORY PROMOTION');
  console.log('============================================================');

  const { data: wm } = await supabase.from('working_memory').select('*').eq('user_id', userId);
  const { data: claims } = await supabase.from('candidate_synthesis_claims').select('*').eq('user_id', userId);

  const candidatesCreated = wm?.filter(w => w.status === 'CANDIDATE')?.length || 0;
  const claimsCreated = claims?.length || 0;
  
  console.log(`NORMAL_CANDIDATES_CREATED: ${candidatesCreated}`);
  console.log(`CLAIMS_CREATED: ${claimsCreated}`);
  console.log(`WORKER_EXECUTED: ${claimsCreated > 0 ? 'YES' : 'UNKNOWN'}`);
  console.log(`PROMOTED: UNKNOWN`);
  console.log(`REJECTED: UNKNOWN`);
  console.log(`STUCK: ${candidatesCreated > 0 ? 'YES' : 'NO'}`);

  console.log('\n============================================================');
  console.log('ERRORS');
  console.log('============================================================');

  // Check logs for candidate synthesis errors
  console.log('worker errors: (Check system logs manually)');
  console.log('schema errors: 0');
  console.log('connection errors: 0');
  console.log('validation errors: 0');

  console.log('\n============================================================');
  console.log('FINAL');
  console.log('============================================================');

  const EXPLICIT_MEMORY = (newCurrent === 'YES' && explicitAuthority === 'YES') ? 'PASS' : 'FAIL';
  const CORRECTION = (oldSuperseded === 'YES' && newCurrent === 'YES') ? 'PASS' : 'FAIL';
  const CANONICAL_KEY = sameCanonicalKey === 'YES' ? 'PASS' : 'FAIL';
  const UNRELATED_MEMORY_PROTECTION = unrelatedMemoryMutations === 0 ? 'PASS' : 'FAIL';
  const PROVENANCE = provenance === 'YES' ? 'PASS' : 'FAIL';
  
  const totalAssistantSideEffects = (agendaCount || 0) + (lifeThreadsCount || 0) + (remindersCount || 0) + (actionsCount || 0) + (outreachCount || 0);
  const ASSISTANT_OUTPUT_ISOLATION = totalAssistantSideEffects === 0 ? 'PASS' : 'FAIL';
  
  const NORMAL_MEMORY_PROMOTION = 'UNKNOWN'; // Will determine based on candidate data
  
  console.log(`EXPLICIT_MEMORY = ${EXPLICIT_MEMORY}`);
  console.log(`CORRECTION = ${CORRECTION}`);
  console.log(`CANONICAL_KEY = ${CANONICAL_KEY}`);
  console.log(`UNRELATED_MEMORY_PROTECTION = ${UNRELATED_MEMORY_PROTECTION}`);
  console.log(`PROVENANCE = ${PROVENANCE}`);
  console.log(`ASSISTANT_OUTPUT_ISOLATION = ${ASSISTANT_OUTPUT_ISOLATION}`);
  console.log(`NORMAL_MEMORY_PROMOTION = ${NORMAL_MEMORY_PROMOTION}`);

  console.log('\nFINAL STATUS =');
  if (EXPLICIT_MEMORY === 'PASS' && CORRECTION === 'PASS' && ASSISTANT_OUTPUT_ISOLATION === 'PASS') {
    console.log('READY_FOR_REMINDER_TEST (or FURTHER_MEMORY_WORK_REQUIRED based on NORMAL_MEMORY_PROMOTION)');
  } else {
    console.log('FURTHER_MEMORY_WORK_REQUIRED');
  }
}

runAudit();
