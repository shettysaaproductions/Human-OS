import { supabaseAdmin } from '../src/lib/supabase';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

async function checkDetails() {
  console.log('--- Inspecting working_memory row for a2754adc-3d7e-48ba-b2d7-1e8711d54aa3 ---');
  const { data: wm, error: wmErr } = await supabaseAdmin
    .from('working_memory')
    .select('*')
    .eq('user_id', 'a2754adc-3d7e-48ba-b2d7-1e8711d54aa3');
  console.log('working_memory:', wm, wmErr);

  // Check all other tables for a2754adc-3d7e-48ba-b2d7-1e8711d54aa3
  console.log('\n--- Checking all tables for a2754adc-3d7e-48ba-b2d7-1e8711d54aa3 ---');
  const tables = [
    'profiles', 'memories', 'short_term_memories', 'episodic_memories', 
    'chat_history', 'conversation_sessions', 'life_threads', 'reminders',
    'nova_actions', 'nova_followups', 'nova_agenda', 'nova_outreach_log',
    'user_presence', 'emotional_states', 'candidate_synthesis_claims',
    'watchtower_attention_decisions', 'watchtower_timing_logs', 'watchtower_cognitive_signals',
    'nova_guardian_runs', 'telemetry_events'
  ];

  for (const t of tables) {
    const col = t === 'profiles' ? 'id' : 'user_id';
    const { count } = await supabaseAdmin.from(t).select('*', { count: 'exact', head: true }).eq(col, 'a2754adc-3d7e-48ba-b2d7-1e8711d54aa3');
    if (count && count > 0) {
      console.log(`Found ${count} rows in ${t} for a2754adc-3d7e-48ba-b2d7-1e8711d54aa3`);
    }
  }

  // Also check if there are any other user IDs in any tables whatsoever
  console.log('\n--- Checking distinct user_id values across all tables ---');
  for (const t of tables) {
    const col = t === 'profiles' ? 'id' : 'user_id';
    const { data } = await supabaseAdmin.from(t).select(col);
    if (data && data.length > 0) {
      const uids = Array.from(new Set(data.map((r: any) => r[col])));
      console.log(`${t} distinct IDs:`, uids);
    }
  }
}

checkDetails().catch(console.error);
