import { supabaseAdmin } from '../src/lib/supabase';

async function run() {
  const userId = 'a5f926e9-91d6-4bd7-b70b-ab1a37d716f0';
  
  const tables = [
    'chat_history',
    'memories',
    'working_memory',
    'episodic_memories',
    'life_threads',
    'reminders',
    'nova_cognitive_doubts',
    'watchtower_heartbeat_runs',
    'watchtower_cognitive_signals',
    'watchtower_attention_decisions',
    'watchtower_timing_logs',
    'nova_outreach_log',
    'user_presence'
  ];

  const results: Record<string, any[]> = {};
  
  for (const table of tables) {
    let query = supabaseAdmin.from(table).select('*');
    if (table !== 'watchtower_heartbeat_runs') {
      query = query.eq('user_id', userId);
    }
    const { data, error } = await query;
    if (error) {
      console.error(`Error fetching ${table}:`, error);
    } else {
      results[table] = data || [];
    }
  }

  // Print summary
  for (const table of tables) {
    console.log(`\n--- ${table.toUpperCase()} (${results[table].length}) ---`);
    console.log(JSON.stringify(results[table], null, 2));
  }
}

run().catch(console.error);
