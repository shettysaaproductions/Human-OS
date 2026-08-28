/**
 * scripts/reconcile_corrupted_state.ts
 *
 * Amendment 4 — Safe, idempotent reconciliation for corrupted production state.
 *
 * Corrects memories where generic relational nouns were stored as proper names
 * (e.g., wife_name = "wife", mother_name = "mom") by marking them as needs_review
 * WITHOUT deleting any data.
 *
 * SAFE TO RUN MULTIPLE TIMES. All operations are idempotent.
 *
 * Usage:
 *   npx tsx scripts/reconcile_corrupted_state.ts [--dry-run] [--user-id=UUID]
 *
 * Flags:
 *   --dry-run     Preview what would change without writing to DB
 *   --user-id     Limit to a specific user (for targeted repair)
 */

import { supabaseAdmin } from '../src/lib/supabase';
import { logger } from '../src/lib/logger';

const GENERIC_ENTITY_VALUES = new Set([
  'wife', 'husband', 'mom', 'mother', 'dad', 'father', 'bhai', 'brother',
  'sister', 'son', 'daughter', 'didi', 'bhabhi', 'nana', 'nani', 'dada',
  'dadi', 'spouse', 'partner', 'girlfriend', 'boyfriend', 'friend', 'yaar',
]);

// Known high-authority deterministic facts that must NOT be touched
// These are values we know are real proper names. If they exist with
// source_authority=deterministic or explicit_user, skip them.
const KNOWN_GROUND_TRUTH: Record<string, string> = {
  wife_name:   'Sakshi',
  mother_name: 'Rajeshree',
  son_name:    'Shreshth',
};

const isDryRun = process.argv.includes('--dry-run');
const userIdFilter = process.argv.find(a => a.startsWith('--user-id='))?.split('=')[1];

async function reconcile(): Promise<void> {
  logger.info('[Reconcile] Starting corrupted-state reconciliation', {
    dryRun: isDryRun,
    userFilter: userIdFilter ?? 'all',
  });

  // ── Step 1: Find all _name memories with generic entity values ──────────────
  let query = supabaseAdmin
    .from('memories')
    .select('id, user_id, key, value, source_authority, importance, confidence')
    .like('key', '%_name');

  if (userIdFilter) {
    query = query.eq('user_id', userIdFilter);
  }

  const { data: nameMems, error: fetchErr } = await query;
  if (fetchErr) {
    logger.error('[Reconcile] Failed to fetch name memories', { error: fetchErr.message });
    process.exit(1);
  }

  const toMark: typeof nameMems = [];

  for (const mem of nameMems ?? []) {
    const valueLower = (mem.value ?? '').toLowerCase().trim();
    if (!GENERIC_ENTITY_VALUES.has(valueLower)) continue;

    // Never touch memories that already have high authority (they were set correctly
    // by DeterministicFactAgent and survived the new authority guard)
    const auth = mem.source_authority as string ?? 'subconscious_inference';
    if (auth === 'explicit_user' || auth === 'deterministic') {
      logger.info('[Reconcile] SKIP — high authority memory', { id: mem.id, key: mem.key, value: mem.value, auth });
      continue;
    }

    // Skip if the KNOWN_GROUND_TRUTH already exists for this user+key with a proper name
    // (i.e., Sakshi is stored deterministically — don't touch the corrupted "wife" row
    // if there's already a better answer; the guard will prevent future re-corruption)
    const gtValue = KNOWN_GROUND_TRUTH[mem.key];
    if (gtValue) {
      const { data: gtMem } = await supabaseAdmin
        .from('memories')
        .select('id, value, source_authority')
        .eq('user_id', mem.user_id)
        .eq('key', mem.key)
        .in('source_authority', ['explicit_user', 'deterministic', 'confirmed_memory'])
        .maybeSingle();

      if (gtMem) {
        logger.info('[Reconcile] SKIP — ground-truth exists at higher authority', {
          id: mem.id, key: mem.key, corruptedValue: mem.value, groundTruth: gtMem.value, auth: gtMem.source_authority,
        });
        continue;
      }
    }

    toMark.push(mem);
  }

  logger.info(`[Reconcile] Found ${toMark.length} corrupted name memories to mark as needs_review`, {
    dryRun: isDryRun,
  });

  if (isDryRun) {
    for (const mem of toMark) {
      logger.info('[Reconcile DRY RUN] Would mark as needs_review:', {
        id: mem.id, userId: mem.user_id, key: mem.key, value: mem.value, currentAuthority: mem.source_authority,
      });
    }
    logger.info('[Reconcile] Dry run complete. No changes written.');
    return;
  }

  // ── Step 2: Mark corrupted rows as needs_review ─────────────────────────────
  // Idempotent: if already needs_review, the update is a no-op in effect.
  let marked = 0;
  for (const mem of toMark) {
    const { error: updateErr } = await supabaseAdmin
      .from('memories')
      .update({
        source_authority: 'needs_review',
        updated_at: new Date().toISOString(),
      })
      .eq('id', mem.id);

    if (updateErr) {
      logger.warn('[Reconcile] Failed to mark memory as needs_review', { id: mem.id, error: updateErr.message });
    } else {
      logger.info('[Reconcile] Marked as needs_review:', { id: mem.id, key: mem.key, value: mem.value });
      marked++;
    }
  }

  logger.info(`[Reconcile] Done. ${marked}/${toMark.length} memories marked as needs_review.`);

  // ── Step 3: Re-run DeterministicFactAgent on known ground-truth facts ────────
  // This ensures the authoritative values exist at deterministic/explicit_user authority
  // so they will rank above needs_review in the authority guard.
  // NOTE: This step just logs recommendations — actual re-injection requires a user message.
  logger.info('[Reconcile] Ground truth facts to verify via DeterministicFactAgent:');
  for (const [key, value] of Object.entries(KNOWN_GROUND_TRUTH)) {
    if (!userIdFilter) {
      logger.info('[Reconcile]   (pass --user-id to check per-user authority)', { key, groundTruthValue: value });
      continue;
    }
    const { data: authoritative } = await supabaseAdmin
      .from('memories')
      .select('id, value, source_authority')
      .eq('user_id', userIdFilter)
      .eq('key', key)
      .in('source_authority', ['explicit_user', 'deterministic'])
      .maybeSingle();

    if (authoritative) {
      logger.info('[Reconcile]   ✅ Ground-truth exists', { key, value: authoritative.value, auth: authoritative.source_authority });
    } else {
      logger.warn(`[Reconcile]   ⚠️ Ground-truth missing for user ${userIdFilter}. User must say their ${key.replace('_name', '')} name again so DeterministicFactAgent can re-insert it.`, { key, expectedValue: value });
    }
  }

  logger.info('[Reconcile] Reconciliation complete.');
}

reconcile().catch(err => {
  logger.error('[Reconcile] Fatal error', { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
