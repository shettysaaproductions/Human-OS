import { supabaseAdmin } from '../src/lib/supabase';
import fs from 'fs';

async function run() {
  const userId = '32996d46-e2ca-4b85-9467-285ca848a771';
  const outPath = 'forensic_data.json';
  const data: any = {};

  data.user = { userId, email: 'admin@recrutos.com' };

  const { data: chats } = await supabaseAdmin.from('chat_history').select('*').eq('user_id', userId).order('created_at', { ascending: true });
  data.chats = chats || [];

  const { data: presence } = await supabaseAdmin.from('user_presence').select('*').eq('user_id', userId).order('created_at', { ascending: true });
  data.presence = presence || [];

  const { data: outreach } = await supabaseAdmin.from('nova_outreach_log').select('*').eq('user_id', userId).order('created_at', { ascending: true });
  data.outreach = outreach || [];

  const { data: reminders } = await supabaseAdmin.from('reminders').select('*').eq('user_id', userId);
  const { data: agenda } = await supabaseAdmin.from('nova_agenda').select('*').eq('user_id', userId);
  const { data: followups } = await supabaseAdmin.from('nova_followups').select('*').eq('user_id', userId);
  const { data: actions } = await supabaseAdmin.from('nova_actions').select('*').eq('user_id', userId);
  data.reminders = reminders || [];
  data.agenda = agenda || [];
  data.followups = followups || [];
  data.actions = actions || [];

  const { data: timing } = await supabaseAdmin.from('watchtower_timing_logs').select('*').eq('user_id', userId);
  const { data: attention } = await supabaseAdmin.from('watchtower_attention_decisions').select('*').eq('user_id', userId);
  const { data: signals } = await supabaseAdmin.from('watchtower_cognitive_signals').select('*').eq('user_id', userId);
  data.timing = timing || [];
  data.attention = attention || [];
  data.signals = signals || [];

  const { data: heartbeats } = await supabaseAdmin.from('watchtower_heartbeat_runs').select('*').order('created_at', { ascending: false }).limit(100);
  data.heartbeats = heartbeats || [];

  const { data: memories } = await supabaseAdmin.from('memories').select('*').eq('user_id', userId);
  const { data: workingMemory } = await supabaseAdmin.from('working_memory').select('*').eq('user_id', userId);
  const { data: episodic } = await supabaseAdmin.from('episodic_memories').select('*').eq('user_id', userId);
  const { data: shortTerm } = await supabaseAdmin.from('short_term_memories').select('*').eq('user_id', userId);
  const { data: candidateClaims } = await supabaseAdmin.from('candidate_synthesis_claims').select('*').eq('user_id', userId);
  data.memories = memories || [];
  data.workingMemory = workingMemory || [];
  data.episodic = episodic || [];
  data.shortTerm = shortTerm || [];
  data.candidateClaims = candidateClaims || [];

  const { data: lifeThreads } = await supabaseAdmin.from('life_threads').select('*').eq('user_id', userId);
  data.lifeThreads = lifeThreads || [];

  const { data: doubts } = await supabaseAdmin.from('nova_cognitive_doubts').select('*').eq('user_id', userId);
  data.doubts = doubts || [];

  fs.writeFileSync(outPath, JSON.stringify(data, null, 2));
  console.log("Extraction complete.");
}

run().catch(console.error);
