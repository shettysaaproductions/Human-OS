import { supabaseAdmin } from '../lib/supabase';

async function checkThreeBubbles() {
  const uid = '62f9190b-1e1d-48d5-9667-12cd0bc3114b';
  const { data: b } = await supabaseAdmin
    .from('memory_bubbles')
    .select('id, label, slug, relation_type, is_archived, metadata')
    .eq('user_id', uid)
    .in('label', ['Sagar', 'Tiku', 'Shreshth']);
  console.log('BUBBLES:');
  console.log(JSON.stringify(b, null, 2));

  const bIds = (b || []).map(x => x.id);
  const { data: m } = await supabaseAdmin
    .from('memories')
    .select('id, key, value, bubble_id, is_archived, lifecycle_state')
    .in('bubble_id', bIds);
  console.log('\nMEMORIES ATTACHED:');
  console.log(JSON.stringify(m, null, 2));

  const { data: r } = await supabaseAdmin
    .from('reminders')
    .select('id, title, bubble_id')
    .in('bubble_id', bIds);
  console.log('\nREMINDERS ATTACHED:');
  console.log(JSON.stringify(r, null, 2));

  const { data: n } = await supabaseAdmin
    .from('kg_nodes')
    .select('id, label, bubble_id')
    .in('bubble_id', bIds);
  console.log('\nKG NODES ATTACHED:');
  console.log(JSON.stringify(n, null, 2));

  if (n && n.length > 0) {
    const nIds = n.map(x => x.id);
    const { data: e } = await supabaseAdmin
      .from('kg_edges')
      .select('id, source_node_id, target_node_id, relation_type');
    const filteredEdges = (e || []).filter(edge => nIds.includes(edge.source_node_id) || nIds.includes(edge.target_node_id));
    console.log('\nKG EDGES ATTACHED:');
    console.log(JSON.stringify(filteredEdges, null, 2));
  }
}

checkThreeBubbles().then(() => setTimeout(() => process.exit(0), 500)).catch(console.error);
