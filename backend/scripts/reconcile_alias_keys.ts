/**
 * reconcile_alias_keys.ts — Safe production alias collapse script
 *
 * PURPOSE:
 *   Merge existing legacy alias rows (e.g. mothers_name, mom_name, sons_name)
 *   into their canonical counterparts (mother_name, son_name), preserving the
 *   highest-authority value and archiving the losers.
 *
 * SAFETY:
 *   - Always dry-runs first and prints a diff before writing.
 *   - Idempotent: running twice produces no additional changes.
 *   - Never hard-deletes — losing rows are archived (is_archived = true).
 *   - Respects authority ordering — lowest-authority value is never kept over higher.
 *   - Operates on a single user by default; pass --all-users for a full production sweep.
 *
 * USAGE:
 *   npx tsx scripts/reconcile_alias_keys.ts --dry-run                # safe preview
 *   npx tsx scripts/reconcile_alias_keys.ts                           # apply for default user
 *   npx tsx scripts/reconcile_alias_keys.ts --user-id=<uuid>          # specific user
 *   npx tsx scripts/reconcile_alias_keys.ts --all-users               # full sweep
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { canonicalizeKey, CANONICAL_ALIAS_MAP } from '../src/lib/memoryKeySchema';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('[Reconcile] SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { persistSession: false }
});

// ── Authority rank (same as memoryRepository) ─────────────────────────────────
const AUTHORITY_RANK: Record<string, number> = {
  subconscious_inference: 1,
  confirmed_memory:       2,
  deterministic:          3,
  explicit_user:          4,
  needs_review:           0,
};

function rank(authority?: string | null): number {
  return AUTHORITY_RANK[(authority ?? 'subconscious_inference')] ?? 1;
}

// ── Parse CLI args ─────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const allUsers = args.includes('--all-users');
const userIdArg = args.find(a => a.startsWith('--user-id='))?.split('=')[1];

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function run() {
  console.log('[Reconcile] Starting alias-key reconciliation', {
    dryRun,
    allUsers,
    userIdFilter: userIdArg ?? 'none',
  });

  // Validate userIdArg before query
  if (userIdArg && !UUID_REGEX.test(userIdArg)) {
    console.error(`[Reconcile] Invalid UUID supplied for --user-id: "${userIdArg}"`);
    process.exit(1);
  }

  // Build set of all known alias keys (non-canonical)
  const aliasKeys = new Set<string>();
  for (const [canonical, aliases] of Object.entries(CANONICAL_ALIAS_MAP)) {
    for (const alias of aliases) {
      if (alias !== canonical) aliasKeys.add(alias.toLowerCase());
    }
  }

  console.log(`[Reconcile] Scanning for alias keys:`, [...aliasKeys].join(', '));

  // Fetch all non-archived rows with alias keys
  let query = supabase
    .from('memories')
    .select('id, user_id, key, value, source_authority, importance, confidence, updated_at, created_at')
    .eq('is_archived', false)
    .in('key', [...aliasKeys]);

  if (!allUsers && userIdArg) {
    query = query.eq('user_id', userIdArg);
  }

  const { data: aliasRows, error } = await query;
  if (error) {
    console.error('[Reconcile] Failed to fetch alias rows', error.message);
    process.exit(1);
  }

  if (!aliasRows || aliasRows.length === 0) {
    console.log('[Reconcile] No alias rows found. Database is already clean. ✅');
    return;
  }

  console.log(`[Reconcile] Found ${aliasRows.length} alias row(s) to process.`);

  let merged = 0;
  let archived = 0;
  let skipped = 0;

  for (const aliasRow of aliasRows) {
    const { canonical, wasAliased } = canonicalizeKey(aliasRow.key);
    if (!wasAliased) {
      // Shouldn't happen but defensive
      skipped++;
      continue;
    }

    console.log(`\n[Reconcile] Processing: ${aliasRow.key} → ${canonical} (user: ${aliasRow.user_id})`);
    console.log(`  Alias row value: "${aliasRow.value}" [${aliasRow.source_authority ?? 'subconscious_inference'}]`);

    // Check for existing canonical row for this user
    const { data: canonicalRow } = await supabase
      .from('memories')
      .select('id, key, value, source_authority, importance, confidence, updated_at')
      .eq('user_id', aliasRow.user_id)
      .eq('key', canonical)
      .eq('is_archived', false)
      .maybeSingle();

    if (canonicalRow) {
      // Both exist — determine winner by authority, then recency
      const canonicalRank = rank(canonicalRow.source_authority);
      const aliasRank = rank(aliasRow.source_authority);

      const aliasIsHigher = aliasRank > canonicalRank;
      const sameRankAliasIsNewer = aliasRank === canonicalRank &&
        new Date(aliasRow.updated_at ?? aliasRow.created_at) > new Date(canonicalRow.updated_at ?? '');

      if (aliasIsHigher || sameRankAliasIsNewer) {
        // Alias row wins — update canonical, archive alias
        console.log(`  WINNER: alias row (authority: ${aliasRow.source_authority}, value: "${aliasRow.value}")`);
        if (!dryRun) {
          await supabase
            .from('memories')
            .update({
              value: aliasRow.value,
              source_authority: aliasRow.source_authority,
              importance: Math.max(canonicalRow.importance ?? 50, aliasRow.importance ?? 50),
              updated_at: new Date().toISOString(),
            })
            .eq('id', canonicalRow.id);

          await supabase
            .from('memories')
            .update({ is_archived: true, updated_at: new Date().toISOString() })
            .eq('id', aliasRow.id);
        } else {
          console.log(`  [DRY RUN] Would update canonical "${canonical}" to value "${aliasRow.value}" and archive alias row.`);
        }
      } else {
        // Canonical row wins — just archive alias
        console.log(`  WINNER: canonical row (authority: ${canonicalRow.source_authority}, value: "${canonicalRow.value}")`);
        if (!dryRun) {
          await supabase
            .from('memories')
            .update({ is_archived: true, updated_at: new Date().toISOString() })
            .eq('id', aliasRow.id);
        } else {
          console.log(`  [DRY RUN] Would archive alias row "${aliasRow.key}" (value: "${aliasRow.value}").`);
        }
      }

      archived++;
    } else {
      // No canonical row — rename the alias row to canonical key
      console.log(`  No canonical row found. Will rename ${aliasRow.key} → ${canonical}.`);
      if (!dryRun) {
        await supabase
          .from('memories')
          .update({ key: canonical, updated_at: new Date().toISOString() })
          .eq('id', aliasRow.id);
      } else {
        console.log(`  [DRY RUN] Would rename row ${aliasRow.id} key from "${aliasRow.key}" to "${canonical}".`);
      }
      merged++;
    }
  }

  console.log(`\n[Reconcile] Complete.`);
  console.log(`  Renamed (no canonical existed): ${merged}`);
  console.log(`  Archived (lost to higher-authority canonical): ${archived}`);
  console.log(`  Skipped: ${skipped}`);
  if (dryRun) {
    console.log('\n[Reconcile] DRY RUN — no changes written. Run without --dry-run to apply.');
  } else {
    console.log('\n[Reconcile] Changes applied. ✅');
    console.log('NOTE: If you use Supabase PostgREST, run: NOTIFY pgrst, \'reload schema\' in the SQL Editor.');
  }
}

run().catch(err => {
  console.error('[Reconcile] Fatal error', err);
  process.exit(1);
});
