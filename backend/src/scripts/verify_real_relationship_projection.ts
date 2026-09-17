import { supabaseAdmin } from '../lib/supabase';
import { canonicalEntityEngine } from '../services/CanonicalEntityEngine';
import { canonicalGraphService } from '../services/CanonicalGraphService';

async function main() {
  console.log('=== GATE E: VERIFYING REAL RELATIONSHIP PROJECTION IN PRODUCTION ===\n');

  const testUserId = '62f9190b-1e1d-48d5-9667-12cd0bc3114b'; // Live test user

  // 1. Create two test canonical entities in memory_bubbles
  const testLabelA = `Test_Persona_A_${Date.now()}`;
  const testLabelB = `Test_Persona_B_${Date.now()}`;

  console.log(`1. Creating two canonical test entities: "${testLabelA}" and "${testLabelB}"...`);
  const entityA = await canonicalEntityEngine.createOrResolveEntity(testUserId, testLabelA, 'Colleague', 'work');
  const entityB = await canonicalEntityEngine.createOrResolveEntity(testUserId, testLabelB, 'Friend', 'lifestyle');

  console.log(`   Entity A ID: ${entityA.id} (slug: ${entityA.slug})`);
  console.log(`   Entity B ID: ${entityB.id} (slug: ${entityB.slug})`);

  try {
    // 2. Create semantic relationship A -> B ("colleague") with inverse "colleague"
    console.log('\n2. Creating semantic relationship: A -> B ("colleague")...');
    const rel1 = await canonicalEntityEngine.createOrUpdateRelationship(
      testUserId,
      entityA.id,
      entityB.id,
      'colleague',
      'colleague',
      { source: 'user_chat', confidence: 0.96 }
    );
    console.log(`   Created Relationship: ${rel1.relationshipId}, status: ${rel1.status}`);

    // Also create second relationship type between same entities: A -> B ("friend") to test multiple relation types!
    console.log('   Creating second semantic relationship between same entities: A -> B ("friend")...');
    const rel2 = await canonicalEntityEngine.createOrUpdateRelationship(
      testUserId,
      entityA.id,
      entityB.id,
      'friend',
      'friend',
      { source: 'user_chat', confidence: 0.99 }
    );
    console.log(`   Created Relationship: ${rel2.relationshipId}, status: ${rel2.status}`);

    // 3. Verify memory_bubbles.metadata.relationships in live database
    console.log('\n3. Verifying live database memory_bubbles.metadata.relationships...');
    const { data: bubbleA } = await supabaseAdmin.from('memory_bubbles').select('*').eq('id', entityA.id).single();
    const { data: bubbleB } = await supabaseAdmin.from('memory_bubbles').select('*').eq('id', entityB.id).single();

    const relsA = (bubbleA?.metadata as any)?.relationships || [];
    const relsB = (bubbleB?.metadata as any)?.relationships || [];

    console.log(`   Bubble A has ${relsA.length} relationships in metadata:`, relsA.map((r: any) => `${r.relationType}->${r.targetEntityName}`));
    console.log(`   Bubble B has ${relsB.length} inverse relationships in metadata:`, relsB.map((r: any) => `${r.relationType}->${r.targetEntityName}`));

    if (relsA.length < 2 || relsB.length < 2) {
      throw new Error('VERIFICATION_FAILED: Expected at least 2 distinct relationships on both entities!');
    }

    // 4. Run rebuildProjections() to test deterministic projection synchronization
    console.log('\n4. Running canonicalGraphService.rebuildProjections()...');
    const rebuildResult = await canonicalGraphService.rebuildProjections(testUserId);
    console.log('   Rebuild result:', rebuildResult);

    // 5. Verify kg_nodes exist with bubble_id in live Supabase
    console.log('\n5. Verifying kg_nodes in live Supabase...');
    const { data: kgNodeA } = await supabaseAdmin.from('kg_nodes').select('*').eq('bubble_id', entityA.id).single();
    const { data: kgNodeB } = await supabaseAdmin.from('kg_nodes').select('*').eq('bubble_id', entityB.id).single();

    if (!kgNodeA || !kgNodeB) {
      throw new Error('VERIFICATION_FAILED: kg_nodes with bubble_id were not created!');
    }
    console.log(`   kg_node A: ID ${kgNodeA.id}, bubble_id: ${kgNodeA.bubble_id}, name: "${kgNodeA.name}"`);
    console.log(`   kg_node B: ID ${kgNodeB.id}, bubble_id: ${kgNodeB.bubble_id}, name: "${kgNodeB.name}"`);

    // 6. Verify kg_edges exist in live Supabase linking both nodes with both relation types
    console.log('\n6. Verifying kg_edges in live Supabase...');
    const { data: edges } = await supabaseAdmin
      .from('kg_edges')
      .select('*')
      .eq('user_id', testUserId)
      .eq('source_node_id', kgNodeA.id)
      .eq('target_node_id', kgNodeB.id);

    console.log(`   Found ${edges?.length || 0} directed edge(s) from A -> B:`, edges?.map((e) => e.relation_type));

    if (!edges || edges.length < 2) {
      throw new Error(`VERIFICATION_FAILED: Expected 2 distinct edges in kg_edges, got ${edges?.length || 0}`);
    }

    const hasColleague = edges.some((e) => e.relation_type === 'COLLEAGUE');
    const hasFriend = edges.some((e) => e.relation_type === 'FRIEND');
    if (!hasColleague || !hasFriend) {
      throw new Error('VERIFICATION_FAILED: Both COLLEAGUE and FRIEND edges must exist simultaneously!');
    }
    console.log('   ✓ Multiple distinct relationship types preserved in kg_edges: COLLEAGUE and FRIEND!');

    // 7. Test Idempotency: Re-running rebuildProjections() should produce the exact same count
    console.log('\n7. Testing Idempotency: Re-running rebuildProjections()...');
    const rebuildResult2 = await canonicalGraphService.rebuildProjections(testUserId);
    console.log('   Second rebuild result:', rebuildResult2);

    const { data: edgesAfterSecondRebuild } = await supabaseAdmin
      .from('kg_edges')
      .select('*')
      .eq('user_id', testUserId)
      .eq('source_node_id', kgNodeA.id)
      .eq('target_node_id', kgNodeB.id);

    if (edgesAfterSecondRebuild?.length !== 2) {
      throw new Error(`IDEMPOTENCY_FAILED: Edge count changed after second rebuild: ${edgesAfterSecondRebuild?.length}`);
    }
    console.log('   ✓ Rebuild is 100% idempotent (0 duplicates generated)!');

    console.log('\n✅ GATE E PROVEN IN PRODUCTION: Real relationships and graph projections operate deterministically.');
  } finally {
    // Clean up test fixtures safely
    console.log('\n8. Cleaning up test fixtures from production database...');
    // Delete edges
    const { data: nodeA } = await supabaseAdmin.from('kg_nodes').select('id').eq('bubble_id', entityA.id).maybeSingle();
    const { data: nodeB } = await supabaseAdmin.from('kg_nodes').select('id').eq('bubble_id', entityB.id).maybeSingle();
    if (nodeA) await supabaseAdmin.from('kg_edges').delete().or(`source_node_id.eq.${nodeA.id},target_node_id.eq.${nodeA.id}`);
    if (nodeB) await supabaseAdmin.from('kg_edges').delete().or(`source_node_id.eq.${nodeB.id},target_node_id.eq.${nodeB.id}`);
    if (nodeA) await supabaseAdmin.from('kg_nodes').delete().eq('id', nodeA.id);
    if (nodeB) await supabaseAdmin.from('kg_nodes').delete().eq('id', nodeB.id);
    await supabaseAdmin.from('memory_bubbles').delete().eq('id', entityA.id);
    await supabaseAdmin.from('memory_bubbles').delete().eq('id', entityB.id);
    console.log('   ✓ Test fixtures cleaned up cleanly.');
  }
}

main().catch((err) => {
  console.error('Verification error:', err);
  process.exit(1);
});
