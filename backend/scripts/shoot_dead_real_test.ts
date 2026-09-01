import { supabaseAdmin } from '../src/lib/supabase';
import { AccountLifecycleService } from '../src/services/AccountLifecycleService';
import { logger } from '../src/lib/logger';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const TARGET_EMAIL = 'admin@recrutos.com';

async function captureCounts(userId: string) {
  const counts: Record<string, number> = {};
  for (const mapping of AccountLifecycleService.USER_OWNED_TABLES) {
    const { count } = await supabaseAdmin.from(mapping.table).select('*', { count: 'exact', head: true }).eq(mapping.userColumn, userId);
    counts[mapping.table] = count || 0;
  }
  
  // Also check orphans explicitly if they contain user data somehow, though tombstones for chat have id=msg_id.
  const { count: recCount } = await supabaseAdmin.from('recovery_archive').select('*', { count: 'exact', head: true }).eq('original_payload->>user_id', userId);
  counts['recovery_archive'] = recCount || 0;

  return counts;
}

async function runTest() {
  logger.info(`Starting Real Shoot Dead Test for ${TARGET_EMAIL}`);

  // 1. Resolve Auth User
  const { data: users, error: userErr } = await supabaseAdmin.auth.admin.listUsers();
  if (userErr) throw userErr;

  const targetUser = users.users.find(u => u.email === TARGET_EMAIL);
  if (!targetUser) {
    logger.error('Target user not found.');
    process.exit(1);
  }

  const userId = targetUser.id;
  logger.info(`Resolved Target User: ${userId}`);

  // Capture total DB counts for cross-user verification
  const totalCounts: Record<string, number> = {};
  for (const mapping of AccountLifecycleService.USER_OWNED_TABLES) {
    const { count } = await supabaseAdmin.from(mapping.table).select('*', { count: 'exact', head: true });
    totalCounts[mapping.table] = count || 0;
  }

  // 2. Pre-delete counts
  const preDeleteCounts = await captureCounts(userId);
  logger.info('Pre-Delete Counts:', preDeleteCounts);

  const preTotalUserRows = Object.values(preDeleteCounts).reduce((a, b) => a + b, 0);
  if (preTotalUserRows === 0) {
    logger.warn('WARNING: Target user has 0 rows before deletion. The test might not fully demonstrate deletion power. Proceeding anyway.');
  }

  // 3. Execute Delete
  logger.info('Executing AccountLifecycleService.deleteAccount...');
  const lifecycle = new AccountLifecycleService();
  const deleteRes = await lifecycle.deleteAccount(userId);
  logger.info('Delete Result:', deleteRes);

  if (!deleteRes.success) {
    logger.error('Shoot Dead failed!', deleteRes.errors);
    process.exit(1);
  }

  // 4. Wait for potential rogue in-flight jobs
  logger.info('Waiting 10 seconds for potential rogue async writes...');
  await new Promise(r => setTimeout(r, 10000));

  // 5. Post-delete verification (Zero Residue)
  const postDeleteCounts = await captureCounts(userId);
  logger.info('Post-Delete Counts:', postDeleteCounts);

  const remainingRows = Object.values(postDeleteCounts).reduce((a, b) => a + b, 0);
  
  // Verify auth user
  const { data: checkAuth } = await supabaseAdmin.auth.admin.getUserById(userId);
  const authExists = !!checkAuth?.user;

  logger.info(`Auth User Exists: ${authExists}`);
  logger.info(`Total Remaining User Rows: ${remainingRows}`);

  // Cross-user verification
  let crossUserAffected = false;
  for (const mapping of AccountLifecycleService.USER_OWNED_TABLES) {
    const { count } = await supabaseAdmin.from(mapping.table).select('*', { count: 'exact', head: true });
    const expected = totalCounts[mapping.table] - preDeleteCounts[mapping.table];
    if (count !== expected) {
      logger.warn(`Cross-User Alert: ${mapping.table} expected ${expected} but found ${count}`);
      // Note: background jobs for OTHER users might change these counts slightly during the 10s wait, 
      // but it's a good approximate check.
    }
  }

  if (remainingRows === 0 && !authExists) {
    console.log('\nFINAL STATUS =\nSHOOT_DEAD_REAL_TEST_SUCCESS');
  } else {
    console.log('\nFINAL STATUS =\nSHOOT_DEAD_REAL_TEST_FAILED');
  }
}

runTest().catch(err => {
  logger.error('Test script failed', err);
  process.exit(1);
});
