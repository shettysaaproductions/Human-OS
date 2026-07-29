import { supabaseAdmin } from '../src/lib/supabase';
import { sendNovaReplyNotification } from '../src/lib/pushNotifications';

async function main() {
  const userId = '2289911c-f7c4-43c7-9609-1d121c3a0503';
  
  console.log('Fetching push token for user:', userId);
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('push_token')
    .eq('id', userId)
    .maybeSingle();

  if (!profile?.push_token) {
    console.error('No push token found!');
    return;
  }

  console.log('Token:', profile.push_token);
  const testMsg = 'Test notification! 🚀 Did you see a banner drop down?';
  
  await sendNovaReplyNotification(profile.push_token, testMsg);
  console.log('Sent successfully!');
}

main().catch(console.error);
