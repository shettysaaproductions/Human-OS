import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false },
});

const TARGET_EMAIL = 'admin@recrutos.com';
// The test was conducted recently, so we'll look at the last 1 hour.
const SINCE_TIME = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString();

async function run() {
  console.log('--- 1. IDENTITY ---');
  const { data: users } = await supabase.auth.admin.listUsers();
  const user = users?.users.find(u => u.email === TARGET_EMAIL);
  if (!user) {
    console.log('User not found!');
    return;
  }
  const userId = user.id;
  console.log(`User ID: ${userId}`);

  console.log('\n--- 2. TIMEZONE & PRESENCE ---');
  const { data: profile } = await supabase.from('profiles').select('timezone, updated_at').eq('id', userId).single();
  console.log(`Profile Timezone: ${profile?.timezone || 'MISSING'} (Updated: ${profile?.updated_at || 'N/A'})`);
  
  const { data: presence } = await supabase.from('user_presence').select('*').eq('user_id', userId).single();
  console.log(`Presence Status: ${presence?.status || 'N/A'} (Timezone: ${presence?.last_known_timezone || 'MISSING'}, Last seen: ${presence?.last_seen_at || 'N/A'})`);

  console.log('\n--- CHAT MESSAGES ---');
  const { data: messages } = await supabase.from('chat_history')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(10);
  console.log(`Recent messages: ${messages?.length || 0}`);
  if (messages) {
    for (const msg of messages) {
      console.log(`[${msg.role.toUpperCase()}] ${msg.created_at}: ${msg.content.substring(0, 100)}`);
    }
  }

  console.log('\n--- 3. MEMORY (WORKING) ---');
  const { data: workingMemory } = await supabase.from('working_memory')
    .select('*')
    .eq('user_id', userId)
    .gte('created_at', SINCE_TIME)
    .order('created_at', { ascending: true });
  if (workingMemory) {
    for (const wm of workingMemory) {
      console.log(`[WM] ${JSON.stringify(wm)}`);
    }
  }

  console.log('\n--- 3. MEMORY (SEMANTIC/DURABLE) ---');
  const { data: semantic } = await supabase.from('semantic_memory')
    .select('*')
    .eq('user_id', userId)
    .gte('created_at', SINCE_TIME)
    .order('created_at', { ascending: true });
  if (semantic) {
    for (const s of semantic) {
      console.log(`[SM] ${JSON.stringify(s)}`);
    }
  }

  console.log('\n--- 6. MEMORY PROMOTION (SYNTHESIS CLAIMS) ---');
  const { data: claims } = await supabase.from('candidate_synthesis_claims')
    .select('*')
    .eq('user_id', userId)
    .gte('created_at', SINCE_TIME)
    .order('created_at', { ascending: true });
  if (claims) {
    for (const c of claims) {
      console.log(`[Claim] ${JSON.stringify(c)}`);
    }
  }

  console.log('\n--- 8. LIFETHREADS ---');
  const { data: threads } = await supabase.from('life_threads')
    .select('*')
    .eq('user_id', userId)
    .gte('created_at', SINCE_TIME);
  console.log(`New LifeThreads: ${threads?.length || 0}`);
  if (threads) {
    for (const t of threads) {
      console.log(`[LT] ${JSON.stringify(t)}`);
    }
  }

  console.log('\n--- 9. REMINDERS ---');
  const { data: reminders } = await supabase.from('reminders')
    .select('*')
    .eq('user_id', userId)
    .gte('created_at', SINCE_TIME);
  console.log(`New Reminders: ${reminders?.length || 0}`);
  if (reminders) {
    for (const r of reminders) {
      console.log(`[REM] ${JSON.stringify(r)}`);
    }
  }

  console.log('\n--- 10. WATCHTOWER & TIMING ---');
  const { data: timing } = await supabase.from('timing_decisions')
    .select('*')
    .eq('user_id', userId)
    .gte('created_at', SINCE_TIME)
    .order('created_at', { ascending: true });
  if (timing) {
    for (const t of timing) {
      console.log(`[Timing] Target: ${t.target_id}, State: ${t.timing_state}, Reason: ${t.reason}`);
    }
  }

  console.log('\n--- 11. PROACTIVE PIPELINE (OUTREACH) ---');
  const { data: outreach } = await supabase.from('proactive_outreach')
    .select('*')
    .eq('user_id', userId)
    .gte('created_at', SINCE_TIME);
  if (outreach) {
    for (const o of outreach) {
      console.log(`[Outreach] Type: ${o.outreach_type}, Status: ${o.status}, Delivery: ${o.delivery_status}, Dispatch: ${o.dispatched_at}`);
    }
  }
}

run().catch(console.error);
