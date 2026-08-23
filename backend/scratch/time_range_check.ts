import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL || '', process.env.SUPABASE_SERVICE_ROLE_KEY || '');

async function timeRangeCheck() {
  const { count: last24h } = await supabase
    .from('failed_jobs')
    .select('*', { count: 'exact', head: true })
    .gte('failed_at', new Date(Date.now() - 24 * 3600 * 1000).toISOString());

  const { count: last1h } = await supabase
    .from('failed_jobs')
    .select('*', { count: 'exact', head: true })
    .gte('failed_at', new Date(Date.now() - 3600 * 1000).toISOString());

  const { count: last7d } = await supabase
    .from('failed_jobs')
    .select('*', { count: 'exact', head: true })
    .gte('failed_at', new Date(Date.now() - 7 * 86400 * 1000).toISOString());

  const { data: latestJobs } = await supabase
    .from('background_jobs')
    .select('id, job_type, status, created_at, completed_at')
    .order('created_at', { ascending: false })
    .limit(10);

  console.log('FAILURES_IN_LAST_1H:', last1h);
  console.log('FAILURES_IN_LAST_24H:', last24h);
  console.log('FAILURES_IN_LAST_7D:', last7d);
  console.log('LATEST_BACKGROUND_JOBS:');
  console.log(JSON.stringify(latestJobs, null, 2));
  process.exit(0);
}

timeRangeCheck();
