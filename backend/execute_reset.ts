import { supabaseAdmin } from "./src/lib/supabase";
import { accountLifecycleService } from "./src/services/AccountLifecycleService";

async function executeReset() {
  console.log("PHASE 3: EXECUTING COMPLETE RESET...");

  const { data: users, error: authErr } = await supabaseAdmin.auth.admin.listUsers();
  if (authErr) {
    console.error("Failed to list users:", authErr);
    return;
  }

  const userIds = users.users.map(u => u.id);
  
  if (userIds.length === 0) {
    console.log("No existing users to delete. Proceeding to verification.");
  }

  for (const userId of userIds) {
    console.log(`\nDeleting user: ${userId}`);
    try {
      const result = await accountLifecycleService.deleteAccount(userId);
      console.log(`Success: ${result.success}`);
      if (!result.success) {
        console.error("Errors:", result.errors);
      }
      console.log("Deleted Auth:", result.authDeleted);
      console.log("Deleted Profile:", result.profileDeleted);
      console.log("Tables cleaned:", Object.keys(result.tablesCleaned).length);
    } catch (e: any) {
      console.error(`Exception while deleting ${userId}:`, e.message);
    }
  }

  console.log("\nDeletion phase complete.");
}

executeReset();
