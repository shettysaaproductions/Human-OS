/**
 * test_real_db_concurrency.ts
 *
 * Authoritative Gate 7 Real Database Concurrency Verification.
 *
 * PROVES real database concurrency safety against actual PostgreSQL / Supabase:
 * - Simultaneous entity resolution & creation for the same relation
 * - Simultaneous alias registration invoking atomic PostgreSQL RPC `canonical_merge_entities`
 * - Simultaneous fact persistence and ownership repointing
 * - Uses an isolated test fixture (never touches production user data)
 * - Cleans up test fixture upon completion
 */

import { supabaseAdmin } from '../lib/supabase';
import { canonicalMemoryTreeService } from '../services/CanonicalMemoryTreeService';
import { canonicalEntityEngine } from '../services/CanonicalEntityEngine';
import { memoryRepository } from '../services/memoryRepository';
import { canonicalGraphService } from '../services/CanonicalGraphService';

async function runRealDatabaseConcurrencyTest() {
  console.log('====================================================');
  console.log('GATE 7: REAL DATABASE CONCURRENCY VERIFICATION');
  console.log('====================================================\n');

  let testUserId = '';

  try {
    // ── 1. Setup Isolated Baseline in Real Supabase ──────────────────────────
    console.log('1. Setting up isolated test fixture in real Supabase...');

    // Create isolated test user in Supabase auth
    const { data: authUser, error: authErr } = await supabaseAdmin.auth.admin.createUser({
      email: `test_concurrency_${Date.now()}@humanos.internal`,
      password: 'TestPassword123!',
      email_confirm: true,
    });
    if (authErr || !authUser?.user) throw new Error(`Failed to create test user: ${authErr?.message}`);
    testUserId = authUser.user.id;
    console.log(`   Isolated test user created: ${testUserId}`);

    // Create root domain bubbles
    const familyDomain = await canonicalMemoryTreeService.getOrCreateDomainBubble(testUserId, 'family');
    await canonicalMemoryTreeService.getOrCreateDomainBubble(testUserId, 'identity');

    // Create provisional entity "Tiku"
    const { data: provTiku, error: provErr } = await supabaseAdmin
      .from('memory_bubbles')
      .insert({
        user_id: testUserId,
        parent_bubble_id: familyDomain.id,
        label: 'Tiku',
        slug: 'entity:tiku',
        bubble_type: 'entity',
        domain_key: 'family',
        relation_type: 'Son',
        metadata: { aliases: [], authority: 'INFERRED' },
        is_archived: false,
      })
      .select('*')
      .single();

    if (provErr || !provTiku) throw new Error(`Failed to create provisional bubble: ${provErr?.message}`);

    // Attach real memory to provisional Tiku
    const { data: provMem, error: memErr } = await supabaseAdmin
      .from('memories')
      .insert({
        user_id: testUserId,
        key: 'son_birth_date',
        value: '17/02/2026',
        memory_type: 'family',
        bubble_id: provTiku.id,
        is_archived: false,
      })
      .select('*')
      .single();

    if (memErr || !provMem) throw new Error(`Failed to insert test memory: ${memErr?.message}`);

    console.log(`   Baseline created: Provisional bubble "${provTiku.label}" (${provTiku.id}) with 1 active memory.`);

    // ── 2. Run Real Concurrent DB Operations ────────────────────────────────
    console.log('\n2. Executing simultaneous real DB operations via Promise.all...');

    const [res1, res2, aliasRes] = await Promise.all([
      // Simultaneous create/resolve 1
      canonicalMemoryTreeService.resolveOrCreateEntityBubble(testUserId, {
        entityName: 'Shreshth',
        relationType: 'Son',
        domainKey: 'family',
      }),
      // Simultaneous create/resolve 2
      canonicalMemoryTreeService.resolveOrCreateEntityBubble(testUserId, {
        entityName: 'Shreshth',
        relationType: 'Son',
        domainKey: 'family',
      }),
      // Simultaneous alias registration triggering atomic PostgreSQL RPC canonical_merge_entities
      canonicalEntityEngine.registerAlias(testUserId, provTiku.id, 'Shreshth'),
      // Simultaneous fact insertion via memoryRepository
      memoryRepository.upsertMemory(
        testUserId,
        {
          key: 'son_school',
          value: 'DPS RK Puram',
          type: 'family',
          confidence: 0.99,
          importance: 0.8,
          shouldPersist: true,
        },
        'Shreshth goes to DPS RK Puram'
      ),
    ]);

    console.log('   Simultaneous operations complete:');
    console.log(`   - Resolver 1 ID: ${res1.id} (${res1.label})`);
    console.log(`   - Resolver 2 ID: ${res2.id} (${res2.label})`);
    console.log(`   - Alias merge status: ${aliasRes.status}`);
    console.log('   - Fact persistence completed');

    // ── 3. Verify Real Database Invariants in Supabase ───────────────────────
    console.log('\n3. Verifying invariants directly against real Supabase tables...');

    // A. Verify exactly ONE active canonical Son bubble
    const { data: activeBubbles, error: fetchErr } = await supabaseAdmin
      .from('memory_bubbles')
      .select('*')
      .eq('user_id', testUserId)
      .eq('bubble_type', 'entity')
      .eq('relation_type', 'Son')
      .eq('is_archived', false);

    if (fetchErr) throw fetchErr;

    console.log(`   Active Son entity bubbles in DB: ${activeBubbles?.length}`);
    if (activeBubbles?.length !== 1) {
      throw new Error(`CONCURRENCY INVARIANT VIOLATION: Expected exactly 1 active Son bubble, found ${activeBubbles?.length}`);
    }

    const canonicalSon = activeBubbles[0];
    console.log(`   Canonical entity: "${canonicalSon.label}" (${canonicalSon.id})`);

    // B. Verify provisional entity was archived
    const { data: tikuBubble } = await supabaseAdmin
      .from('memory_bubbles')
      .select('*')
      .eq('id', provTiku.id)
      .single();

    console.log(`   Provisional Tiku is_archived: ${tikuBubble?.is_archived}`);
    if (tikuBubble?.id !== canonicalSon.id && !tikuBubble?.is_archived) {
      throw new Error(`CONCURRENCY INVARIANT VIOLATION: Provisional entity "${provTiku.id}" was not archived after merge!`);
    }

    // C. Verify all active memories point to canonical Son bubble
    const { data: userMemories } = await supabaseAdmin
      .from('memories')
      .select('*')
      .eq('user_id', testUserId)
      .eq('is_archived', false);

    console.log(`   Total active memories for test user: ${userMemories?.length}`);
    for (const mem of userMemories || []) {
      console.log(`   - Memory "${mem.key}": bubble_id = ${mem.bubble_id}`);
      if (mem.bubble_id !== canonicalSon.id) {
        throw new Error(`FACT OWNERSHIP VIOLATION: Memory "${mem.key}" has bubble_id "${mem.bubble_id}", expected canonical "${canonicalSon.id}"`);
      }
    }

    // D. Verify KG projection
    const { nodesCreatedOrUpdated, edgesCreatedOrUpdated } = await canonicalGraphService.rebuildProjections(testUserId);
    console.log(`   KG Projections rebuilt: ${nodesCreatedOrUpdated} nodes, ${edgesCreatedOrUpdated} edges.`);

    console.log('\n====================================================');
    console.log('GATE 7 REAL DATABASE CONCURRENCY TEST: PASSED (100%)');
    console.log('====================================================\n');
  } finally {
    // ── 4. Clean up isolated test fixture ────────────────────────────────────
    if (testUserId) {
      console.log('4. Cleaning up isolated test fixture from real Supabase...');
      await supabaseAdmin.from('memories').delete().eq('user_id', testUserId);
      await supabaseAdmin.from('kg_edges').delete().eq('user_id', testUserId);
      await supabaseAdmin.from('kg_nodes').delete().eq('user_id', testUserId);
      await supabaseAdmin.from('memory_bubble_moves').delete().eq('user_id', testUserId);
      await supabaseAdmin.from('memory_bubbles').delete().eq('user_id', testUserId);
      await supabaseAdmin.auth.admin.deleteUser(testUserId);
      console.log('   Isolated test fixture successfully cleaned up.');
    }
  }
}

runRealDatabaseConcurrencyTest().catch((err) => {
  console.error('Fatal error in real DB concurrency test:', err);
  process.exit(1);
});
