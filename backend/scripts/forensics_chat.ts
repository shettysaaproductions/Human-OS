import { supabaseAdmin } from '../src/lib/supabase';
import fs from 'fs';

async function run() {
  const userId = '80547977-5bdd-4252-a1a1-7e06902d5c8d';

  const { data: messages } = await supabaseAdmin
    .from('chat_history')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });

  fs.writeFileSync('forensics_chat.json', JSON.stringify({
    messages
  }, null, 2));
}

run().catch(console.error);
