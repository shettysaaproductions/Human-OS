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
const REMEDIATION_TIME = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();

async function run() {
  console.log('--- TARGET USER ---');
  const { data: users, error: userErr } = await supabase.auth.admin.listUsers();
  const user = users?.users.find(u => u.email === TARGET_EMAIL);
  
  if (!user) {
    console.log(`User ${TARGET_EMAIL} not found.`);
    return;
  }
  
  const userId = user.id;
  console.log(`User ID: ${userId}`);
  
  const { data: profile } = await supabase.from('profiles').select('*').eq('id', userId).single();
  console.log(`Timezone: ${profile?.timezone || 'MISSING'}`);
  
  console.log('\n--- CANDIDATE SYNTHESIS ---');
  const { data: claims } = await supabase.from('candidate_synthesis_claims')
    .select('*')
    .eq('user_id', userId)
    .gte('created_at', REMEDIATION_TIME)
    .order('created_at', { ascending: false });
    
  console.log(`Recent claims for user: ${claims?.length || 0}`);
  if (claims && claims.length > 0) {
    console.log(claims.map(c => ({
      status: c.status,
      candidates_created: c.candidates_created,
      deduplicated: c.deduplicated,
      rejected: c.rejected,
      error: c.error
    })));
  }
  
  console.log('\n--- LIFE THREADS ---');
  const { data: threads } = await supabase.from('life_threads')
    .select('*')
    .eq('user_id', userId)
    .gte('created_at', REMEDIATION_TIME);
  console.log(`New threads: ${threads?.length || 0}`);
  
  console.log('\n--- TIMING DECISIONS ---');
  const { data: timings } = await supabase.from('timing_decisions')
    .select('timing_state, reason')
    .eq('user_id', userId)
    .gte('created_at', REMEDIATION_TIME);
    
  const timingCounts = timings?.reduce((acc: any, t) => {
    acc[t.timing_state] = (acc[t.timing_state] || 0) + 1;
    if (t.reason === 'MISSING_TIMEZONE') {
      acc['MISSING_TIMEZONE'] = (acc['MISSING_TIMEZONE'] || 0) + 1;
    }
    return acc;
  }, {});
  console.log(timingCounts || 'No timing decisions');
  
  console.log('\n--- WATCHTOWER RUNS ---');
  const { data: watchtower } = await supabase.from('watchtower_runs')
    .select('*')
    .gte('started_at', REMEDIATION_TIME)
    .order('started_at', { ascending: false })
    .limit(5);
  console.log(`Recent watchtower runs: ${watchtower?.length || 0}`);
  
  console.log('\n--- PROACTIVE OUTREACH ---');
  const { data: outreach } = await supabase.from('proactive_outreach')
    .select('*')
    .eq('user_id', userId)
    .gte('created_at', REMEDIATION_TIME);
  console.log(`Recent outreach: ${outreach?.length || 0}`);
  
  console.log('\n--- HEALTH CHECK ---');
  const checkUrl = async (url: string) => {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
      const text = await res.text();
      console.log(`[${res.status}] ${url} -> ${text.substring(0, 50)}`);
    } catch (err: any) {
      console.log(`[ERROR] ${url} -> ${err.message}`);
    }
  };
  
  await checkUrl('https://human-os-zitw.onrender.com/health');
  await checkUrl('https://human-os-zitw.onrender.com/health/ready');
  await checkUrl('https://human-os-zitw.onrender.com/api/health/cognitive');
}

run().catch(console.error);
