import { supabaseAdmin } from '../lib/supabase';

async function auditLiveState() {
  const userId = '62f9190b-1e1d-48d5-9667-12cd0bc3114b';
  console.log('=== AUDITING LIVE STATE FOR USER:', userId, '===');

  // 1. Profile
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();
  console.log('\n--- PROFILE ---');
  console.log(JSON.stringify(profile, null, 2));

  // 2. Active memory bubbles
  const { data: bubbles } = await supabaseAdmin
    .from('memory_bubbles')
    .select('*')
    .eq('user_id', userId)
    .eq('is_archived', false);
  console.log('\n--- ACTIVE MEMORY BUBBLES (' + (bubbles?.length || 0) + ') ---');
  for (const b of bubbles || []) {
    console.log(`[${b.id}] label="${b.label}" slug="${b.slug}" type="${b.type || b.bubble_type}" entity_type="${b.entity_type}" rel="${b.relation_type}" parent="${b.parent_bubble_id}" metadata=${JSON.stringify(b.metadata)}`);
  }

  // 3. All family / person / son / tiku / tuku / shreshth bubbles (including archived)
  const { data: allBubbles } = await supabaseAdmin
    .from('memory_bubbles')
    .select('*')
    .eq('user_id', userId);
  console.log('\n--- ALL BUBBLES IN DB (' + (allBubbles?.length || 0) + ') ---');
  for (const b of allBubbles || []) {
    if (b.is_archived) {
      console.log(`ARCHIVED: [${b.id}] label="${b.label}" slug="${b.slug}" rel="${b.relation_type}" metadata=${JSON.stringify(b.metadata)}`);
    }
  }

  // 4. Memories
  const { data: memories } = await supabaseAdmin
    .from('memories')
    .select('*')
    .eq('user_id', userId)
    .eq('is_active', true);
  console.log('\n--- ACTIVE MEMORIES (' + (memories?.length || 0) + ') ---');
  for (const m of memories || []) {
    console.log(`[${m.id}] key="${m.key}" val="${m.raw_value}" bubble_id="${m.bubble_id}" source="${m.source}" metadata=${JSON.stringify(m.metadata)}`);
  }

  // 5. KG Nodes
  const { data: nodes } = await supabaseAdmin
    .from('kg_nodes')
    .select('*')
    .eq('user_id', userId);
  console.log('\n--- KG NODES (' + (nodes?.length || 0) + ') ---');
  for (const n of nodes || []) {
    console.log(`[${n.id}] label="${n.label}" entity_type="${n.entity_type}" bubble_id="${n.bubble_id}" metadata=${JSON.stringify(n.metadata)}`);
  }

  // 6. KG Edges
  const { data: edges } = await supabaseAdmin
    .from('kg_edges')
    .select('*')
    .eq('user_id', userId);
  console.log('\n--- KG EDGES (' + (edges?.length || 0) + ') ---');
  for (const e of edges || []) {
    console.log(`[${e.id}] src="${e.source_node_id}" tgt="${e.target_node_id}" rel="${e.relation_type}" conf=${e.confidence}`);
  }

  // 7. Reminders referencing bubbles
  const { data: reminders } = await supabaseAdmin
    .from('reminders')
    .select('*')
    .eq('user_id', userId);
  console.log('\n--- REMINDERS (' + (reminders?.length || 0) + ') ---');
  for (const r of reminders || []) {
    console.log(`[${r.id}] title="${r.title}" bubble_id="${r.bubble_id}" status="${r.status}"`);
  }

  // 8. Recent chat messages mentioning son, tiku, tuku, shreshth, aryan, sagar
  const { data: messages } = await supabaseAdmin
    .from('messages')
    .select('id, role, content, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(30);
  console.log('\n--- RECENT MESSAGES (30) ---');
  for (const msg of messages || []) {
    if (/son|beta|shreshth|tiku|tuku|aryan|sagar|naam|name/i.test(msg.content)) {
      console.log(`[${msg.created_at}] [${msg.role}]: ${msg.content.replace(/\n/g, ' ')}`);
    }
  }
}

auditLiveState().then(() => setTimeout(() => process.exit(0), 1000)).catch(e => { console.error(e); process.exit(1); });
