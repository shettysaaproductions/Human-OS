import { accountLifecycleService, AccountLifecycleService } from '../src/services/AccountLifecycleService';
import { supabaseAdmin } from '../src/lib/supabase';

async function run() {
  console.log("Starting orphan sweep...");
  const orphanUserIds = new Set<string>();

  for (const item of AccountLifecycleService.USER_OWNED_TABLES) {
    if (item.table === 'profiles') continue;
    try {
      const { data, error } = await supabaseAdmin.from(item.table).select(item.userColumn);
      if (data) {
        for (const row of data) {
          const uid = row[item.userColumn];
          if (uid) {
            orphanUserIds.add(uid);
          }
        }
      }
    } catch (e) {
       // Ignore
    }
  }

  console.log(`Found ${orphanUserIds.size} distinct orphan user_ids.`);
  
  let deleted = 0;
  for (const uid of orphanUserIds) {
      console.log(`Erasing orphan: ${uid}`);
      await accountLifecycleService.deleteAccount(uid);
      deleted++;
  }

  console.log(`Erased ${deleted} orphans.`);
  
  // Final verify
  console.log("Checking final counts...");
  for (const item of AccountLifecycleService.USER_OWNED_TABLES) {
    if (item.table === 'profiles') continue;
    const { count } = await supabaseAdmin.from(item.table).select('*', { count: 'exact', head: true });
    console.log(`  ${item.table}: ${count}`);
  }
}

run().catch(console.error);
