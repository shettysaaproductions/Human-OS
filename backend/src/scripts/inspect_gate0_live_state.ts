/**
 * inspect_gate0_live_state.ts
 *
 * Diagnostic script for Gate 0 inspection:
 * - Active family entity bubbles
 * - relation_type distribution across all active entity bubbles
 * - Aliases across all bubbles
 * - Active memories without bubble_id
 * - Active memories grouped by bubble
 * - kg_nodes mapping (bubble_id foreign key linkage)
 * - kg_edges (count and relationships)
 * - Duplicate relationship/entity candidates
 * - Relevant RPCs and permissions
 */

import { supabaseAdmin } from '../lib/supabase';

async function main() {
  console.log('====================================================');
  console.log('🔍 GATE 0 — LIVE SUPABASE STATE INSPECTION');
  console.log('====================================================\n');

  // 1. Get all users or the main active user
  const { data: users, error: uErr } = await supabaseAdmin
    .from('users')
    .select('id, email, full_name');

  if (uErr) {
    console.warn('Warning fetching users:', uErr.message);
  }

  console.log(`Users in database: ${users?.length || 0}`);
  if (users && users.length > 0) {
    users.forEach(u => console.log(`  - ${u.id}: ${u.email} (${u.full_name})`));
  }

  // 2. Fetch all memory_bubbles
  const { data: allBubbles, error: bErr } = await supabaseAdmin
    .from('memory_bubbles')
    .select('*')
    .order('created_at', { ascending: true });

  if (bErr) {
    console.error('Error fetching memory_bubbles:', bErr);
    return;
  }

  const activeBubbles = allBubbles.filter(b => !b.is_archived);
  const archivedBubbles = allBubbles.filter(b => b.is_archived);
  const activeEntities = activeBubbles.filter(b => b.bubble_type === 'entity');
  const activeFamilyEntities = activeEntities.filter(b => b.domain_key === 'family');

  console.log(`\n📦 Memory Bubbles:`);
  console.log(`  Total: ${allBubbles.length}`);
  console.log(`  Active: ${activeBubbles.length} (Entities: ${activeEntities.length}, Domains/Branches: ${activeBubbles.length - activeEntities.length})`);
  console.log(`  Archived: ${archivedBubbles.length}`);
  console.log(`  Active Family Entities: ${activeFamilyEntities.length}`);

  console.log('\n👨‍👩‍👧 Active Family Entity Bubbles:');
  for (const b of activeFamilyEntities) {
    const meta = (b.metadata as Record<string, any>) || {};
    console.log(`  - [${b.id}] "${b.label}" (slug: ${b.slug})`);
    console.log(`      relation_type: ${b.relation_type}`);
    console.log(`      entity_type: ${meta.entity_type}`);
    console.log(`      aliases: ${JSON.stringify(meta.aliases || [])}`);
    console.log(`      relationships: ${JSON.stringify(meta.relationships || [])}`);
  }

  // 3. Relation Type Distribution
  const relDist: Record<string, number> = {};
  const entityTypeDist: Record<string, number> = {};
  for (const b of activeEntities) {
    const rel = b.relation_type || '(none)';
    relDist[rel] = (relDist[rel] || 0) + 1;
    const et = (b.metadata as any)?.entity_type || '(unspecified)';
    entityTypeDist[et] = (entityTypeDist[et] || 0) + 1;
  }

  console.log('\n📊 Relation Type Distribution (Active Entities):');
  for (const [rel, count] of Object.entries(relDist)) {
    console.log(`  - ${rel}: ${count}`);
  }

  console.log('\n📊 Entity Type Distribution:');
  for (const [et, count] of Object.entries(entityTypeDist)) {
    console.log(`  - ${et}: ${count}`);
  }

  // 4. Aliases summary across all active entities
  console.log('\n🏷️ Aliases Across Active Entities:');
  for (const b of activeEntities) {
    const meta = (b.metadata as Record<string, any>) || {};
    if (meta.aliases && meta.aliases.length > 0) {
      console.log(`  - "${b.label}" (${b.id}): ${JSON.stringify(meta.aliases)}`);
    }
  }

  // 5. Memories
  const { data: allMemories, error: mErr } = await supabaseAdmin
    .from('memories')
    .select('*');

  if (mErr) {
    console.error('Error fetching memories:', mErr);
    return;
  }

  const activeMemories = allMemories.filter(m => !m.is_archived && m.lifecycle_state !== 'SUPERSEDED' && m.lifecycle_state !== 'INVALIDATED');
  const memoriesWithoutBubble = activeMemories.filter(m => !m.bubble_id);
  const memoriesWithBubble = activeMemories.filter(m => !!m.bubble_id);

  console.log(`\n🧠 Memories:`);
  console.log(`  Total: ${allMemories.length}`);
  console.log(`  Active Total: ${activeMemories.length}`);
  console.log(`  Active with bubble_id: ${memoriesWithBubble.length}`);
  console.log(`  Active without bubble_id: ${memoriesWithoutBubble.length}`);

  console.log('\n👤 Active Memories without bubble_id:');
  for (const m of memoriesWithoutBubble) {
    console.log(`  - [${m.key}] = "${m.value}" (type: ${m.memory_type})`);
  }

  console.log('\n🔗 Active Memories Grouped by Bubble:');
  const memsByBubble = new Map<string, any[]>();
  for (const m of memoriesWithBubble) {
    const list = memsByBubble.get(m.bubble_id) || [];
    list.push(m);
    memsByBubble.set(m.bubble_id, list);
  }

  for (const [bubbleId, mems] of memsByBubble.entries()) {
    const bubble = allBubbles.find(b => b.id === bubbleId);
    const bubbleName = bubble ? `"${bubble.label}" (${bubble.domain_key}, ${bubble.relation_type || 'no rel'}, is_archived: ${bubble.is_archived})` : 'UNKNOWN BUBBLE';
    console.log(`  Bubble [${bubbleId}] ${bubbleName} — ${mems.length} memories:`);
    for (const m of mems) {
      console.log(`      • ${m.key}: "${m.value}"`);
    }
  }

  // 6. kg_nodes
  const { data: kgNodes, error: kgnErr } = await supabaseAdmin
    .from('kg_nodes')
    .select('*');

  if (kgnErr) {
    console.error('Error fetching kg_nodes:', kgnErr);
    return;
  }

  const nodesWithBubble = kgNodes.filter(n => !!n.bubble_id);
  const nodesWithoutBubble = kgNodes.filter(n => !n.bubble_id);

  console.log(`\n🌐 kg_nodes:`);
  console.log(`  Total: ${kgNodes.length}`);
  console.log(`  With bubble_id: ${nodesWithBubble.length}`);
  console.log(`  Without bubble_id (unmapped): ${nodesWithoutBubble.length}`);
  for (const n of kgNodes) {
    console.log(`  - [${n.id}] "${n.name}" (type: ${n.entity_type}, bubble_id: ${n.bubble_id || 'NULL'})`);
  }

  // 7. kg_edges
  const { data: kgEdges, error: kgeErr } = await supabaseAdmin
    .from('kg_edges')
    .select('*, source:kg_nodes!kg_edges_source_node_id_fkey(name), target:kg_nodes!kg_edges_target_node_id_fkey(name)');

  if (kgeErr) {
    console.error('Error fetching kg_edges:', kgeErr);
    return;
  }

  console.log(`\n🕸️ kg_edges (${kgEdges.length} total):`);
  for (const e of kgEdges) {
    console.log(`  - ${e.source?.name} --[${e.relation_type} (wt: ${e.weight})]--> ${e.target?.name} (id: ${e.id})`);
  }

  // 8. Check potential duplicate candidates
  console.log('\n👥 Duplicate Candidate Check:');
  const labelMap = new Map<string, any[]>();
  for (const b of activeEntities) {
    const norm = b.label.toLowerCase().trim();
    const list = labelMap.get(norm) || [];
    list.push(b);
    labelMap.set(norm, list);
  }

  let dupCount = 0;
  for (const [norm, list] of labelMap.entries()) {
    if (list.length > 1) {
      dupCount++;
      console.log(`  ⚠️ Duplicate label "${norm}": ${list.map(b => b.id).join(', ')}`);
    }
  }
  if (dupCount === 0) {
    console.log('  ✅ No duplicate labels found among active entities.');
  }

  // Check same relation_type in same domain
  const relMap = new Map<string, any[]>();
  for (const b of activeFamilyEntities) {
    if (b.relation_type) {
      const key = `${b.domain_key}:${b.relation_type.toLowerCase()}`;
      const list = relMap.get(key) || [];
      list.push(b);
      relMap.set(key, list);
    }
  }
  for (const [key, list] of relMap.entries()) {
    if (list.length > 1) {
      console.log(`  ℹ️ Multiple active entities for relation "${key}": ${list.map(b => `"${b.label}" (${b.id})`).join(', ')}`);
    }
  }

  // 9. Check RPCs
  console.log('\n🔒 Checking RPCs:');
  try {
    const { data: rpcTest, error: rpcErr } = await supabaseAdmin.rpc('canonical_merge_entities', {
      p_user_id: '00000000-0000-0000-0000-000000000000',
      p_source_bubble_id: '00000000-0000-0000-0000-000000000000',
      p_target_bubble_id: '00000000-0000-0000-0000-000000000000',
    });
    console.log(`  canonical_merge_entities response (dummy): data=${JSON.stringify(rpcTest)}, err=${rpcErr?.message || 'none'}, code=${rpcErr?.code}`);
  } catch (err: any) {
    console.log(`  canonical_merge_entities RPC call error: ${err.message}`);
  }

  console.log('\n====================================================');
  console.log('🏁 GATE 0 INSPECTION COMPLETE');
  console.log('====================================================');
}

main().catch(console.error);
