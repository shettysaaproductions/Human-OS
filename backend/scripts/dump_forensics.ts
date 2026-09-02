import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function run() {
  const targetId = '80547977-5bdd-4252-a1a1-7e06902d5c8d';
  const report: any = {};

  const { data: chatHistory } = await supabaseAdmin
    .from('chat_history')
    .select('*')
    .eq('user_id', targetId)
    .order('created_at', { ascending: true });
  report.chat = chatHistory;

  const { data: mems } = await supabaseAdmin
    .from('memories')
    .select('*')
    .eq('user_id', targetId);
  report.memories = mems;

  const { data: wm } = await supabaseAdmin
    .from('working_memory')
    .select('*')
    .eq('user_id', targetId);
  report.working_memory = wm;

  const { data: claims } = await supabaseAdmin
    .from('candidate_synthesis_claims')
    .select('*')
    .eq('user_id', targetId);
  report.claims = claims;

  const { data: signals } = await supabaseAdmin
    .from('watchtower_cognitive_signals')
    .select('*')
    .eq('user_id', targetId);
  report.signals = signals;

  const { data: logs } = await supabaseAdmin
    .from('nova_outreach_log')
    .select('*')
    .eq('user_id', targetId);
  report.outreach = logs;

  fs.writeFileSync('forensic_dump.json', JSON.stringify(report, null, 2));
  console.log("Dumped to forensic_dump.json");
}

run();
