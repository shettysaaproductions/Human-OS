import { supabaseAdmin } from '../src/lib/supabase';
import { sendNovaReplyNotification } from '../src/lib/pushNotifications';

async function main() {
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('id, push_token')
    .not('push_token', 'is', null)
    .limit(5);

  console.log('Users with push tokens:', JSON.stringify(data, null, 2));
  console.log('Error:', error);

  if (data && data.length > 0) {
    const user = data[0];
    console.log('\nSending test push to:', user.id, 'token:', user.push_token);
    try {
      await sendNovaReplyNotification(user.push_token!, 'Test notification from debug script — agar dikha toh push working hai! 🎉');
      console.log('Push sent successfully!');
    } catch (err) {
      console.error('Push failed:', err);
    }
  } else {
    console.warn('No users with push tokens found!');
  }
}

main().catch(console.error);
