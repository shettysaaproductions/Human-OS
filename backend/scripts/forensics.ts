import { supabaseAdmin } from '../src/lib/supabase';
import fs from 'fs';

async function run() {
  const email = 'admin@recrutos.com';
  const expectedUuid = '80547977-5bdd-4252-a1a1-7e06902d5c8d';
  
  console.log('--- A. AUTH ACCOUNT ---');
  // Need to query auth.users - usually not accessible via regular supabaseAdmin unless we use raw postgres or the admin API
  const { data: { users }, error: userError } = await supabaseAdmin.auth.admin.listUsers();
  const authUser = users?.find(u => u.email === email);
  
  if (userError) {
    console.log('Error fetching users:', userError);
  } else if (authUser) {
    console.log('Account exists: YES');
    console.log('Current UUID:', authUser.id);
    console.log('email:', authUser.email);
    console.log('created_at:', authUser.created_at);
    console.log('updated_at:', authUser.updated_at);
    console.log('email_confirmed_at:', authUser.email_confirmed_at);
    console.log('last_sign_in_at:', authUser.last_sign_in_at);
    console.log('banned_until:', authUser.banned_until);
    console.log('deleted_at:', (authUser as any).deleted_at);
    console.log('user_metadata:', authUser.user_metadata);
    console.log('app_metadata:', authUser.app_metadata);
    console.log('Matches expected UUID?', authUser.id === expectedUuid ? 'YES' : 'NO');
  } else {
    console.log('Account exists: NO');
  }

  const currentUserUuid = authUser?.id || expectedUuid;

  console.log('\n--- B. PROFILE ---');
  const { data: profile } = await supabaseAdmin.from('profiles').select('*').eq('id', currentUserUuid).maybeSingle();
  if (profile) {
    console.log('Profile exists: YES');
    console.log('UUID:', profile.id);
    console.log('timezone:', profile.timezone);
    console.log('onboarding_completed:', profile.onboarding_completed);
    console.log('preferred_name:', profile.preferred_name);
  } else {
    console.log('Profile exists: NO');
  }

  console.log('\n--- D. SHOOT DEAD AUDIT / DELETION TELEMETRY ---');
  const { data: tombstones } = await supabaseAdmin.from('account_tombstones').select('*').eq('user_id', currentUserUuid);
  console.log('account_tombstones:', tombstones);
  
  const { data: backgroundJobs } = await supabaseAdmin.from('background_jobs').select('*').eq('user_id', currentUserUuid).eq('job_type', 'shoot_dead_account');
  console.log('background_jobs (shoot_dead_account):', backgroundJobs);
  
  // Also check for the old UUID if different
  if (authUser && authUser.id !== expectedUuid) {
     const { data: oldTombstones } = await supabaseAdmin.from('account_tombstones').select('*').eq('user_id', expectedUuid);
     console.log('OLD account_tombstones:', oldTombstones);
  }

  console.log('\n--- E. PROACTIVE NOTIFICATION FORENSICS (8:42 PM - 9:01 PM) ---');
  // Today's date is 2026-09-01
  const start = '2026-09-01T15:00:00Z'; // 20:30 IST
  const end = '2026-09-01T16:00:00Z';   // 21:30 IST
  
  const { data: outreachLogs } = await supabaseAdmin.from('nova_outreach_log').select('*').gte('created_at', start).lte('created_at', end);
  console.log('nova_outreach_log:', JSON.stringify(outreachLogs, null, 2));

  const { data: timingLogs } = await supabaseAdmin.from('watchtower_timing_logs').select('*').gte('created_at', start).lte('created_at', end);
  console.log('watchtower_timing_logs:', JSON.stringify(timingLogs, null, 2));
  
  const { data: attentionDecisions } = await supabaseAdmin.from('watchtower_attention_decisions').select('*').gte('created_at', start).lte('created_at', end);
  console.log('watchtower_attention_decisions:', JSON.stringify(attentionDecisions, null, 2));

  const { data: signals } = await supabaseAdmin.from('nova_cognitive_signals').select('*').gte('created_at', start).lte('created_at', end);
  console.log('nova_cognitive_signals:', JSON.stringify(signals, null, 2));

  console.log('\n--- G. MEMORY STATE ---');
  const { data: memories } = await supabaseAdmin.from('memories').select('id, key, value, created_at, lifecycle_state').eq('user_id', currentUserUuid).order('created_at', { ascending: false }).limit(5);
  console.log('Memories count (recent 5):', memories);
  
  const { data: reminders } = await supabaseAdmin.from('reminders').select('*').eq('user_id', currentUserUuid);
  console.log('Reminders:', reminders);
  
  const { data: agenda } = await supabaseAdmin.from('nova_agenda').select('*').eq('user_id', currentUserUuid);
  console.log('Agenda:', agenda);

  fs.writeFileSync('forensics_report.json', JSON.stringify({
    authUser,
    profile,
    tombstones,
    backgroundJobs,
    outreachLogs,
    timingLogs,
    attentionDecisions,
    signals,
    memories,
    reminders,
    agenda
  }, null, 2));
}

run().catch(console.error);
