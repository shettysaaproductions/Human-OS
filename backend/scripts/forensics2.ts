import { supabaseAdmin } from '../src/lib/supabase';
import fs from 'fs';

async function run() {
  const currentUserUuid = '80547977-5bdd-4252-a1a1-7e06902d5c8d';

  // Fetch all timing logs and decisions for this user to be sure
  const { data: timingLogs } = await supabaseAdmin.from('watchtower_timing_logs').select('*').eq('user_id', currentUserUuid);
  console.log('Timing Logs:', timingLogs?.length);
  
  const { data: burden } = await supabaseAdmin.from('nova_cognitive_signals').select('*').eq('user_id', currentUserUuid);
  console.log('Cognitive signals:', burden?.length);

  const { data: dispatch } = await supabaseAdmin.from('background_jobs').select('*').eq('user_id', currentUserUuid).in('job_type', ['dispatch_proactive', 'send_push']);
  console.log('Background jobs (dispatch):', dispatch?.length);

  // Let's get the specific outreach logs
  const { data: outreach } = await supabaseAdmin.from('nova_outreach_log').select('*').eq('user_id', currentUserUuid).order('created_at', { ascending: true });
  
  fs.writeFileSync('forensics_report_2.json', JSON.stringify({
    timingLogs, burden, dispatch, outreach
  }, null, 2));
}

run().catch(console.error);
