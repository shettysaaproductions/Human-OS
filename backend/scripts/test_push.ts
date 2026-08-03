import { supabaseAdmin } from '../src/lib/supabase';
import { sendNovaReplyNotification } from '../src/lib/pushNotifications';
import { config } from 'dotenv';
import path from 'path';

// Load .env
config({ path: path.resolve(__dirname, '../.env') });

async function run() {
  console.log('Fetching users with push tokens...');
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('id, push_token, preferred_name')
    .not('push_token', 'is', null);

  if (error) {
    console.error('DB Error:', error);
    return;
  }

  if (!data || data.length === 0) {
    console.log('No users found with a push_token. The app has not successfully registered a token yet.');
    return;
  }

  console.log(`Found ${data.length} users with push tokens.`);
  for (const user of data) {
    console.log(`Sending test push to ${user.preferred_name || user.id} (Token: ${user.push_token.substring(0, 20)}...)`);
    try {
      await sendNovaReplyNotification(user.push_token, 'This is a test push notification from the backend script!');
      console.log('-> Push sent successfully (check device)');
    } catch (err: any) {
      console.error('-> Push failed:', err?.message);
    }
  }
}

run();
