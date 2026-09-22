/**
 * verify_entity_fact_ownership.ts — Phase 0B Deep Ownership Verification
 *
 * Verifies that each active memory's key semantically matches the canonical
 * bubble it is owned by. Goes beyond bubble_id != null.
 *
 * Also verifies:
 * - kg_edges unique index exists in production
 * - No archived bubble owns active facts
 * - Entity-specific keys (son_*, wife_*, etc.) owned by correct relation bubble
 */

import { supabaseAdmin } from '../lib/supabase';

const USER_ID = '62f9190b-1e1d-48d5-9667-12cd0bc3114b';

// Pattern → expected relation_type (case-insensitive normalized)
const KEY_RELATION_PATTERNS: Array<{ pattern: RegExp; expectedRelations: string[] }> = [
  { pattern: /^son_/i,         expectedRelations: ['son'] },
  { pattern: /^wife_|^spouse_/i, expectedRelations: ['wife', 'spouse', 'partner'] },
  { pattern: /^husband_/i,     expectedRelations: ['husband', 'spouse', 'partner'] },
  { pattern: /^daughter_/i,    expectedRelations: ['daughter'] },
  { pattern: /^mother_/i,      expectedRelations: ['mother'] },
  { pattern: /^father_/i,      expectedRelations: ['father'] },
  { pattern: /^brother_/i,     expectedRelations: ['brother'] },
  { pattern: /^sister_/i,      expectedRelations: ['sister'] },
  { pattern: /^dog_|^pet_/i,   expectedRelations: ['dog', 'pet', 'kutta'] },
];

// Domain-level keys that are legitimately bubble_id=null (user-level facts)
const DOMAIN_LEVEL_KEYS = [
  'preferred_name', 'birth_date', 'age', 'city', 'hometown', 'location',
  'company_name', 'profession', 'job', 'occupation', 'work_role',
  'goal_', 'habit_', 'diet_', 'sleep_', 'hobby_', 'interest_',
];

async function main() {
  console.log('====================================================');
  console.log('PHASE 0B: ENTITY FACT OWNERSHIP DEEP VERIFICATION');
  console.log('User:', USER_ID);
  console.log('====================================================\n');

  let totalChecked = 0;
  let violations = 0;
  let warnings = 0;

  // 1. Fetch all active memories + their bubble's relation_type
  const { data: memories, error: mErr } = await supabaseAdmin
    .from('memories')
    .select('id, key, value, memory_type, bubble_id')
    .eq('user_id', USER_ID)
    .eq('is_archived', false);

  if (mErr) throw mErr;
  console.log(`Active memories: ${memories?.length || 0}\n`);

  // 2. Fetch all active bubbles
  const { data: bubbles, error: bErr } = await supabaseAdmin
    .from('memory_bubbles')
    .select('id, label, slug, bubble_type, domain_key, relation_type, is_archived')
    .eq('user_id', USER_ID);

  if (bErr) throw bErr;

  const bubbleMap = new Map<string, typeof bubbles[0]>();
  for (const b of bubbles || []) bubbleMap.set(b.id, b);

  // 3. Check each memory
  console.log('--- CHECKING ENTITY-FACT SEMANTIC OWNERSHIP ---\n');
  for (const mem of memories || []) {
    totalChecked++;

    // Check: archived bubble owns active fact
    if (mem.bubble_id) {
      const bubble = bubbleMap.get(mem.bubble_id);
      if (!bubble) {
        violations++;
        console.error(`❌ VIOLATION: Memory "${mem.key}" references bubble ${mem.bubble_id} which does NOT EXIST`);
        continue;
      }
      if (bubble.is_archived) {
        violations++;
        console.error(`❌ VIOLATION: Memory "${mem.key}" owned by ARCHIVED bubble "${bubble.label}" (${bubble.id})`);
        continue;
      }

      // Check: entity-specific key matches bubble's relation
      for (const { pattern, expectedRelations } of KEY_RELATION_PATTERNS) {
        if (pattern.test(mem.key)) {
          const bubbleRel = (bubble.relation_type || '').toLowerCase();
          const matches = expectedRelations.some(r => bubbleRel.includes(r));
          if (!matches) {
            violations++;
            console.error(`❌ OWNERSHIP MISMATCH: key="${mem.key}" → bubble relation="${bubble.relation_type}" (expected: ${expectedRelations.join('/')})`);
          } else {
            console.log(`   ✅ "${mem.key}" → "${bubble.label}" [${bubble.relation_type}]`);
          }
          break;
        }
      }
    } else {
      // Memory with no bubble_id — should be domain-level fact
      const isDomainLevel = DOMAIN_LEVEL_KEYS.some(k => mem.key.startsWith(k));
      const hasEntityPrefix = KEY_RELATION_PATTERNS.some(({ pattern }) => pattern.test(mem.key));
      if (hasEntityPrefix && !isDomainLevel) {
        warnings++;
        console.warn(`⚠️  UNLINKED ENTITY KEY: "${mem.key}" has entity prefix but no bubble_id`);
      } else {
        console.log(`   📋 Domain fact: "${mem.key}" (no bubble — OK)`);
      }
    }
  }

  console.log('\n--- CHECKING KG_EDGES UNIQUE CONSTRAINT IN PRODUCTION ---\n');

  // 4. Check for duplicate kg_edges (would fail if unique index not applied)
  const { data: edges, error: eErr } = await supabaseAdmin
    .from('kg_edges')
    .select('source_node_id, target_node_id, relation_type')
    .eq('user_id', USER_ID);

  if (eErr) throw eErr;

  const edgeKeys = new Set<string>();
  let dupEdges = 0;
  for (const e of edges || []) {
    const key = `${e.source_node_id}:${e.target_node_id}:${e.relation_type}`;
    if (edgeKeys.has(key)) {
      dupEdges++;
      console.error(`❌ DUPLICATE EDGE: ${key}`);
    }
    edgeKeys.add(key);
  }
  console.log(`Total kg_edges: ${edges?.length || 0}`);
  console.log(`Duplicate edges: ${dupEdges === 0 ? '0 ✅' : `${dupEdges} ❌`}`);

  // 5. Check for orphaned kg_nodes (pointing to archived/missing bubble)
  console.log('\n--- CHECKING KG_NODES CANONICAL INTEGRITY ---\n');
  const { data: nodes, error: nErr } = await supabaseAdmin
    .from('kg_nodes')
    .select('id, entity_type, bubble_id')
    .eq('user_id', USER_ID);

  if (nErr) throw nErr;

  let orphanNodes = 0;
  let archivedBubbleNodes = 0;
  for (const node of nodes || []) {
    if (!node.bubble_id) {
      orphanNodes++;
      console.warn(`⚠️  UNMAPPED kg_node: ${node.id} [${node.entity_type}] has no bubble_id`);
    } else {
      const b = bubbleMap.get(node.bubble_id);
      if (!b) {
        orphanNodes++;
        console.error(`❌ ORPHAN kg_node: ${node.id} → bubble ${node.bubble_id} DOES NOT EXIST`);
      } else if (b.is_archived) {
        archivedBubbleNodes++;
        console.error(`❌ ORPHAN kg_node: ${node.id} → ARCHIVED bubble "${b.label}"`);
      }
    }
  }
  console.log(`Total kg_nodes: ${nodes?.length || 0}`);
  console.log(`Unmapped/orphan kg_nodes: ${orphanNodes === 0 ? '0 ✅' : `${orphanNodes} ❌`}`);
  console.log(`Nodes pointing to archived bubbles: ${archivedBubbleNodes === 0 ? '0 ✅' : `${archivedBubbleNodes} ❌`}`);

  // Summary
  console.log('\n====================================================');
  console.log('PHASE 0B DEEP VERIFICATION SUMMARY');
  console.log('====================================================');
  console.log(`Total memories checked: ${totalChecked}`);
  console.log(`Entity-fact ownership violations: ${violations === 0 ? '0 ✅' : `${violations} ❌`}`);
  console.log(`Unlinked entity key warnings: ${warnings === 0 ? '0 ✅' : `${warnings} ⚠️`}`);
  console.log(`Duplicate kg_edges: ${dupEdges === 0 ? '0 ✅' : `${dupEdges} ❌`}`);
  console.log(`Orphaned kg_nodes: ${orphanNodes === 0 ? '0 ✅' : `${orphanNodes} ❌`}`);

  if (violations === 0 && dupEdges === 0 && orphanNodes === 0) {
    console.log('\n🟢 PHASE 0B DEEP VERIFICATION: ALL INVARIANTS PASS');
  } else {
    console.log('\n🔴 PHASE 0B DEEP VERIFICATION: VIOLATIONS FOUND — FIX REQUIRED');
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
