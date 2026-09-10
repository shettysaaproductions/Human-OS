import { supabaseAdmin } from '../src/lib/supabase';

async function main() {
  // 1. Get last 6 messages from chat_history
  const { data: messages, error: mErr } = await supabaseAdmin
    .from('chat_history')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(6);

  console.log('--- RECENT CHAT_HISTORY ROWS ---');
  console.log(JSON.stringify(messages, null, 2));

  // 2. Get recent nova_outreach_log
  const { data: outreach, error: oErr } = await supabaseAdmin
    .from('nova_outreach_log')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(6);

  console.log('--- RECENT NOVA_OUTREACH_LOG ROWS ---');
  console.log(JSON.stringify(outreach, null, 2));

  // 3. Get reminders
  const { data: reminders, error: rErr } = await supabaseAdmin
    .from('reminders')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(10);

  console.log('--- RECENT REMINDERS ---');
  console.log(JSON.stringify(reminders, null, 2));

  // 4. Get watchtower attention items
  const { data: watchtower, error: wErr } = await supabaseAdmin
    .from('watchtower_attention_items')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(6);

  console.log('--- RECENT WATCHTOWER ATTENTION ITEMS ---');
  console.log(JSON.stringify(watchtower, null, 2));
}

main().catch(console.error);
