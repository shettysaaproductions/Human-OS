import { supabaseAdmin } from '../src/lib/supabase';
import { AccountLifecycleService } from '../src/services/AccountLifecycleService';

async function run() {
  console.log("=== 1. IDENTIFY THE NEW USER ===");
  const { data: { users }, error: uErr } = await supabaseAdmin.auth.admin.listUsers();
  const authCount = users?.length || 0;
  
  if (authCount !== 1) {
    console.error(`EXPECTED 1 AUTH USER, FOUND ${authCount}`);
  }
  
  const user = users?.[0];
  const userId = user?.id;
  
  console.log(`TEST_USER_ID = ${userId}`);
  console.log(`EMAIL = ${user?.email}`);
  console.log(`created_at = ${user?.created_at}`);
  console.log(`last_sign_in_at = ${user?.last_sign_in_at}`);
  console.log(`user_metadata = ${JSON.stringify(user?.user_metadata)}`);
  
  const { data: profile } = await supabaseAdmin.from('profiles').select('*').eq('id', userId).single();
  console.log(`TEST_PROFILE_ID = ${profile?.id}`);
  console.log(`ONBOARDING_COMPLETED = ${profile?.onboarding_completed}`);
  
  console.log("\n=== 2. POST-ONBOARDING COUNTS ===");
  const counts: Record<string, number> = {};
  for (const item of AccountLifecycleService.USER_OWNED_TABLES) {
    if (item.table === 'profiles') continue;
    const { count } = await supabaseAdmin.from(item.table).select('*', { count: 'exact', head: true }).eq(item.userColumn, userId);
    counts[item.table] = count || 0;
  }
  
  console.log("POST_ONBOARDING_COUNTS =");
  for (const [table, count] of Object.entries(counts)) {
    console.log(`  ${table}: ${count}`);
  }

  console.log("\n=== 4. MEMORY SEEDS ===");
  const { data: memories } = await supabaseAdmin.from('memories').select('*').eq('user_id', userId);
  console.log("ONBOARDING_MEMORY_SEEDS =");
  if (memories && memories.length > 0) {
    memories.forEach((m: any) => {
      console.log(`  - id: ${m.id}`);
      console.log(`    canonical_key: ${m.canonical_key}`);
      console.log(`    value: ${m.value}`);
      console.log(`    source_authority: ${m.source_authority}`);
      console.log(`    protection_source: ${m.protection_source}`);
      console.log(`    is_protected: ${m.is_protected}`);
      console.log(`    compression_status: ${m.compression_status}`);
      console.log(`    lifecycle_state: ${m.lifecycle_state}`);
      console.log(`    source_message_id: ${m.source_message_id}`);
      console.log(`    created_at: ${m.created_at}`);
    });
  } else {
    console.log("  None");
  }

  console.log("\n=== 5. LIFETHREADS ===");
  const { data: threads } = await supabaseAdmin.from('life_threads').select('*').eq('user_id', userId);
  console.log("ONBOARDING_LIFETHREADS =");
  if (threads && threads.length > 0) {
    console.log(JSON.stringify(threads, null, 2));
  } else {
    console.log("  None");
  }

  console.log("\n=== 6. WATCHTOWER ===");
  console.log("ONBOARDING_WATCHTOWER_ACTIVITY =");
  console.log(`  timing_logs: ${counts['watchtower_timing_logs']}`);
  console.log(`  attention_decisions: ${counts['watchtower_attention_decisions']}`);
  console.log(`  cognitive_signals: ${counts['watchtower_cognitive_signals']}`);
  console.log(`  guardian_runs: ${counts['nova_guardian_runs']}`);
  
  console.log("\n=== 7. OUTREACH ===");
  console.log("ONBOARDING_OUTREACH =");
  console.log(`  nova_outreach_log: ${counts['nova_outreach_log']}`);

  console.log("\n=== 9. CHAT HISTORY ===");
  console.log("ONBOARDING_CHAT_HISTORY =");
  console.log(`  chat_history: ${counts['chat_history']}`);

}

run().catch(console.error);
