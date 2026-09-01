import { accountLifecycleService, AccountLifecycleService } from '../src/services/AccountLifecycleService';
import { supabaseAdmin } from '../src/lib/supabase';

async function run() {
  console.log("============================================================");
  console.log("1. PRE-WIPE AUDIT");
  console.log("============================================================");

  const { data: authData, error: authErr } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (authErr) {
    console.error("Failed to list auth users:", authErr);
    return;
  }
  const authUsers = authData.users;
  console.log(`auth.users: ${authUsers.length}`);

  const { data: profiles, error: profErr } = await supabaseAdmin.from('profiles').select('*', { count: 'exact' });
  if (profErr) {
    console.error("Failed to list profiles:", profErr);
    return;
  }
  const allProfiles = profiles || [];
  console.log(`profiles: ${allProfiles.length}`);

  const beforeCounts: Record<string, number> = {};
  for (const item of AccountLifecycleService.USER_OWNED_TABLES) {
    if (item.table === 'profiles') continue;
    try {
      const { count, error } = await supabaseAdmin.from(item.table).select('*', { count: 'exact', head: true });
      if (error) {
        beforeCounts[item.table] = -1; // Error
      } else {
        beforeCounts[item.table] = count || 0;
      }
    } catch (e) {
      beforeCounts[item.table] = -1;
    }
  }

  console.log("\nTable counts BEFORE deletion:");
  for (const [table, count] of Object.entries(beforeCounts)) {
    console.log(`  ${table}: ${count}`);
  }

  console.log("\n============================================================");
  console.log("2. ACCOUNT CLASSIFICATION");
  console.log("============================================================");

  let protectedSystemAccounts: string[] = [];
  const userIdsToDelete = new Set<string>();

  for (const u of authUsers) {
    console.log(`ID: ${u.id}, Email: ${u.email}`);
    // Check if there are any service accounts. Usually they have specific emails.
    if (u.email?.includes('system') || u.email?.includes('service')) {
        console.log(`  -> PROTECTED_SYSTEM_ACCOUNT`);
        protectedSystemAccounts.push(u.id);
    } else {
        console.log(`  -> REAL/TEST_USER`);
        userIdsToDelete.add(u.id);
    }
  }

  for (const p of allProfiles) {
    if (!authUsers.find(u => u.id === p.id)) {
        console.log(`ID: ${p.id} (Profile Only) -> ORPHAN`);
        userIdsToDelete.add(p.id);
    }
  }

  console.log("\n============================================================");
  console.log("3. COMPLETE ERADICATION");
  console.log("============================================================");

  let usersDeleted = 0;
  let deletionErrors = 0;

  for (const uid of userIdsToDelete) {
      console.log(`Erasing: ${uid}`);
      try {
          const res = await accountLifecycleService.deleteAccount(uid);
          if (res.success) {
              usersDeleted++;
          } else {
              deletionErrors++;
              console.error(`  Failed to delete completely: ${res.errors}`);
          }
      } catch(e) {
          console.error(`  Exception: ${e}`);
          deletionErrors++;
      }
  }

  console.log("\n============================================================");
  console.log("4. POST-WIPE VERIFICATION");
  console.log("============================================================");

  const { data: postAuthData } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  console.log(`auth.users after: ${postAuthData?.users?.length || 0}`);

  const { count: postProfileCount } = await supabaseAdmin.from('profiles').select('*', { count: 'exact', head: true });
  console.log(`profiles after: ${postProfileCount}`);

  const afterCounts: Record<string, number> = {};
  let allZero = true;
  for (const item of AccountLifecycleService.USER_OWNED_TABLES) {
    if (item.table === 'profiles') continue;
    try {
      const { count } = await supabaseAdmin.from(item.table).select('*', { count: 'exact', head: true });
      afterCounts[item.table] = count || 0;
      if (count && count > 0) allZero = false;
    } catch (e) {
      afterCounts[item.table] = -1;
      allZero = false;
    }
  }

  console.log("\nTable counts AFTER deletion:");
  for (const [table, count] of Object.entries(afterCounts)) {
    console.log(`  ${table}: ${count}`);
  }

  console.log("\n============================================================");
  console.log("FINAL REPORT PREPARATION");
  console.log("============================================================");
  console.log(`USERS_FOUND = ${userIdsToDelete.size}`);
  console.log(`USERS_DELETED = ${usersDeleted}`);
  console.log(`PROTECTED_SYSTEM_ACCOUNTS = ${JSON.stringify(protectedSystemAccounts)}`);
  console.log(`AFTER_AUTH_USERS = ${postAuthData?.users?.length || 0}`);
  console.log(`AFTER_PROFILES = ${postProfileCount}`);
  console.log(`ALL_USER_OWNED_TABLES_ZERO = ${allZero ? 'YES' : 'NO'}`);
  console.log(`ORPHAN_RECORDS = ${allZero && postProfileCount === 0 && (postAuthData?.users?.length || 0) === protectedSystemAccounts.length ? 0 : 'Non-Zero'}`);
  
  if(deletionErrors === 0 && allZero) {
      console.log(`ACCOUNT_LIFECYCLE_ERASURE = PASS`);
      console.log(`FK_CASCADES = PASS`);
  } else {
      console.log(`ACCOUNT_LIFECYCLE_ERASURE = FAIL`);
      console.log(`FK_CASCADES = FAIL (needs check)`);
  }
}

run().catch(console.error);
