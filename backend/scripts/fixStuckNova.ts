import { supabaseAdmin } from '../src/lib/supabase';
import { sendNovaReplyNotification } from '../src/lib/pushNotifications';

async function main() {
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabaseAdmin
    .from('chat_history')
    .select('id, role, content, created_at, user_id, conversation_id')
    .gte('created_at', twoHoursAgo)
    .order('created_at', { ascending: true })
    .limit(50);

  if (error) { console.error('DB error:', error.message); process.exit(1); }
  if (!data?.length) { console.log('No messages in last 2 hours'); process.exit(0); }

  // Group by user
  const byUser: Record<string, typeof data> = {};
  for (const m of data) {
    if (!byUser[m.user_id]) byUser[m.user_id] = [];
    byUser[m.user_id].push(m);
  }

  for (const [userId, msgs] of Object.entries(byUser)) {
    console.log(`\n=== User ${userId.substring(0,8)} — ${msgs.length} messages ===`);
    
    // Find user messages that have no assistant reply within 5 minutes after them
    const stuckMessages: typeof data = [];
    for (const msg of msgs) {
      if (msg.role !== 'user') continue;
      const msgTime = new Date(msg.created_at).getTime();
      const hasReply = msgs.some(m => 
        m.role === 'assistant' && 
        new Date(m.created_at).getTime() > msgTime &&
        new Date(m.created_at).getTime() < msgTime + 5 * 60 * 1000
      );
      if (!hasReply) {
        console.log(`  ⚠️  No reply within 5min for: "${msg.content?.substring(0, 60)}" at ${msg.created_at}`);
        stuckMessages.push(msg);
      }
    }

    // Inject fallback replies for stuck messages
    for (const stuck of stuckMessages) {
      // Check if there's already any reply after this message
      const alreadyHasReplyLater = msgs.some(m => 
        m.role === 'assistant' && 
        new Date(m.created_at).getTime() > new Date(stuck.created_at).getTime()
      );
      if (alreadyHasReplyLater) {
        console.log(`  ↳ Skipping (Nova replied later)`);
        continue;
      }

      const fallback = 'Yaar sorry, ek second ke liye kuch technical dikkat hui! Set hai — 10:15 baje dawai ka reminder aa jayega. 💊';
      const { error: insertErr } = await supabaseAdmin.from('chat_history').insert({
        user_id: stuck.user_id,
        conversation_id: stuck.conversation_id,
        role: 'assistant',
        content: fallback,
      });
      if (insertErr) { console.error('Insert error:', insertErr.message); continue; }
      console.log(`  ✅ Fallback reply injected for stuck message`);

      const { data: profile } = await supabaseAdmin.from('profiles').select('push_token').eq('id', userId).maybeSingle();
      if (profile?.push_token) {
        await sendNovaReplyNotification(profile.push_token, fallback);
        console.log(`  ✅ Push notification sent`);
      }
    }
  }
  console.log('\nDone!');
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
