import { supabaseAdmin } from '../src/lib/supabase';

async function main() {
  const userId = '2289911c-f7c4-43c7-9609-1d121c3a0503';
  const { data: profile } = await supabaseAdmin.from('profiles').select('push_token').eq('id', userId).maybeSingle();
  if (!profile?.push_token) return console.error('No token');
  
  console.log('Sending push to:', profile.push_token);
  
  const res = await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      to: profile.push_token,
      title: 'Nova Diagnostics',
      body: 'Testing receipt',
      sound: 'default',
      channelId: 'nova_messages',
      priority: 'high',
    })
  });

  const data = await res.json();
  console.log('Push response:', data);

  const ticket = data.data; // It's a single object since we sent a single object
  if (!ticket || ticket.status !== 'ok') {
    return console.log('Did not get OK ticket:', ticket);
  }

  console.log('Waiting 5 seconds for FCM processing...');
  await new Promise(r => setTimeout(r, 5000));

  const receiptRes = await fetch('https://exp.host/--/api/v2/push/getReceipts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids: [ticket.id] })
  });

  const receiptData = await receiptRes.json();
  console.log('FCM Receipt:', JSON.stringify(receiptData, null, 2));
}

main().catch(console.error);
