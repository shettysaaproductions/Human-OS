import { supabaseAdmin } from '../src/lib/supabase';
import fs from 'fs';

async function run() {
  const userId = '80547977-5bdd-4252-a1a1-7e06902d5c8d';

  // We are looking for outreach generated around 15:12 UTC and 15:31 UTC.
  const { data: outreachLogs } = await supabaseAdmin
    .from('nova_outreach_log')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });

  const notif1 = outreachLogs?.find(l => l.created_at.startsWith('2026-09-01T15:12'));
  const notif2 = outreachLogs?.find(l => l.created_at.startsWith('2026-09-01T15:31'));

  // Let's get messages to trace source intent
  const { data: messages } = await supabaseAdmin
    .from('messages')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });
    
  // Let's get agenda items
  const { data: agenda } = await supabaseAdmin
    .from('nova_agenda')
    .select('*')
    .eq('user_id', userId);
    
  // Let's get reminders
  const { data: reminders } = await supabaseAdmin
    .from('reminders')
    .select('*')
    .eq('user_id', userId);
    
  // Let's get background jobs
  const { data: backgroundJobs } = await supabaseAdmin
    .from('background_jobs')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });

  const { data: watchtowerTiming } = await supabaseAdmin
    .from('watchtower_timing_logs')
    .select('*')
    .eq('user_id', userId);

  const { data: watchtowerAttention } = await supabaseAdmin
    .from('watchtower_attention_decisions')
    .select('*')
    .eq('user_id', userId);

  fs.writeFileSync('forensics_proactive.json', JSON.stringify({
    notif1,
    notif2,
    messages,
    agenda,
    reminders,
    backgroundJobs,
    watchtowerTiming,
    watchtowerAttention,
    outreachLogs
  }, null, 2));
}

run().catch(console.error);
