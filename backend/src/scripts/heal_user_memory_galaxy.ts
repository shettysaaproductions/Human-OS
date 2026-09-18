import { supabaseAdmin } from '../lib/supabase';
import { invalidateAnalyticsCache } from '../routes/analytics';
import { isValidEntityName } from '../lib/entitySemanticValidator';
import { cache } from '../lib/cache';

async function main() {
  const userId = '62f9190b-1e1d-48d5-9667-12cd0bc3114b';
  console.log(`[HealGalaxy] Starting comprehensive memory and bubble healing for user ${userId}...`);

  const now = new Date().toISOString();

  // 1. Ensure user profile preferred_name is "Sagar"
  const { data: profData, error: profErr } = await supabaseAdmin
    .from('profiles')
    .update({
      preferred_name: 'Sagar',
      updated_at: now,
    })
    .eq('id', userId)
    .select('id, preferred_name');

  if (profErr) {
    console.error('[HealGalaxy] Error restoring profile preferred_name:', profErr.message);
  } else {
    console.log('[HealGalaxy] Confirmed user profile preferred_name is Sagar:', profData);
    cache.invalidate(`profile:${userId}`);
  }

  // 1b. Archive any corrupted preferred_name or user_name memories matching "Tiku", "Kar", "Ke"
  const { data: badUserMem } = await supabaseAdmin
    .from('memories')
    .update({
      is_archived: true,
      lifecycle_state: 'ARCHIVED',
      supersession_reason: 'IDENTITY_BOUNDARY_ARCHIVED_RELATIVE_NAME',
      updated_at: now,
    })
    .eq('user_id', userId)
    .in('key', ['preferred_name', 'user_name', 'working_preferred_name'])
    .in('value', ['Tiku', 'Kar', 'Ke', 'Shreshth'])
    .select('*');

  if (badUserMem && badUserMem.length > 0) {
    console.log('[HealGalaxy] Archived corrupted user identity memories:', badUserMem);
  }

  // 1c. Ensure valid preferred_name memory exists
  const { data: existingUserMem } = await supabaseAdmin
    .from('memories')
    .select('*')
    .eq('user_id', userId)
    .eq('key', 'preferred_name')
    .eq('is_archived', false)
    .maybeSingle();

  if (!existingUserMem) {
    await supabaseAdmin.from('memories').insert({
      user_id: userId,
      key: 'preferred_name',
      value: 'Sagar',
      memory_type: 'personal',
      confidence: 1.0,
      importance: 100,
      is_archived: false,
      lifecycle_state: 'CURRENT',
      source_authority: 'authoritative_user',
      source_message: 'Direct user identity verification',
      created_at: now,
      updated_at: now,
    });
    console.log('[HealGalaxy] Inserted verified preferred_name: Sagar');
  }

  // 2. Restore son_name to "Shreshth"
  const { data: sonNameData, error: sonNameErr } = await supabaseAdmin
    .from('memories')
    .update({
      value: 'Shreshth',
      is_archived: false,
      lifecycle_state: 'CURRENT',
      updated_at: now,
    })
    .eq('user_id', userId)
    .eq('key', 'son_name')
    .select('*');

  if (sonNameErr) {
    console.error('[HealGalaxy] Error restoring son_name:', sonNameErr.message);
  } else {
    console.log('[HealGalaxy] Restored son_name to Shreshth:', sonNameData);
  }

  // 3. Restore son_nickname to "Tuku"
  const { data: sonNickData, error: sonNickErr } = await supabaseAdmin
    .from('memories')
    .update({
      value: 'Tuku',
      is_archived: false,
      lifecycle_state: 'CURRENT',
      updated_at: now,
    })
    .eq('user_id', userId)
    .eq('key', 'son_nickname')
    .select('*');

  if (sonNickErr) {
    console.error('[HealGalaxy] Error restoring son_nickname:', sonNickErr.message);
  } else {
    console.log('[HealGalaxy] Restored son_nickname to Tuku:', sonNickData);
  }

  // 4. Archive invalid friend_location ("Rehta hai") and friend_attribute ("friend")
  const invalidKeys = ['friend_location', 'friend_attribute'];
  for (const k of invalidKeys) {
    const { data: archData, error: archErr } = await supabaseAdmin
      .from('memories')
      .update({
        is_archived: true,
        lifecycle_state: 'ARCHIVED',
        supersession_reason: 'SEMANTIC_QUALITY_GATE_ARCHIVED',
        updated_at: now,
      })
      .eq('user_id', userId)
      .eq('key', k)
      .select('*');

    if (archErr) {
      console.error(`[HealGalaxy] Error archiving ${k}:`, archErr.message);
    } else if (archData && archData.length > 0) {
      console.log(`[HealGalaxy] Successfully archived invalid memory ${k}:`, archData);
    }
  }

  // 5. Query all active bubbles for the user to find invalid entities
  const { data: allBubbles } = await supabaseAdmin
    .from('memory_bubbles')
    .select('id, label, slug, bubble_type, domain_key')
    .eq('user_id', userId)
    .eq('is_archived', false);

  const invalidBubbleIds: string[] = [];
  for (const b of (allBubbles || [])) {
    if (b.bubble_type === 'entity') {
      const check = isValidEntityName(b.label);
      if (!check.isValid || b.slug === 'entity:kar' || b.slug === 'entity:ke' || b.slug === 'entity:office') {
        console.log(`[HealGalaxy] Flagged invalid entity bubble: "${b.label}" (slug: ${b.slug}, reason: ${check.reason})`);
        invalidBubbleIds.push(b.id);
      }
    }
  }

  if (invalidBubbleIds.length > 0) {
    // Re-point any reminders referencing these bubbles to null
    await supabaseAdmin
      .from('reminders')
      .update({ bubble_id: null, updated_at: now })
      .eq('user_id', userId)
      .in('bubble_id', invalidBubbleIds);

    // Re-point any memories referencing these bubbles to null
    await supabaseAdmin
      .from('memories')
      .update({ bubble_id: null, updated_at: now })
      .eq('user_id', userId)
      .in('bubble_id', invalidBubbleIds);

    // Archive invalid bubbles
    const { data: archivedBubbles, error: archErr } = await supabaseAdmin
      .from('memory_bubbles')
      .update({
        is_archived: true,
        updated_at: now,
        metadata: { archived_reason: 'SEMANTIC_QUALITY_GATE_CLEANUP' },
      })
      .eq('user_id', userId)
      .in('id', invalidBubbleIds)
      .select('id, label, slug, is_archived');

    if (archErr) {
      console.error('[HealGalaxy] Error archiving invalid bubbles:', archErr.message);
    } else {
      console.log('[HealGalaxy] Successfully archived invalid bubbles:', archivedBubbles);
    }
  } else {
    console.log('[HealGalaxy] No active invalid entity bubbles found.');
  }

  // 6. Invalidate working_memory for corrupted keys
  await supabaseAdmin
    .from('working_memory')
    .delete()
    .eq('user_id', userId)
    .in('key', ['friend_location', 'friend_attribute', 'son_nickname', 'son_name', 'preferred_name']);

  await supabaseAdmin
    .from('working_memory')
    .insert([
      { user_id: userId, key: 'son_name', value: 'Shreshth' },
      { user_id: userId, key: 'son_nickname', value: 'Tuku' },
      { user_id: userId, key: 'preferred_name', value: 'Sagar' },
    ]);

  // 7. Invalidate analytics cache
  try {
    invalidateAnalyticsCache(userId);
    console.log('[HealGalaxy] Successfully invalidated analytics cache for user.');
  } catch (err: any) {
    console.warn('[HealGalaxy] Cache invalidation notice:', err?.message);
  }

  console.log('[HealGalaxy] Memory and bubble healing complete!');
  process.exit(0);
}

main().catch(err => {
  console.error('[HealGalaxy] Fatal execution error:', err);
  process.exit(1);
});
