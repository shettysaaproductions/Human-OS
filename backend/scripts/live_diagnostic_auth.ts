import { supabaseAdmin } from '../src/lib/supabase';

async function run() {
  console.log("============================================================");
  console.log("3. DATABASE USERS");
  console.log("============================================================");
  const { data: { users }, error: uErr } = await supabaseAdmin.auth.admin.listUsers();
  
  if (uErr) {
    console.error("Error listing users:", uErr);
  }
  
  console.log(`DATABASE_USER_COUNT = ${users?.length || 0}`);
  
  users?.forEach(u => {
    console.log(`\nuser_id: ${u.id}`);
    console.log(`email: ${u.email}`);
    console.log(`created_at: ${u.created_at}`);
    console.log(`last_sign_in_at: ${u.last_sign_in_at}`);
    console.log(`user_metadata: ${JSON.stringify(u.user_metadata)}`);
  });

  console.log("\n============================================================");
  console.log("4. PROFILE MAPPING");
  console.log("============================================================");
  const ids = ['d78ed591-6135-487b-9a55-bd12b7525476', '32996d46-e2ca-4b85-9467-285ca848a771'];
  
  for (const id of ids) {
    const authUser = users?.find(u => u.id === id);
    const { data: profile } = await supabaseAdmin.from('profiles').select('*').eq('id', id).single();
    
    console.log(`\nID: ${id}`);
    console.log(`auth existence: ${!!authUser}`);
    console.log(`profile existence: ${!!profile}`);
    console.log(`email: ${authUser?.email || 'N/A'}`);
    console.log(`onboarding status: ${profile?.onboarding_completed || 'N/A'}`);
    
    // row counts
    const { count: chatCount } = await supabaseAdmin.from('chat_history').select('*', { count: 'exact', head: true }).eq('user_id', id);
    const { count: memCount } = await supabaseAdmin.from('memories').select('*', { count: 'exact', head: true }).eq('user_id', id);
    console.log(`chat_history count: ${chatCount}`);
    console.log(`memories count: ${memCount}`);
  }

  console.log("\n============================================================");
  console.log("5. CHAT OWNERSHIP");
  console.log("============================================================");
  const { data: chats } = await supabaseAdmin.from('chat_history')
    .select('id, user_id, role, created_at, content')
    .order('created_at', { ascending: false })
    .limit(20);
    
  console.log("LATEST 20 CHAT ROWS:");
  chats?.forEach((c, i) => {
    console.log(`[${i+1}] user_id: ${c.user_id} | message_id: ${c.id} | role: ${c.role} | created_at: ${c.created_at} | text: ${c.content.substring(0, 30)}...`);
  });
}

run().catch(console.error);
