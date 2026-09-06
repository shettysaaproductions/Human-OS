import { supabaseAdmin } from "./src/lib/supabase";
import { AccountLifecycleService } from "./src/services/AccountLifecycleService";

async function run() {
  console.log("PHASE 1 & 2: DRY RUN REPORT\n");
  
  // Get all users from auth.users
  const { data: users, error: authErr } = await supabaseAdmin.auth.admin.listUsers();
  if (authErr) {
    console.error("Failed to list users:", authErr);
    return;
  }
  
  console.log(`1. Number of existing auth.users accounts: ${users.users.length}`);
  console.log("2. Complete list of accounts:");
  for (const u of users.users) {
    console.log(`   - user_id: ${u.id}, email: ${u.email}, status: ${u.confirmed_at ? "confirmed" : "unconfirmed"}`);
  }
  console.log("");
  
  const tables = AccountLifecycleService.USER_OWNED_TABLES;
  
  console.log("3. Every account-owned table & 4. Row counts:");
  for (const t of tables) {
    const { count, error } = await supabaseAdmin.from(t.table).select("*", { count: "exact", head: true });
    if (error) {
       console.log(`   - ${t.table}: ERROR (${error.message})`);
    } else {
       console.log(`   - ${t.table}: ${count} rows`);
    }
  }
  
  console.log("");
  console.log("5. Indirect dependencies & 6. Queued state & 7. Recovery state:");
  
  // background_jobs
  const { count: bgCount } = await supabaseAdmin.from("background_jobs").select("*", { count: "exact", head: true }).eq("status", "pending");
  console.log(`   - background_jobs (pending): ${bgCount || 0} rows`);
  
  // recovery_archive
  const { count: raCount } = await supabaseAdmin.from("recovery_archive").select("*", { count: "exact", head: true });
  console.log(`   - recovery_archive: ${raCount || 0} rows`);
  
  // telemetry_events
  const { count: teCount } = await supabaseAdmin.from("telemetry_events").select("*", { count: "exact", head: true }).not("user_id", "is", null);
  console.log(`   - telemetry_events (with user_id): ${teCount || 0} rows`);
  
  // audit_logs
  const { count: alCount } = await supabaseAdmin.from("audit_logs").select("*", { count: "exact", head: true });
  console.log(`   - audit_logs: ${alCount || 0} rows`);
  
  // tombstones
  const { count: tsCount } = await supabaseAdmin.from("tombstones").select("*", { count: "exact", head: true });
  console.log(`   - tombstones: ${tsCount || 0} rows`);
  
  // account_tombstones
  const { count: atsCount } = await supabaseAdmin.from("account_tombstones").select("*", { count: "exact", head: true });
  console.log(`   - account_tombstones: ${atsCount || 0} rows`);
}
run();
