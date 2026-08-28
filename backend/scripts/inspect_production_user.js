const dotenv = require('dotenv');
dotenv.config({ path: '.env' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function inspectAllUsers() {
  const { data: profiles, error } = await supabase.from('profiles').select('*');
  if (error) {
    console.error('Error fetching profiles:', error);
    return;
  }

  console.log('=== PROFILES AND DATA COUNTS ===');
  for (const p of (profiles || [])) {
    const { count: chatCount } = await supabase.from('chat_history').select('*', { count: 'exact', head: true }).eq('user_id', p.id);
    const { count: memCount } = await supabase.from('memories').select('*', { count: 'exact', head: true }).eq('user_id', p.id);
    const { count: stmCount } = await supabase.from('short_term_memories').select('*', { count: 'exact', head: true }).eq('user_id', p.id);
    const { count: wmCount } = await supabase.from('working_memory').select('*', { count: 'exact', head: true }).eq('user_id', p.id);
    const { count: threadCount } = await supabase.from('life_threads').select('*', { count: 'exact', head: true }).eq('user_id', p.id);
    const { count: actionCount } = await supabase.from('nova_actions').select('*', { count: 'exact', head: true }).eq('user_id', p.id);
    const { count: remCount } = await supabase.from('reminders').select('*', { count: 'exact', head: true }).eq('user_id', p.id);
    const { count: outreachCount } = await supabase.from('nova_outreach_log').select('*', { count: 'exact', head: true }).eq('user_id', p.id);
    const { count: followupCount } = await supabase.from('nova_followups').select('*', { count: 'exact', head: true }).eq('user_id', p.id);

    console.log(`User: ${p.id} | Name: "${p.preferred_name}" | Created: ${p.created_at || p.onboarding_completed_at}`);
    console.log(`  chats: ${chatCount}, memories: ${memCount}, stm: ${stmCount}, wm: ${wmCount}, threads: ${threadCount}, actions: ${actionCount}, reminders: ${remCount}, outreach: ${outreachCount}, followups: ${followupCount}`);
  }
}

inspectAllUsers().catch(console.error);
