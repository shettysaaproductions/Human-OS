import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const supabase = createClient(supabaseUrl, supabaseKey);

async function inspectFailed() {
  const { data: failed, error } = await supabase
    .from('failed_jobs')
    .select('id, job_type, error, failed_at')
    .order('failed_at', { ascending: false })
    .limit(20);

  if (error) {
    console.error('Error:', error);
    process.exit(1);
  }

  console.log('Total sample returned:', failed?.length);
  console.log('Latest failures:');
  console.log(JSON.stringify(failed?.slice(0, 5), null, 2));

  const { data: oldest } = await supabase
    .from('failed_jobs')
    .select('failed_at')
    .order('failed_at', { ascending: true })
    .limit(1);
  
  console.log('Oldest failure in DLQ:', oldest?.[0]?.failed_at);

  const { data: backgroundJobs } = await supabase
    .from('background_jobs')
    .select('status')
    .order('created_at', { ascending: false })
    .limit(100);

  const bgCounts = (backgroundJobs || []).reduce((acc: any, j: any) => {
    acc[j.status] = (acc[j.status] || 0) + 1;
    return acc;
  }, {});

  console.log('Recent 100 background_jobs status breakdown:', bgCounts);

  process.exit(0);
}

inspectFailed();
