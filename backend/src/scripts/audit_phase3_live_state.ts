import { supabaseAdmin } from '../lib/supabase';

async function auditLiveState() {
  console.log('=== AUDITING LIVE SUPABASE STATE ===\n');

  // 1. memory_bubbles
  const { data: allBubbles } = await supabaseAdmin.from('memory_bubbles').select('*');
  const activeBubbles = allBubbles?.filter((b) => !b.is_archived) || [];
  const archivedBubbles = allBubbles?.filter((b) => b.is_archived) || [];
  const activeEntities = activeBubbles.filter((b) => b.bubble_type === 'entity' || b.bubble_type === 'branch');
  const activeDomains = activeBubbles.filter((b) => b.bubble_type === 'domain');

  console.log(`memory_bubbles:`);
  console.log(`  Total: ${allBubbles?.length}`);
  console.log(`  Active Total: ${activeBubbles.length}`);
  console.log(`  Active Entities: ${activeEntities.length}`);
  console.log(`  Active Domains: ${activeDomains.length}`);
  console.log(`  Archived: ${archivedBubbles.length}`);

  // Count relationships in active bubbles
  let totalActiveRels = 0;
  for (const b of activeBubbles) {
    const meta = (b.metadata as any) || {};
    const rels = Array.isArray(meta.relationships) ? meta.relationships : [];
    totalActiveRels += rels.length;
    if (rels.length > 0) {
      console.log(`  Bubble ${b.label} (${b.id}) has ${rels.length} relationship(s):`, rels);
    }
  }
  console.log(`  Total Active Relationships in metadata.relationships: ${totalActiveRels}\n`);

  // 2. memories
  const { data: allMemories } = await supabaseAdmin.from('memories').select('*');
  const activeMemories = allMemories?.filter((m) => !m.is_archived) || [];
  const withBubbleId = activeMemories.filter((m) => m.bubble_id != null);
  const withoutBubbleId = activeMemories.filter((m) => m.bubble_id == null);

  console.log(`memories:`);
  console.log(`  Total: ${allMemories?.length}`);
  console.log(`  Active Total: ${activeMemories.length}`);
  console.log(`  Active With bubble_id: ${withBubbleId.length}`);
  console.log(`  Active Without bubble_id: ${withoutBubbleId.length}\n`);

  console.log(`Details of 18 Active Memories WITHOUT bubble_id:`);
  withoutBubbleId.forEach((m, idx) => {
    console.log(`  [${idx + 1}] ID: ${m.id} | Key: ${m.key} | Value: ${m.value} | Type: ${m.memory_type} | Created: ${m.created_at}`);
  });
  console.log('');

  // 3. kg_nodes
  const { data: allKgNodes } = await supabaseAdmin.from('kg_nodes').select('*');
  const nodesWithBubble = allKgNodes?.filter((n) => n.bubble_id != null) || [];
  const nodesWithoutBubble = allKgNodes?.filter((n) => n.bubble_id == null) || [];

  console.log(`kg_nodes:`);
  console.log(`  Total: ${allKgNodes?.length}`);
  console.log(`  With bubble_id: ${nodesWithBubble.length}`);
  console.log(`  Without bubble_id: ${nodesWithoutBubble.length}\n`);

  if (nodesWithoutBubble.length > 0) {
    console.log(`Unmapped kg_nodes without bubble_id:`);
    nodesWithoutBubble.forEach((n) => {
      console.log(`  ID: ${n.id} | User: ${n.user_id} | Name: "${n.name}" | EntityType: "${n.entity_type}" | Attrs:`, n.attributes);
    });
    console.log('');
  }

  // 4. kg_edges
  const { data: allKgEdges } = await supabaseAdmin.from('kg_edges').select('*');
  console.log(`kg_edges:`);
  console.log(`  Total: ${allKgEdges?.length}\n`);

  // 5. Test RPC privileges
  try {
    const { data: rpcRes, error: rpcErr } = await supabaseAdmin.rpc('canonical_merge_entities', {
      p_user_id: '00000000-0000-0000-0000-000000000000',
      p_source_bubble_id: '00000000-0000-0000-0000-000000000000',
      p_target_bubble_id: '00000000-0000-0000-0000-000000000000',
    });
    console.log('canonical_merge_entities RPC call test with dummy UUIDs:');
    console.log('  Result:', rpcRes);
    console.log('  Error:', rpcErr);
  } catch (e: any) {
    console.log('  RPC test exception:', e.message);
  }
}

auditLiveState().catch(console.error);
