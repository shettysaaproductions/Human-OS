import { supabaseAdmin } from '../src/lib/supabase';

async function run() {
  console.log("============================================================");
  console.log("USER");
  console.log("============================================================");
  const { data: { users }, error: uErr } = await supabaseAdmin.auth.admin.listUsers();
  const authCount = users?.length || 0;
  
  if (authCount !== 1) {
    console.error(`EXPECTED 1 AUTH USER, FOUND ${authCount}`);
  }
  
  const user = users?.[0];
  const userId = user?.id;
  
  console.log(`USER_ID = ${userId}`);
  console.log(`EMAIL = ${user?.email}`);
  
  const { data: profile } = await supabaseAdmin.from('profiles').select('*').eq('id', userId).single();
  console.log(`PROFILE_ID = ${profile?.id}`);
  console.log(`ONBOARDING_STATUS = ${profile?.onboarding_completed}`);

  console.log("\n============================================================");
  console.log("1. CHAT INGESTION");
  console.log("============================================================");
  const { data: chats } = await supabaseAdmin.from('chat_history').select('*').eq('user_id', userId).order('created_at', { ascending: false });
  
  const userMessages = chats?.filter(c => c.role === 'user') || [];
  const assistantMessages = chats?.filter(c => c.role === 'assistant') || [];
  
  console.log(`User messages: ${userMessages.length}`);
  console.log(`Assistant messages: ${assistantMessages.length}`);
  console.log(`Total messages: ${chats?.length || 0}`);
  
  console.log("\nLATEST 20 TURNS:");
  console.log("TURN | MESSAGE_ID | ROLE | CREATED_AT | CONTENT_SUMMARY | PROCESSING_STATUS");
  chats?.slice(0, 20).reverse().forEach((c, i) => {
    const summary = c.content?.substring(0, 50).replace(/\n/g, ' ') || '';
    console.log(`${i+1} | ${c.id} | ${c.role} | ${c.created_at} | ${summary} | ${c.processing_status || 'N/A'}`);
  });

  console.log("\n============================================================");
  console.log("2. MEMORY PIPELINE");
  console.log("============================================================");
  
  const tables = ['memories', 'working_memory', 'episodic_memories', 'short_term_memories', 'memory_events', 'memory_access_log', 'candidate_synthesis_claims'];
  for (const table of tables) {
    const { data, error } = await supabaseAdmin.from(table).select('*').eq('user_id', userId).order('created_at', { ascending: true });
    console.log(`\n--- ${table.toUpperCase()} ---`);
    if (error) {
      console.log(`  Error: ${error.message}`);
    } else if (data && data.length > 0) {
      data.forEach(m => console.log(JSON.stringify(m)));
    } else {
      console.log("  None");
    }
  }

  console.log("\n============================================================");
  console.log("5. LIFETHREAD PIPELINE");
  console.log("============================================================");
  const { data: threads, error: threadsErr } = await supabaseAdmin.from('life_threads').select('*').eq('user_id', userId);
  if (threadsErr) {
    console.log(`  Error: ${threadsErr.message}`);
  } else if (threads && threads.length > 0) {
    threads.forEach(t => console.log(JSON.stringify(t)));
  } else {
    console.log("  None");
  }

  console.log("\n============================================================");
  console.log("6. WATCHTOWER PIPELINE");
  console.log("============================================================");
  const wtTables = ['watchtower_heartbeat_runs', 'watchtower_cognitive_signals', 'watchtower_attention_decisions', 'watchtower_timing_logs'];
  for (const table of wtTables) {
    const { data, error } = await supabaseAdmin.from(table).select('*').eq('user_id', userId);
    console.log(`\n--- ${table.toUpperCase()} ---`);
    if (error) {
      console.log(`  Error: ${error.message}`);
    } else if (data && data.length > 0) {
      data.forEach(m => console.log(JSON.stringify(m)));
    } else {
      console.log("  None");
    }
  }

  console.log("\n============================================================");
  console.log("10. OUTREACH");
  console.log("============================================================");
  const outTables = ['nova_outreach_log', 'nova_agenda', 'nova_followups'];
  for (const table of outTables) {
    const { data, error } = await supabaseAdmin.from(table).select('*').eq('user_id', userId);
    console.log(`\n--- ${table.toUpperCase()} ---`);
    if (error) {
       console.log(`  Error: ${error.message}`);
    } else if (data && data.length > 0) {
      data.forEach(m => console.log(JSON.stringify(m)));
    } else {
      console.log("  None");
    }
  }
}

run().catch(console.error);
