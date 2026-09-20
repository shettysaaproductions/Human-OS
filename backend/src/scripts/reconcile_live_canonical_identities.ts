import { supabaseAdmin } from '../lib/supabase';
import { CanonicalEntityEngine } from '../services/CanonicalEntityEngine';

export async function reconcileLiveCanonicalIdentities(userId: string = '62f9190b-1e1d-48d5-9667-12cd0bc3114b') {
  console.log(`\n==================================================`);
  console.log(`RECONCILING CANONICAL IDENTITIES FOR USER: ${userId}`);
  console.log(`==================================================\n`);

  const canonicalEntityEngine = CanonicalEntityEngine.getInstance();

  // ── 1. BEFORE STATE SNAPSHOT ────────────────────────────────────────────────
  const { data: beforeBubbles } = await supabaseAdmin
    .from('memory_bubbles')
    .select('id, label, slug, relation_type, is_archived, metadata')
    .eq('user_id', userId)
    .eq('is_archived', false)
    .in('label', ['Sagar', 'Tiku', 'Shreshth']);

  console.log('--- BEFORE: ACTIVE TARGET BUBBLES ---');
  for (const b of beforeBubbles || []) {
    console.log(`[${b.id}] label="${b.label}" rel="${b.relation_type}" aliases=${JSON.stringify(b.metadata?.aliases || [])}`);
  }

  const { data: beforeMems } = await supabaseAdmin
    .from('memories')
    .select('id, key, value, bubble_id, is_archived, lifecycle_state')
    .eq('user_id', userId)
    .in('key', ['son_name', 'son_nickname', 'son_birth_date', 'son_age', 'working_son_birth_date', 'goal_3_baje_ke_baad_calling']);

  console.log('\n--- BEFORE: TARGET MEMORIES ---');
  for (const m of beforeMems || []) {
    console.log(`[${m.id}] key="${m.key}" val="${m.value}" bubble_id="${m.bubble_id}" archived=${m.is_archived}`);
  }

  // ── 2. IDENTIFY CANONICAL TARGET & DUPLICATES ───────────────────────────────
  // Canonical Son is Shreshth: b87b8692-041f-4ca8-b35c-1253b84c4ea2
  const canonicalSonId = 'b87b8692-041f-4ca8-b35c-1253b84c4ea2';
  const tikuBubbleId1 = '213cce3e-ef41-4495-bf94-a8d6704729c2';
  const tikuBubbleId2 = 'edb8e19e-0761-4329-9a8f-4ed9c4f22a1d';
  const sagarRelativeBubbleId = '9ebc4cab-f9a4-402d-ba40-06d8e377708f';

  // Verify canonical target exists
  const { data: canonBubble, error: canonErr } = await supabaseAdmin
    .from('memory_bubbles')
    .select('*')
    .eq('id', canonicalSonId)
    .eq('user_id', userId)
    .single();

  if (canonErr || !canonBubble) {
    throw new Error(`Canonical Son bubble ${canonicalSonId} not found: ${canonErr?.message}`);
  }

  // ── 3. MERGE TIKU BUBBLES VIA ATOMIC RPC ────────────────────────────────────
  console.log('\n--- MERGING TIKU DUPLICATE BUBBLES INTO CANONICAL SHRESHTH ---');

  // Check if tikuBubbleId1 is still active
  const { data: tiku1 } = await supabaseAdmin
    .from('memory_bubbles')
    .select('*')
    .eq('id', tikuBubbleId1)
    .single();

  if (tiku1 && !tiku1.is_archived) {
    console.log(`Merging Tiku (1) [${tikuBubbleId1}] into Shreshth [${canonicalSonId}]...`);
    const { data: rpcRes1, error: rpcErr1 } = await supabaseAdmin.rpc('canonical_merge_entities', {
      p_user_id: userId,
      p_source_bubble_id: tikuBubbleId1,
      p_target_bubble_id: canonicalSonId,
    });
    if (rpcErr1) throw new Error(`RPC merge 1 failed: ${rpcErr1.message}`);
    console.log('Merge 1 RPC result:', rpcRes1);
  } else {
    console.log(`Tiku (1) already archived or merged.`);
  }

  // Check if tikuBubbleId2 is still active
  const { data: tiku2 } = await supabaseAdmin
    .from('memory_bubbles')
    .select('*')
    .eq('id', tikuBubbleId2)
    .single();

  if (tiku2 && !tiku2.is_archived) {
    console.log(`Merging Tiku (2) [${tikuBubbleId2}] into Shreshth [${canonicalSonId}]...`);
    const { data: rpcRes2, error: rpcErr2 } = await supabaseAdmin.rpc('canonical_merge_entities', {
      p_user_id: userId,
      p_source_bubble_id: tikuBubbleId2,
      p_target_bubble_id: canonicalSonId,
    });
    if (rpcErr2) throw new Error(`RPC merge 2 failed: ${rpcErr2.message}`);
    console.log('Merge 2 RPC result:', rpcRes2);
  } else {
    console.log(`Tiku (2) already archived or merged.`);
  }

  // ── 4. RECONCILE ERRONEOUS SAGAR (SON) BUBBLE (SELF != RELATIVE) ────────────
  console.log('\n--- RECONCILING ERRONEOUS SAGAR (SON) RELATIVE BUBBLE ---');
  const { data: sagarRel } = await supabaseAdmin
    .from('memory_bubbles')
    .select('*')
    .eq('id', sagarRelativeBubbleId)
    .single();

  if (sagarRel && !sagarRel.is_archived) {
    console.log(`Archiving erroneous Sagar (Son) relative bubble [${sagarRelativeBubbleId}]...`);
    // Repoint any stray memories to null or canonical
    await supabaseAdmin
      .from('memories')
      .update({ bubble_id: canonicalSonId, updated_at: new Date().toISOString() })
      .eq('bubble_id', sagarRelativeBubbleId)
      .neq('key', 'son_name'); // son_name: sagar is already superseded

    await supabaseAdmin
      .from('memory_bubbles')
      .update({
        is_archived: true,
        metadata: { ...(sagarRel?.metadata || {}), archive_reason: 'SELF_NOT_RELATIVE_ENTITY' },
        updated_at: new Date().toISOString()
      })
      .eq('id', sagarRelativeBubbleId);
    console.log(`Sagar (Son) bubble archived safely.`);
  } else {
    console.log(`Sagar (Son) bubble already archived.`);
  }

  // ── 5. ENSURE TIKU ALIAS AND REPOINT ALL SON MEMORIES ───────────────────────
  console.log('\n--- SYNCHRONIZING MEMORIES & ALIASES ON CANONICAL SON ---');
  // Register Tiku as alias on Shreshth
  await canonicalEntityEngine.registerAlias(userId, canonicalSonId, 'Tiku');

  // Repoint all active son memories directly to canonicalSonId
  const sonKeys = ['son_name', 'son_nickname', 'son_birth_date', 'son_age', 'working_son_birth_date', 'goal_3_baje_ke_baad_calling'];
  for (const key of sonKeys) {
    await supabaseAdmin
      .from('memories')
      .update({
        bubble_id: canonicalSonId,
        updated_at: new Date().toISOString()
      })
      .eq('user_id', userId)
      .eq('key', key)
      .eq('is_archived', false);
  }

  // Synchronize KG node
  const { data: kgNode } = await supabaseAdmin
    .from('kg_nodes')
    .select('*')
    .eq('user_id', userId)
    .eq('bubble_id', canonicalSonId)
    .maybeSingle();

  if (kgNode) {
    await supabaseAdmin
      .from('kg_nodes')
      .update({
        name: 'Shreshth',
        label: 'Shreshth',
        entity_type: 'person',
        updated_at: new Date().toISOString()
      })
      .eq('id', kgNode.id);
  }

  // Invalidate cache
  canonicalEntityEngine.invalidateGraphCache(userId);

  // ── 6. AFTER STATE SNAPSHOT & INVARIANT VERIFICATION ────────────────────────
  console.log('\n==================================================');
  console.log('VERIFYING AFTER STATE & DATABASE INVARIANTS:');
  console.log('==================================================\n');

  // 1. All active Son bubbles for user
  const { data: afterSonBubbles } = await supabaseAdmin
    .from('memory_bubbles')
    .select('id, label, slug, relation_type, is_archived, metadata')
    .eq('user_id', userId)
    .eq('domain_key', 'family')
    .eq('relation_type', 'Son')
    .eq('is_archived', false);

  console.log(`1. Active Son bubbles (Expected: 1, Found: ${afterSonBubbles?.length || 0}):`);
  for (const b of afterSonBubbles || []) {
    console.log(`   [${b.id}] label="${b.label}" rel="${b.relation_type}" aliases=${JSON.stringify(b.metadata?.aliases || [])}`);
  }

  // 2. Family relative bubbles with label "Sagar"
  const { data: sagarRelativeAfter } = await supabaseAdmin
    .from('memory_bubbles')
    .select('id, label, relation_type, is_archived')
    .eq('user_id', userId)
    .eq('domain_key', 'family')
    .ilike('label', 'Sagar')
    .eq('is_archived', false);

  console.log(`2. Active family bubbles labeled "Sagar" (Expected: 0, Found: ${sagarRelativeAfter?.length || 0})`);

  // 3. Active bubbles with label "Tiku"
  const { data: tikuBubblesAfter } = await supabaseAdmin
    .from('memory_bubbles')
    .select('id, label, relation_type, is_archived')
    .eq('user_id', userId)
    .ilike('label', 'Tiku')
    .eq('is_archived', false);

  console.log(`3. Active bubbles labeled "Tiku" (Expected: 0, Found: ${tikuBubblesAfter?.length || 0})`);

  // 4. Memory attachments
  const { data: afterMems } = await supabaseAdmin
    .from('memories')
    .select('id, key, value, bubble_id, is_archived')
    .eq('user_id', userId)
    .in('key', sonKeys)
    .eq('is_archived', false);

  console.log(`4. Active son memories pointing to canonical Shreshth:`);
  let allPointToCanonical = true;
  for (const m of afterMems || []) {
    const isTarget = m.bubble_id === canonicalSonId;
    if (!isTarget) allPointToCanonical = false;
    console.log(`   [${m.key}] val="${m.value}" -> bubble_id="${m.bubble_id}" (isCanonical: ${isTarget})`);
  }

  console.log(`\nAll Son memories point to canonical bubble: ${allPointToCanonical}`);
  console.log(`\n==================================================\n`);

  return {
    success: (afterSonBubbles?.length === 1) && (sagarRelativeAfter?.length === 0) && (tikuBubblesAfter?.length === 0) && allPointToCanonical,
    activeSonBubble: afterSonBubbles?.[0],
    afterMems,
  };
}

if (require.main === module) {
  reconcileLiveCanonicalIdentities()
    .then((res) => {
      console.log('RECONCILIATION RESULT:', res.success ? 'SUCCESS' : 'FAILURE');
      setTimeout(() => process.exit(res.success ? 0 : 1), 500);
    })
    .catch((err) => {
      console.error('RECONCILIATION ERROR:', err);
      process.exit(1);
    });
}
