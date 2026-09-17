import { supabaseAdmin } from '../lib/supabase';

async function main() {
  const userId = '62f9190b-1e1d-48d5-9667-12cd0bc3114b';
  console.log(`=== INSPECTING MEMORIES FOR ${userId} ===\n`);

  const { data: memories, error } = await supabaseAdmin
    .from('memories')
    .select('id, key, value, memory_type, bubble_id, is_archived, lifecycle_state, source_authority, source_message, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error:', error);
    return;
  }

  console.log(`Total memories: ${memories?.length || 0}`);
  
  // Find all active memories
  const active = (memories || []).filter(m => !m.is_archived && m.lifecycle_state !== 'superseded');
  console.log(`Active memories: ${active.length}\n`);

  console.log('--- ALL ACTIVE MEMORIES ---');
  active.forEach(m => {
    console.log(`[${m.key}] = "${m.value}" (type: ${m.memory_type}, bubble: ${m.bubble_id}, source: ${m.source_authority}, msg: "${(m.source_message || '').slice(0, 60)}")`);
  });

  // Also check memory bubbles table if exists
  const { data: bubbles, error: bErr } = await supabaseAdmin
    .from('memory_bubbles')
    .select('*')
    .eq('user_id', userId);

  if (!bErr && bubbles) {
    console.log(`\n--- MEMORY BUBBLES TABLE (${bubbles.length}) ---`);
    bubbles.forEach(b => console.log(JSON.stringify(b)));
  } else if (bErr) {
    console.log('\nmemory_bubbles table error/status:', bErr.message);
  }
}

main().catch(console.error);
