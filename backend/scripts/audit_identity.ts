import { supabaseAdmin } from '../src/lib/supabase';

async function run() {
  const intendedId = '43aa42fb-5af8-4133-a0e5-ac9534ec0fec';
  const actualId = 'a5f926e9-91d6-4bd7-b70b-ab1a37d716f0';
  
  console.log("=== 1. AUTH USER INVENTORY ===");
  const { data: usersData, error: usersErr } = await supabaseAdmin.auth.admin.listUsers();
  if (usersErr) {
    console.error("Error fetching auth users:", usersErr);
  } else {
    const users = usersData.users.map(u => ({
      id: u.id,
      email: u.email,
      created_at: u.created_at,
      user_metadata: u.user_metadata,
      last_sign_in_at: u.last_sign_in_at
    }));
    console.log(JSON.stringify(users, null, 2));
  }

  console.log("\n=== 2. PROFILE INVENTORY ===");
  const { data: profiles, error: profErr } = await supabaseAdmin.from('profiles').select('*');
  if (profErr) {
    console.error("Error fetching profiles:", profErr);
  } else {
    console.log(JSON.stringify(profiles, null, 2));
  }
}

run().catch(console.error);
