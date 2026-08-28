const dotenv = require('dotenv');
dotenv.config({ path: '.env' });
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const TARGET_USER_ID = '3ec3fcb7-d575-4279-b8c3-b129af620fea';

async function dumpAll() {
  console.log('Fetching forensic snapshot for user:', TARGET_USER_ID);

  // 1. Profile
  const { data: profile } = await supabase.from('profiles').select('*').eq('id', TARGET_USER_ID).maybeSingle();

  // 2. Chat History (all rows)
  const { data: chatHistory } = await supabase
    .from('chat_history')
    .select('*')
    .eq('user_id', TARGET_USER_ID)
    .order('created_at', { ascending: true });

  // 3. Proactive Outreach Log
  const { data: outreachLog } = await supabase
    .from('nova_outreach_log')
    .select('*')
    .eq('user_id', TARGET_USER_ID)
    .order('created_at', { ascending: true });

  // 4. Followups
  const { data: followups } = await supabase
    .from('nova_followups')
    .select('*')
    .eq('user_id', TARGET_USER_ID)
    .order('created_at', { ascending: true });

  // 5. Reminders
  const { data: reminders } = await supabase
    .from('reminders')
    .select('*')
    .eq('user_id', TARGET_USER_ID)
    .order('created_at', { ascending: true });

  // 6. Life Threads
  const { data: lifeThreads } = await supabase
    .from('life_threads')
    .select('*')
    .eq('user_id', TARGET_USER_ID)
    .order('created_at', { ascending: true });

  // 7. Actions
  const { data: actions } = await supabase
    .from('nova_actions')
    .select('*')
    .eq('user_id', TARGET_USER_ID)
    .order('created_at', { ascending: true });

  // 8. Memories (all types)
  const { data: memories } = await supabase
    .from('memories')
    .select('*')
    .eq('user_id', TARGET_USER_ID)
    .order('created_at', { ascending: true });

  const { data: stm } = await supabase
    .from('short_term_memories')
    .select('*')
    .eq('user_id', TARGET_USER_ID)
    .order('created_at', { ascending: true });

  const { data: wm } = await supabase
    .from('working_memory')
    .select('*')
    .eq('user_id', TARGET_USER_ID)
    .order('updated_at', { ascending: true });

  const { data: episodic } = await supabase
    .from('episodic_memories')
    .select('*')
    .eq('user_id', TARGET_USER_ID)
    .order('created_at', { ascending: true });

  // 9. Presence & Sessions
  const { data: presence } = await supabase
    .from('user_presence')
    .select('*')
    .eq('user_id', TARGET_USER_ID)
    .maybeSingle();

  const { data: sessions } = await supabase
    .from('conversation_sessions')
    .select('*')
    .eq('user_id', TARGET_USER_ID)
    .order('session_date', { ascending: true });

  // 10. Agenda / Goals / Nudges / Triggers
  const { data: agenda } = await supabase
    .from('nova_agenda_items')
    .select('*')
    .eq('user_id', TARGET_USER_ID);

  const { data: goals } = await supabase
    .from('goals')
    .select('*')
    .eq('user_id', TARGET_USER_ID);

  const { data: habits } = await supabase
    .from('habits')
    .select('*')
    .eq('user_id', TARGET_USER_ID);

  const { data: nudges } = await supabase
    .from('nudges')
    .select('*')
    .eq('user_id', TARGET_USER_ID);

  const { data: proactiveTriggers } = await supabase
    .from('proactive_triggers')
    .select('*')
    .eq('user_id', TARGET_USER_ID);

  // 11. Queue / Background Jobs
  const { data: bgJobs } = await supabase
    .from('background_jobs')
    .select('id, job_type, status, attempts, max_attempts, last_error, created_at, updated_at')
    .eq('user_id', TARGET_USER_ID)
    .order('created_at', { ascending: false })
    .limit(50);

  const { data: failedJobs } = await supabase
    .from('failed_jobs')
    .select('id, job_type, error, created_at')
    .eq('user_id', TARGET_USER_ID)
    .order('created_at', { ascending: false })
    .limit(50);

  const snapshot = {
    user_id: TARGET_USER_ID,
    profile,
    chatHistory,
    outreachLog,
    followups,
    reminders,
    lifeThreads,
    actions,
    memories,
    short_term_memories: stm,
    working_memory: wm,
    episodic_memories: episodic,
    presence,
    sessions,
    agenda,
    goals,
    habits,
    nudges,
    proactiveTriggers,
    bgJobs,
    failedJobs
  };

  fs.writeFileSync('scripts/forensic_snapshot_raw.json', JSON.stringify(snapshot, null, 2));
  console.log('Saved raw snapshot to scripts/forensic_snapshot_raw.json');
  console.log(`Summary: ${chatHistory?.length} chats, ${memories?.length} memories, ${stm?.length} stm, ${wm?.length} wm, ${lifeThreads?.length} threads, ${actions?.length} actions, ${reminders?.length} reminders, ${outreachLog?.length} outreach, ${followups?.length} followups`);
}

dumpAll().catch(console.error);
