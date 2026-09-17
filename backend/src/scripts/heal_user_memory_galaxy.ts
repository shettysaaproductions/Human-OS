import { supabaseAdmin } from '../lib/supabase';
import { invalidateAnalyticsCache } from '../routes/analytics';

async function main() {
  const userId = '62f9190b-1e1d-48d5-9667-12cd0bc3114b';
  console.log(`[HealGalaxy] Starting memory and bubble healing for user ${userId}...`);

  const now = new Date().toISOString();

  // 1. Restore son_name to "Shreshth"
  const { data: sonNameData, error: sonNameErr } = await supabaseAdmin
    .from('memories')
    .update({
      value: 'Shreshth',
      is_archived: false,
      lifecycle_state: 'CURRENT',
      updated_at: now
    })
    .eq('user_id', userId)
    .eq('key', 'son_name')
    .select('*');

  if (sonNameErr) {
    console.error('[HealGalaxy] Error restoring son_name:', sonNameErr.message);
  } else {
    console.log('[HealGalaxy] Restored son_name to Shreshth:', sonNameData);
  }

  // 2. Restore son_nickname to "Tuku"
  const { data: sonNickData, error: sonNickErr } = await supabaseAdmin
    .from('memories')
    .update({
      value: 'Tuku',
      is_archived: false,
      lifecycle_state: 'CURRENT',
      updated_at: now
    })
    .eq('user_id', userId)
    .eq('key', 'son_nickname')
    .select('*');

  if (sonNickErr) {
    console.error('[HealGalaxy] Error restoring son_nickname:', sonNickErr.message);
  } else {
    console.log('[HealGalaxy] Restored son_nickname to Tuku:', sonNickData);
  }

  // 3. Archive invalid friend_location ("Rehta hai") and friend_attribute ("friend")
  const invalidKeys = ['friend_location', 'friend_attribute'];
  for (const k of invalidKeys) {
    const { data: archData, error: archErr } = await supabaseAdmin
      .from('memories')
      .update({
        is_archived: true,
        lifecycle_state: 'ARCHIVED',
        supersession_reason: 'SEMANTIC_QUALITY_GATE_ARCHIVED',
        updated_at: now
      })
      .eq('user_id', userId)
      .eq('key', k)
      .select('*');

    if (archErr) {
      console.error(`[HealGalaxy] Error archiving ${k}:`, archErr.message);
    } else {
      console.log(`[HealGalaxy] Successfully archived invalid memory ${k}:`, archData);
    }
  }

  // 4. Find phantom bubbles ("entity:kar", "entity:office")
  const phantomSlugs = ['entity:kar', 'entity:office'];
  const { data: phantomBubbles, error: pErr } = await supabaseAdmin
    .from('memory_bubbles')
    .select('id, label, slug')
    .eq('user_id', userId)
    .in('slug', phantomSlugs);

  if (pErr) {
    console.error('[HealGalaxy] Error querying phantom bubbles:', pErr.message);
  } else if (phantomBubbles && phantomBubbles.length > 0) {
    const bubbleIds = phantomBubbles.map(b => b.id);
    console.log('[HealGalaxy] Found phantom bubbles to clean up:', phantomBubbles);

    // Re-point any reminders referencing these bubbles to null
    const { error: remErr } = await supabaseAdmin
      .from('reminders')
      .update({ bubble_id: null, updated_at: now })
      .eq('user_id', userId)
      .in('bubble_id', bubbleIds);

    if (remErr) {
      console.warn('[HealGalaxy] Note re-pointing reminders:', remErr.message);
    } else {
      console.log('[HealGalaxy] Successfully unlinked reminders from phantom bubbles.');
    }

    // Re-point any memories referencing these bubbles to null
    const { error: memErr } = await supabaseAdmin
      .from('memories')
      .update({ bubble_id: null, updated_at: now })
      .eq('user_id', userId)
      .in('bubble_id', bubbleIds);

    if (memErr) {
      console.warn('[HealGalaxy] Note re-pointing memories:', memErr.message);
    } else {
      console.log('[HealGalaxy] Successfully unlinked memories from phantom bubbles.');
    }

    // Archive the phantom bubbles
    const { data: archivedBubbles, error: archBubErr } = await supabaseAdmin
      .from('memory_bubbles')
      .update({
        is_archived: true,
        updated_at: now,
        metadata: { archived_reason: 'SEMANTIC_QUALITY_GATE_CLEANUP' }
      })
      .eq('user_id', userId)
      .in('id', bubbleIds)
      .select('id, label, slug, is_archived');

    if (archBubErr) {
      console.error('[HealGalaxy] Error archiving phantom bubbles:', archBubErr.message);
    } else {
      console.log('[HealGalaxy] Successfully archived phantom bubbles:', archivedBubbles);
    }
  } else {
    console.log('[HealGalaxy] No active phantom bubbles found.');
  }

  // 5. Invalidate analytics cache
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
