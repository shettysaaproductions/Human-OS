import { supabaseAdmin } from '../src/lib/supabase';
import { logger } from '../src/lib/logger';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const TARGET_EMAIL = 'admin@recrutos.com';

async function runForensicAudit() {
  logger.info(`Starting Forensic Audit for ${TARGET_EMAIL}`);

  // 1. Identify Account
  const { data: users, error: userErr } = await supabaseAdmin.auth.admin.listUsers();
  if (userErr) throw userErr;

  const authUsers = users.users.filter(u => u.email === TARGET_EMAIL);
  if (authUsers.length === 0) {
    logger.error('Target user not found.');
    process.exit(1);
  }

  const targetUser = authUsers[0];
  const userId = targetUser.id;
  
  const { data: profile } = await supabaseAdmin.from('profiles').select('*').eq('id', userId).single();
  const { data: presence } = await supabaseAdmin.from('user_presence').select('*').eq('user_id', userId).single();

  console.log('============================================================');
  console.log('1. IDENTIFY CURRENT USER');
  console.log('============================================================');
  console.log(`USER_ID: ${userId}`);
  console.log(`PROFILE_ID: ${profile?.id}`);
  console.log(`ONBOARDING_COMPLETED: ${profile?.onboarding_completed}`);
  console.log(`PROFILE_TIMEZONE: ${profile?.timezone}`);
  console.log(`USER_PRESENCE_TIMEZONE: ${presence?.timezone}`);

  console.log('\n============================================================');
  console.log('2. FIND THE EXACT TWO TEST MESSAGES');
  console.log('============================================================');
  const { data: chatHistory } = await supabaseAdmin
    .from('chat_history')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });

  const relevantMessages = chatHistory?.filter(m => 
    m.content.toLowerCase().includes('rasmalai') || 
    m.content.toLowerCase().includes('gulab jamun') ||
    m.content.toLowerCase().includes('remember this') ||
    m.content.toLowerCase().includes('correct that') ||
    m.content.toLowerCase().includes('supriya')
  );

  console.log(JSON.stringify(relevantMessages?.map(m => ({
    id: m.id,
    role: m.role,
    content: m.content,
    created_at: m.created_at,
    conversation_id: m.conversation_id,
    processing_status: m.processing_status,
    meta_keys: m.meta ? Object.keys(m.meta) : null,
    meta: m.meta // include full meta to see context/reasoning
  })), null, 2));

  console.log('\n============================================================');
  console.log('3. TRACE MEMORY EXTRACTION');
  console.log('============================================================');
  
  const searchTerms = ['rasmalai', 'gulab jamun', 'dessert', 'favourite', 'favorite'];
  
  const searchTable = async (table: string) => {
    const { data } = await supabaseAdmin.from(table).select('*').eq('user_id', userId);
    return data?.filter(row => {
      const rowStr = JSON.stringify(row).toLowerCase();
      return searchTerms.some(term => rowStr.includes(term));
    }).map(row => ({ table, ...row })) || [];
  };

  const wm = await searchTable('working_memory');
  const stm = await searchTable('short_term_memories');
  const em = await searchTable('episodic_memories');
  const mem = await searchTable('memories');
  const csc = await searchTable('candidate_synthesis_claims');
  const me = await searchTable('memory_events');
  const mal = await searchTable('memory_access_log');

  const allMemoryMatches = [...wm, ...stm, ...em, ...mem, ...csc, ...me, ...mal];
  console.log(JSON.stringify(allMemoryMatches, null, 2));

  console.log('\n============================================================');
  console.log('4. EXPLICIT REMEMBER TEST & 5. CORRECTION TEST & 6. SUPRIYA');
  console.log('============================================================');
  
  // Full dump of working_memory and memories to see if 'Supriya' is there
  const { data: allWm } = await supabaseAdmin.from('working_memory').select('*').eq('user_id', userId);
  const { data: allMem } = await supabaseAdmin.from('memories').select('*').eq('user_id', userId);
  const { data: allLt } = await supabaseAdmin.from('life_threads').select('*').eq('user_id', userId);

  console.log('--- ALL WORKING MEMORY ---');
  console.log(JSON.stringify(allWm, null, 2));

  console.log('--- ALL MEMORIES ---');
  console.log(JSON.stringify(allMem, null, 2));

  console.log('\n============================================================');
  console.log('8. SYNTHESIS WORKER');
  console.log('============================================================');
  console.log(JSON.stringify(csc, null, 2)); // already fetched above

  console.log('\n============================================================');
  console.log('10. LIFE JOURNEY SAFETY');
  console.log('============================================================');
  const { data: actions } = await supabaseAdmin.from('nova_actions').select('*').eq('user_id', userId);
  const { data: agenda } = await supabaseAdmin.from('nova_agenda').select('*').eq('user_id', userId);
  const { data: followups } = await supabaseAdmin.from('nova_followups').select('*').eq('user_id', userId);
  const { data: outreach } = await supabaseAdmin.from('nova_outreach_log').select('*').eq('user_id', userId);
  const { data: signals } = await supabaseAdmin.from('watchtower_cognitive_signals').select('*').eq('user_id', userId);

  console.log('actions:', actions?.length);
  console.log('agenda:', agenda?.length);
  console.log('followups:', followups?.length);
  console.log('outreach:', outreach?.length);
  console.log('signals:', signals?.length);

}

runForensicAudit().catch(err => {
  logger.error('Audit script failed', err);
  process.exit(1);
});
