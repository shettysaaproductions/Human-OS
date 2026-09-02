import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  { auth: { autoRefreshToken: false, persistSession: false } }
);

async function run() {
  console.log("Fetching user...");
  // Try to find the user in public.users or auth.users
  const { data: users, error: userError } = await supabaseAdmin.auth.admin.listUsers();
  if (userError) {
    console.error("Error fetching users:", userError);
    return;
  }
  const user = users.users.find(u => u.email === 'admin@recrutos.com');
  if (!user) {
    console.log("User admin@recrutos.com not found in auth.users");
    // Fallback to public users
    const { data: pubUsers } = await supabaseAdmin.from('users').select('*').eq('email', 'admin@recrutos.com').limit(1);
    if (pubUsers && pubUsers.length > 0) {
      console.log("Found in public users:", pubUsers[0].id);
    } else {
      return;
    }
  }
  
  const targetId = user.id;
  console.log(`Resolved UUID: ${targetId}`);

  // Fetch chat history
  const { data: chatHistory } = await supabaseAdmin
    .from('chat_history')
    .select('*')
    .eq('user_id', targetId)
    .order('created_at', { ascending: true });

  // Fetch memories
  const { data: memories } = await supabaseAdmin
    .from('memories')
    .select('*')
    .eq('user_id', targetId)
    .order('created_at', { ascending: true });

  // Fetch working_memory
  const { data: workingMemory } = await supabaseAdmin
    .from('working_memory')
    .select('*')
    .eq('user_id', targetId)
    .order('created_at', { ascending: true });

  // Fetch short_term_memories
  const { data: shortTermMemories } = await supabaseAdmin
    .from('short_term_memories')
    .select('*')
    .eq('user_id', targetId)
    .order('created_at', { ascending: true });

  // Fetch candidate synthesis claims
  const { data: synthesisClaims } = await supabaseAdmin
    .from('candidate_synthesis_claims')
    .select('*')
    .eq('user_id', targetId)
    .order('created_at', { ascending: true });

  // Fetch watchtower signals
  const { data: watchtowerSignals } = await supabaseAdmin
    .from('watchtower_cognitive_signals')
    .select('*')
    .eq('user_id', targetId)
    .order('created_at', { ascending: true });

  // Fetch outreach log
  const { data: outreachLog } = await supabaseAdmin
    .from('nova_outreach_log')
    .select('*')
    .eq('user_id', targetId)
    .order('created_at', { ascending: true });
    
  // Fetch agenda
  const { data: agenda } = await supabaseAdmin
    .from('user_agenda')
    .select('*')
    .eq('user_id', targetId)
    .order('created_at', { ascending: true });

  const dump = {
    targetId,
    chatHistory,
    memories,
    workingMemory,
    shortTermMemories,
    synthesisClaims,
    watchtowerSignals,
    outreachLog,
    agenda
  };

  fs.writeFileSync(path.resolve(__dirname, '../forensic_dump_admin.json'), JSON.stringify(dump, null, 2));
  console.log("Dump saved to forensic_dump_admin.json");
}

run().catch(console.error);
