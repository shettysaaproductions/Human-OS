import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

console.log('ENV_FLAG:', process.env.ENABLE_PHYSICAL_DELETION);

const supabase = createClient(process.env.SUPABASE_URL || '', process.env.SUPABASE_SERVICE_ROLE_KEY || '');

async function check() {
  const { data: rpcData, error: rpcErr } = await supabase.rpc('get_cognitive_health_metrics');
  console.log('RPC Call:', rpcErr ? 'FAIL ' + rpcErr.message : 'SUCCESS');
  if (rpcData) console.log(rpcData);
}
check();
