import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing Supabase credentials");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkTables() {
  const tables = [
    'chat_history',
    'memories',
    'episodic_memories',
    'background_jobs',
    'failed_jobs',
    'tombstones',
    'recovery_archive',
    'audit_logs'
  ];

  for (const table of tables) {
    const { data: _data, error, count } = await supabase
      .from(table)
      .select('*', { count: 'exact', head: true });
    
    if (error) {
      console.log(`Table ${table}: NOT FOUND or ERROR (${error.message})`);
    } else {
      console.log(`Table ${table}: EXISTS (Count: ${count})`);
    }
  }

  // Also query the health endpoint RPC
  const { data: healthData, error: healthError } = await supabase.rpc('get_cognitive_health_metrics');
  console.log("\nHealth Metrics RPC:", healthError ? healthError.message : healthData);
  
  // Aggregate counts for chat_history by status
  const { data: statusCounts } = await supabase.from('chat_history').select('compaction_status');
  if (statusCounts) {
      const counts = statusCounts.reduce((acc: Record<string, number>, row: any) => {
          acc[row.compaction_status || 'null'] = (acc[row.compaction_status || 'null'] || 0) + 1;
          return acc;
      }, {});
      console.log("\nChat History Compaction Status Counts:", counts);
  }
}

checkTables();
