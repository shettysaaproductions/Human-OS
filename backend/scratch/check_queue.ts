import { supabaseAdmin } from '../src/lib/supabase';

async function run() {
  const { data, error } = await supabaseAdmin
    .from('background_jobs')
    .select('id, job_type, status, created_at, error, payload')
    .order('created_at', { ascending: false })
    .limit(10);
    
  console.log('DATA:', JSON.stringify(data, null, 2));
  if (error) console.error('ERROR:', JSON.stringify(error, null, 2));
}

run();
