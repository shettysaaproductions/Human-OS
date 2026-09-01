import { supabaseAdmin } from '../src/lib/supabase';

async function run() {
  const targetId = '43aa42fb-5af8-4133-a0e5-ac9534ec0fec';

  console.log("=== 1. CANONICAL ACCOUNT ERASURE ===");
  try {
    const { accountLifecycleService } = await import('../src/services/AccountLifecycleService');
    const result = await accountLifecycleService.deleteAccount(targetId);
    console.log(`Deletion Result: ${JSON.stringify(result)}`);
    console.log(`Successfully eradicated test user: ${targetId}`);
  } catch (e) {
    console.error("Error eradicating user:", e);
  }

  console.log("\n=== 2. VERIFY BASELINE ZERO STATE ===");
  const { data: { users }, error: uErr } = await supabaseAdmin.auth.admin.listUsers();
  const authCount = users?.length || 0;
  
  const { count: profCount } = await supabaseAdmin.from('profiles').select('*', { count: 'exact', head: true });
  
  console.log(`auth.users: ${authCount}`);
  console.log(`profiles: ${profCount}`);

  const { AccountLifecycleService } = await import('../src/services/AccountLifecycleService');
  let nonZeroCount = 0;
  for (const item of AccountLifecycleService.USER_OWNED_TABLES) {
    if (item.table === 'profiles') continue;
    const { count } = await supabaseAdmin.from(item.table).select('*', { count: 'exact', head: true });
    if (count && count > 0) {
      nonZeroCount++;
      console.log(`  ${item.table}: ${count}`);
    }
  }
  
  if (nonZeroCount === 0) {
    console.log("ALL_USER_OWNED_TABLES_ZERO = YES");
  } else {
    console.log(`ALL_USER_OWNED_TABLES_ZERO = NO (${nonZeroCount} tables have data)`);
  }
}

run().catch(console.error);
