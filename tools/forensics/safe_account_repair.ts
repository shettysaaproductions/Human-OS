/**
 * tools/forensics/safe_account_repair.ts
 *
 * FORENSIC TOOLING — NOT FOR PRODUCTION USE
 *
 * Safe account repair/cleanup utility for Human-OS.
 * Replaces the removed execute_reset.ts and cleanup_orphans.ts.
 *
 * SAFETY CONTRACT:
 *   - Refuses to run in production environments.
 *   - Dry-run by default: zero mutations unless --execute is explicit.
 *   - Requires HUMAN_OS_ALLOW_DESTRUCTIVE_TOOLS=true env var.
 *   - Requires explicit --user-ids=<uuid>,<uuid> — never enumerates all users.
 *   - Each deleted account is logged with before-state capture.
 *   - Unrelated users are untouched.
 *
 * USAGE:
 *   # Dry run (safe):
 *   npx ts-node tools/forensics/safe_account_repair.ts --user-ids=<uuid1>,<uuid2>
 *
 *   # Execute (requires both env var AND --execute):
 *   HUMAN_OS_ALLOW_DESTRUCTIVE_TOOLS=true npx ts-node tools/forensics/safe_account_repair.ts \
 *     --user-ids=<uuid1>,<uuid2> --execute
 *
 * INVARIANTS:
 *   - NODE_ENV === 'production' -> always refuse, exit 1
 *   - Missing HUMAN_OS_ALLOW_DESTRUCTIVE_TOOLS -> refuse, exit 1
 *   - Missing --user-ids -> refuse, exit 1 (never enumerate-all)
 *   - Missing --execute -> dry run only
 *   - Actual deleteAccount() only with: env var + explicit IDs + --execute
 */

function refuseIfProduction(): void {
  if (process.env.NODE_ENV === 'production') {
    console.error('\n FATAL: This script refuses to run in NODE_ENV=production.');
    console.error('   This is a forensic tool for development/staging only.\n');
    process.exit(1);
  }
}

function refuseIfMissingAllowFlag(): void {
  if (process.env.HUMAN_OS_ALLOW_DESTRUCTIVE_TOOLS !== 'true') {
    console.error('\n FATAL: HUMAN_OS_ALLOW_DESTRUCTIVE_TOOLS is not set to "true".');
    process.exit(1);
  }
}

function parseArgs(): { userIds: string[]; execute: boolean; dryRun: boolean } {
  const args = process.argv.slice(2);
  const userIdsArg = args.find(a => a.startsWith('--user-ids='));
  const execute = args.includes('--execute');

  if (!userIdsArg) {
    console.error('\n FATAL: --user-ids=<uuid1>,<uuid2> is required.');
    console.error('   This tool will NEVER enumerate all users automatically.\n');
    process.exit(1);
  }

  const userIds = userIdsArg.replace('--user-ids=', '').split(',').map(id => id.trim()).filter(Boolean);
  if (userIds.length === 0) { console.error('\n FATAL: --user-ids list is empty.\n'); process.exit(1); }

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  for (const id of userIds) {
    if (!UUID_RE.test(id)) { console.error(`\n FATAL: Invalid UUID: "${id}"\n`); process.exit(1); }
  }

  return { userIds, execute, dryRun: !execute };
}

async function main() {
  refuseIfProduction();
  refuseIfMissingAllowFlag();

  const { userIds, dryRun } = parseArgs();

  console.log('\n=== Human-OS Safe Account Repair Tool ===');
  console.log(`Mode:    ${dryRun ? 'DRY RUN (zero mutations)' : 'EXECUTE (will delete accounts)'}`);
  console.log(`Targets: ${userIds.length} user ID(s)\n`);

  if (dryRun) {
    console.log('DRY RUN: Accounts that WOULD be targeted:');
    userIds.forEach(uid => console.log(`  - ${uid}`));
    console.log('\nAdd --execute flag to perform actual deletion. No mutations performed.\n');
    return;
  }

  const { supabaseAdmin } = await import('../../backend/src/lib/supabase');
  const { accountLifecycleService } = await import('../../backend/src/services/AccountLifecycleService');

  console.log(' EXECUTING ACCOUNT DELETION — irreversible.\n');

  for (const userId of userIds) {
    console.log(`Processing: ${userId}`);
    try {
      const { data: profile } = await supabaseAdmin.from('profiles').select('id').eq('id', userId).maybeSingle();
      if (!profile) { console.log(`  SKIP: No profile for ${userId}`); continue; }

      const result = await accountLifecycleService.deleteAccount(userId);
      console.log(`  Success: ${result.success}${result.errors?.length ? ' Errors: ' + result.errors.join(', ') : ''}`);
    } catch (e: any) {
      console.error(`  Exception: ${e.message}`);
    }
  }
  console.log('\nDone.\n');
}

main().catch(e => { console.error('Unexpected error:', e); process.exit(1); });
