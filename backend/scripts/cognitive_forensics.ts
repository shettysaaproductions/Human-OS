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
  console.log(`=== STARTING FORENSICS FOR ${targetId} ===`);

  // A. CHAT TIMELINE
  console.log('\n--- CHAT TIMELINE (COLOR MESSAGES) ---');
  const { data: chatHistory, error: chatError } = await supabaseAdmin
    .from('chat_history')
    .select('*')
    .eq('user_id', targetId)
    .order('created_at', { ascending: true });
    
  if (chatError) console.error("Chat fetch error:", chatError);

  const colorKeywords = ['color', 'colour', 'blue', 'red', 'favorite', 'favourite', 'prefer', 'actually', 'change', 'instead', 'no', 'not'];
  const colorMessages = (chatHistory || []).filter(msg => {
    const text = (msg.content || '').toLowerCase();
    return colorKeywords.some(kw => text.includes(kw));
  });

  colorMessages.forEach(msg => {
    console.log(`[${msg.created_at}] ${msg.role.toUpperCase()} (msg_id: ${msg.id}) (conv: ${msg.conversation_id}): ${msg.content}`);
  });
  console.log(`TOTAL COLOR CHATS FOUND: ${colorMessages.length}`);

  // B & C & D. MEMORY PIPELINE & CANONICAL KEYS
  console.log('\n--- MEMORIES (DURABLE) ---');
  const { data: memories, error: memError } = await supabaseAdmin
    .from('memories')
    .select('*')
    .eq('user_id', targetId)
    .order('created_at', { ascending: true });

  if (memError) console.error("Memories fetch error:", memError);
  
  const colorMemories = (memories || []).filter(m => 
    (m.key || '').toLowerCase().includes('color') || 
    (m.key || '').toLowerCase().includes('colour') ||
    (m.value || '').toLowerCase().includes('red') ||
    (m.value || '').toLowerCase().includes('blue')
  );

  colorMemories.forEach(m => {
    console.log(`[MEM] id: ${m.id} | key: ${m.key} | val: ${m.value} | status: ${m.lifecycle_state || m.promotion_status || 'ACTIVE'} | auth: ${m.source_authority} | created: ${m.created_at} | updated: ${m.updated_at} | source_msg: ${m.source_message_id}`);
  });

  console.log('\n--- WORKING MEMORY ---');
  const { data: wm, error: wmError } = await supabaseAdmin
    .from('working_memory')
    .select('*')
    .eq('user_id', targetId)
    .order('created_at', { ascending: true });

  const colorWm = (wm || []).filter(m => 
    (m.key || '').toLowerCase().includes('color') || 
    (m.key || '').toLowerCase().includes('colour')
  );

  colorWm.forEach(m => {
    console.log(`[WM] id: ${m.id} | key: ${m.key} | val: ${m.value} | status: ${m.promotion_status} | created: ${m.created_at} | updated: ${m.updated_at} | source_msg: ${m.source_message_id}`);
  });

  console.log('\n--- SHORT TERM MEMORIES ---');
  const { data: stm, error: stmError } = await supabaseAdmin
    .from('short_term_memories')
    .select('*')
    .eq('user_id', targetId)
    .order('created_at', { ascending: true });

  const colorStm = (stm || []).filter(m => 
    (m.content || '').toLowerCase().includes('color') || 
    (m.content || '').toLowerCase().includes('colour')
  );
  colorStm.forEach(m => {
    console.log(`[STM] id: ${m.id} | content: ${m.content} | created: ${m.created_at}`);
  });

  // H & I. WATCHTOWER / COGNITIVE SIGNALS
  console.log('\n--- WATCHTOWER SIGNALS ---');
  const { data: signals, error: sigError } = await supabaseAdmin
    .from('watchtower_cognitive_signals')
    .select('*')
    .eq('user_id', targetId)
    .order('created_at', { ascending: true });

  (signals || []).forEach(s => {
    console.log(`[SIG] id: ${s.id} | type: ${s.signal_type} | created: ${s.created_at}`);
  });

  console.log('\n--- BACKGROUND JOBS / OUTREACH ---');
  const { data: outreach, error: outError } = await supabaseAdmin
    .from('nova_outreach_log')
    .select('*')
    .eq('user_id', targetId)
    .order('created_at', { ascending: true });

  (outreach || []).forEach(o => {
    console.log(`[OUTREACH] id: ${o.id} | trigger: ${o.trigger_source} | created: ${o.created_at}`);
  });

  console.log('\n=== END FORENSICS ===');
}

run();
