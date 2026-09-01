import { supabaseAdmin } from '../src/lib/supabase';
import { AccountLifecycleService } from '../src/services/AccountLifecycleService';

async function run() {
  const { data: { users }, error: uErr } = await supabaseAdmin.auth.admin.listUsers();
  const authCount = users?.length || 0;
  
  const { count: profCount } = await supabaseAdmin.from('profiles').select('*', { count: 'exact', head: true });
  
  console.log(`auth.users: ${authCount}`);
  console.log(`profiles: ${profCount}`);

  for (const item of AccountLifecycleService.USER_OWNED_TABLES) {
    if (item.table === 'profiles') continue;
    const { count } = await supabaseAdmin.from(item.table).select('*', { count: 'exact', head: true });
    console.log(`${item.table}: ${count}`);
  }
}

run().catch(console.error);
