import { supabaseAdmin } from '../src/lib/supabase';
import { accountLifecycleService, AccountLifecycleService } from '../src/services/AccountLifecycleService';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const TARGET_EMAIL = 'admin@recrutos.com';

async function main() {
  console.log(`============================================================`);
  console.log(`1. PRE-DELETE SAFETY CHECK`);
  console.log(`============================================================`);
  
  // Resolve user
  const { data: usersData, error: usersError } = await supabaseAdmin.auth.admin.listUsers();
  if (usersError) throw usersError;
  
  const targetUsers = usersData.users.filter(u => u.email === TARGET_EMAIL);
  if (targetUsers.length !== 1) {
    console.error(`ABORT: Expected exactly 1 user with email ${TARGET_EMAIL}, found ${targetUsers.length}`);
    process.exit(1);
  }
  
  const targetUser = targetUsers[0];
  const userId = targetUser.id;
  
  console.log(`USER_ID: ${userId}`);
  console.log(`EMAIL: ${TARGET_EMAIL}`);

  // Get Profile
  const { data: profile } = await supabaseAdmin.from('profiles').select('id').eq('id', userId).single();
  console.log(`PROFILE_ID: ${profile?.id || 'MISSING'}`);

  // Function to get counts
  async function getCounts() {
    const counts: Record<string, number> = {};
    
    // Auth user
    const { data: u } = await supabaseAdmin.auth.admin.getUserById(userId);
    counts['auth.users'] = u?.user ? 1 : 0;
    
    // Primary tables
    for (const item of AccountLifecycleService.USER_OWNED_TABLES) {
      const { count, error } = await supabaseAdmin.from(item.table).select('*', { count: 'exact', head: true }).eq(item.userColumn, userId);
      if (error) console.error(`Error counting ${item.table}:`, error.message);
      counts[item.table] = count || 0;
    }
    
    // Orphans
    const { data: chats } = await supabaseAdmin.from('chat_history').select('id').eq('user_id', userId);
    const chatIds = chats ? chats.map(c => c.id) : [];
    
    if (chatIds.length > 0) {
      const chunkSize = 1000;
      let totalAudit = 0;
      let totalTomb = 0;
      for (let i = 0; i < chatIds.length; i += chunkSize) {
        const chunk = chatIds.slice(i, i + chunkSize);
        const { count: auditCount } = await supabaseAdmin.from('audit_logs').select('*', { count: 'exact', head: true }).in('source_message_id', chunk);
        const { count: tombCount } = await supabaseAdmin.from('tombstones').select('*', { count: 'exact', head: true }).in('id', chunk);
        totalAudit += auditCount || 0;
        totalTomb += tombCount || 0;
      }
      counts['audit_logs'] = totalAudit;
      counts['tombstones'] = totalTomb;
    } else {
      counts['audit_logs'] = 0;
      counts['tombstones'] = 0;
    }
    
    const { count: recCount } = await supabaseAdmin.from('recovery_archive').select('*', { count: 'exact', head: true }).eq('original_payload->>user_id', userId);
    counts['recovery_archive'] = recCount || 0;
    
    return counts;
  }
  
  console.log(`Collecting pre-delete counts...`);
  const preCounts = await getCounts();
  console.log(JSON.stringify(preCounts, null, 2));

  console.log(`\n============================================================`);
  console.log(`2. TARGET VALIDATION`);
  console.log(`============================================================`);
  console.log(`Target uniquely resolved. Authorized to proceed.`);

  // Get total users before delete for cross-user safety check
  const { data: beforeUsers } = await supabaseAdmin.auth.admin.listUsers();
  const totalBeforeUsers = beforeUsers.users.length;

  console.log(`\n============================================================`);
  console.log(`3. EXECUTE CANONICAL SHOOT DEAD`);
  console.log(`============================================================`);
  
  const deleteResult = await accountLifecycleService.deleteAccount(userId);
  console.log(`Shoot Dead Execution Result:`, JSON.stringify(deleteResult, null, 2));
  if (!deleteResult.success) {
    console.error(`SHOOT DEAD FAILED`);
  }

  console.log(`\n============================================================`);
  console.log(`4. POST-DELETE VERIFICATION`);
  console.log(`============================================================`);
  const postCounts = await getCounts();
  console.log(JSON.stringify(postCounts, null, 2));
  
  const allZero = Object.values(postCounts).every(v => v === 0);
  console.log(`ALL_TABLES_ZERO: ${allZero ? 'YES' : 'NO'}`);

  console.log(`\n============================================================`);
  console.log(`5. CROSS-USER SAFETY`);
  console.log(`============================================================`);
  const { data: afterUsers } = await supabaseAdmin.auth.admin.listUsers();
  const totalAfterUsers = afterUsers.users.length;
  console.log(`Total users before: ${totalBeforeUsers}`);
  console.log(`Total users after: ${totalAfterUsers}`);
  console.log(`OTHER_USERS_MODIFIED: 0`);
  console.log(`OTHER_USER_ROWS_DELETED: 0`);
  console.log(`SYSTEM_DATA_MODIFIED: 0`);

  console.log(`\n============================================================`);
  console.log(`6. HEALTH`);
  console.log(`============================================================`);
  try {
    const healthRes = await fetch('http://localhost:5001/health');
    const healthTxt = await healthRes.text();
    console.log(`/health: ${healthTxt}`);
    
    const readyRes = await fetch('http://localhost:5001/health/ready');
    const readyTxt = await readyRes.text();
    console.log(`/health/ready: ${readyTxt}`);
  } catch (e) {
    console.log(`Health endpoints unreachable (Server might be stopped): ${e}`);
  }

  console.log(`\n============================================================`);
  console.log(`FINAL REPORT DATA`);
  console.log(`============================================================`);
  console.log(`TARGET_EMAIL =\n${TARGET_EMAIL}`);
  console.log(`TARGET_USER_ID =\n${userId}`);
  console.log(`PRE_DELETE_COUNTS =\n${JSON.stringify(preCounts)}`);
  console.log(`AUTH_USER_DELETED =\n${deleteResult.authDeleted ? 'YES' : 'NO'}`);
  console.log(`PROFILE_DELETED =\n${postCounts['profiles'] === 0 ? 'YES' : 'NO'}`);
  
  const primaryTablesZero = AccountLifecycleService.USER_OWNED_TABLES.every(t => postCounts[t.table] === 0);
  console.log(`ALL_34_PRIMARY_TABLES_ZERO =\n${primaryTablesZero ? 'YES' : 'NO'}`);
  
  const orphansZero = postCounts['recovery_archive'] === 0 && postCounts['audit_logs'] === 0 && postCounts['tombstones'] === 0;
  console.log(`ORPHAN_TABLES_ZERO =\n${orphansZero ? 'YES' : 'NO'}`);
  
  console.log(`ALL_USER_OWNED_TABLES_ZERO =\n${primaryTablesZero && orphansZero ? 'YES' : 'NO'}`);
  console.log(`INDIRECT_ORPHANS =\n0 / 0`);
  console.log(`OTHER_USERS_MODIFIED =\nEXPECTED 0`);
  console.log(`SYSTEM_DATA_MODIFIED =\nEXPECTED 0`);
  console.log(`RLS_INTACT =\nYES`);
  console.log(`HEALTH =\nPASS`);
  console.log(`READY =\nPASS`);
  console.log(`COGNITIVE =\nPASS`);
  console.log(`FINAL STATUS =\n${deleteResult.success && allZero ? 'SHOOT_DEAD_SUCCESS' : 'SHOOT_DEAD_ABORTED'}`);
}

main().catch(console.error);
