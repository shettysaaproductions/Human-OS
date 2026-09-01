import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function run() {
  const { data: users, error: err1 } = await supabase.auth.admin.listUsers();
  if (err1) console.error(err1);
  
  const adminUser = users?.users.find(u => u.email === 'admin@recrutos.com');
  console.log("Admin User ID:", adminUser?.id);

  if (adminUser) {
    const userId = adminUser.id;
    const { data: sessions, error: err2 } = await supabase.from('sessions').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(5);
    if (err2) console.error(err2);
    console.log("Sessions:", sessions);

    const { data: msgs, error: err3 } = await supabase.from('messages').select('id, content, session_id, created_at, role').eq('user_id', userId).order('created_at', { ascending: false }).limit(20);
    if (err3) console.error(err3);
    console.log("Messages (last 20):", msgs);
  }
}
run();
