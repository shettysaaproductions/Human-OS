import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function run() {
  const targetId = '80547977-5bdd-4252-a1a1-7e06902d5c8d';
  console.log(`=== REFINED CHAT TIMELINE FOR ${targetId} ===`);

  const { data: chatHistory, error: chatError } = await supabaseAdmin
    .from('chat_history')
    .select('*')
    .eq('user_id', targetId)
    .gte('created_at', '2026-09-01T20:15:00Z')
    .order('created_at', { ascending: true });
    
  if (chatError) console.error("Chat fetch error:", chatError);

  chatHistory?.forEach(msg => {
    console.log(`[${msg.created_at}] ${msg.role.toUpperCase()} (id: ${msg.id}): ${msg.content}`);
  });

  console.log('\n--- ALL MEMORIES ---');
  const { data: mems } = await supabaseAdmin
    .from('memories')
    .select('*')
    .eq('user_id', targetId)
    .order('created_at', { ascending: true });
    
  mems?.forEach(m => console.log(`[MEM] id: ${m.id} | key: ${m.key} | val: ${m.value} | status: ${m.lifecycle_state || m.promotion_status || 'ACTIVE'}`));

  console.log('\n--- ALL WORKING MEMORY ---');
  const { data: wm } = await supabaseAdmin
    .from('working_memory')
    .select('*')
    .eq('user_id', targetId)
    .order('created_at', { ascending: true });
    
  wm?.forEach(m => console.log(`[WM] id: ${m.id} | key: ${m.key} | val: ${m.value} | status: ${m.promotion_status}`));

  console.log('\n--- ALL SHORT TERM MEMORIES ---');
  const { data: stm } = await supabaseAdmin
    .from('short_term_memories')
    .select('*')
    .eq('user_id', targetId)
    .order('created_at', { ascending: true });
    
  stm?.forEach(m => console.log(`[STM] id: ${m.id} | content: ${m.content}`));

  console.log('\n--- CANDIDATE CLAIMS / PROMOTION ---');
  // I need to find the candidate claims table. Let's check table name.
  // could be candidate_synthesis_claims, memory_candidates, etc.
  const tables = ['candidate_synthesis_claims', 'memory_candidates', 'nova_cognitive_doubts', 'cognitive_claims'];
  for (const t of tables) {
    try {
      const { data } = await supabaseAdmin.from(t).select('*').limit(5);
      if (data) {
        console.log(`Found table: ${t} with ${data.length} records`);
      }
    } catch(e) {}
  }
}
run();
