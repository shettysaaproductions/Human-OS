import { supabaseAdmin } from '../lib/supabase';

async function main() {
  const userId = '62f9190b-1e1d-48d5-9667-12cd0bc3114b';
  const nodeId = 'ec399de2-5a46-48b3-9d7a-484965409023';

  console.log('=== GATE D: RECONCILING UNMAPPED KG NODE ===');

  const { data: node, error } = await supabaseAdmin
    .from('kg_nodes')
    .select('*')
    .eq('id', nodeId)
    .single();

  if (error || !node) {
    console.log('Node not found or already reconciled:', error?.message);
    return;
  }

  console.log('Found unmapped kg_node:', node);

  // Check if any canonical bubble exists for this node
  const { data: matchedBubble } = await supabaseAdmin
    .from('memory_bubbles')
    .select('id, label, bubble_type')
    .eq('user_id', userId)
    .ilike('label', node.name)
    .maybeSingle();

  if (matchedBubble) {
    console.log(`Connecting to existing canonical bubble: ${matchedBubble.label} (${matchedBubble.id})`);
    await supabaseAdmin
      .from('kg_nodes')
      .update({ bubble_id: matchedBubble.id, updated_at: new Date().toISOString() })
      .eq('id', nodeId);
  } else {
    console.log('No canonical bubble exists for legacy orphan keyword "our". Recording audit event before safe removal...');
    
    // Record audit event in memory_events
    await supabaseAdmin.from('memory_events').insert({
      user_id: userId,
      memory_id: null,
      action: 'ARCHIVED_STALE_ORPHAN_KG_NODE',
      old_value: JSON.stringify(node),
      new_value: 'pruned_legacy_orphan',
      created_at: new Date().toISOString(),
    });

    // Remove stale orphan projection
    const { error: delErr } = await supabaseAdmin
      .from('kg_nodes')
      .delete()
      .eq('id', nodeId);

    if (delErr) {
      throw new Error(`Failed to delete orphan kg_node: ${delErr.message}`);
    }
    console.log('✓ Successfully pruned stale orphan kg_node with audit trail.');
  }

  // Verify invariant: 0 kg_nodes without bubble_id
  const { data: unmappedRemaining } = await supabaseAdmin
    .from('kg_nodes')
    .select('id, name')
    .is('bubble_id', null);

  console.log(`Unmapped kg_nodes remaining: ${unmappedRemaining?.length || 0}`);
  if ((unmappedRemaining?.length || 0) === 0) {
    console.log('✅ GATE D INVARIANT SATISFIED: 100% of kg_nodes have a deterministic canonical bubble_id.');
  } else {
    throw new Error('GATE D FAILED: There are still unmapped kg_nodes!');
  }
}

main().catch(console.error);
