import { supabaseAdmin } from "./src/lib/supabase";
import { AccountLifecycleService, accountLifecycleService } from "./src/services/AccountLifecycleService";

async function findAndDestroyOrphans() {
  console.log("Finding all orphaned user_ids across all tables...");
  const uniqueUserIds = new Set<string>();

  for (const tableDef of AccountLifecycleService.USER_OWNED_TABLES) {
    try {
      const { data, error } = await supabaseAdmin
        .from(tableDef.table)
        .select(tableDef.userColumn);
      
      if (!error && data) {
        for (const row of data) {
           const uid = (row as any)[tableDef.userColumn];
           if (uid) uniqueUserIds.add(uid);
        }
      }
    } catch(e) {
      // ignore
    }
  }
  
  const allUserIds = Array.from(uniqueUserIds);
  console.log(`Found ${allUserIds.length} unique user_ids with data.`);
  
  console.log("Running AccountLifecycleService.deleteAccount on all of them to eradicate orphans natively...");
  for (const uid of allUserIds) {
     console.log(`Deleting zombie user_id: ${uid}`);
     await accountLifecycleService.deleteAccount(uid);
  }
  
  console.log("Cleanup complete!");
}

findAndDestroyOrphans();
