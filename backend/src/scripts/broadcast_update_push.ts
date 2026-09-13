import { supabaseAdmin } from '../lib/supabase';
import { sendPushNotification } from '../lib/pushNotifications';
import { logger } from '../lib/logger';

async function main() {
  const version = process.argv[2] || 'v0.3.1-beta';
  const title = `🚀 Nova Update ${version} Live!`;
  const body = `Nova just got smarter! Rich memory graph branching, anti-hallucination shield, and natural companion reminders are now active.`;

  logger.info('[UpdateBroadcast] Fetching registered push tokens...');
  const { data: profiles, error } = await supabaseAdmin
    .from('profiles')
    .select('id, preferred_name, push_token')
    .not('push_token', 'is', null);

  if (error) {
    logger.error('[UpdateBroadcast] Failed to fetch profiles', { error: error.message });
    process.exit(1);
  }

  const validProfiles = (profiles || []).filter(p => p.push_token && (p.push_token.startsWith('ExponentPushToken[') || p.push_token.startsWith('ExpoPushToken[')));
  logger.info(`[UpdateBroadcast] Found ${validProfiles.length} valid recipient(s).`);

  if (validProfiles.length === 0) {
    logger.warn('[UpdateBroadcast] No valid push tokens found.');
    return;
  }

  const messages = validProfiles.map(p => ({
    to: p.push_token,
    title,
    body,
    sound: 'default' as const,
    channelId: 'nova_messages',
    priority: 'high' as const,
    ttl: 86400,
    data: {
      type: 'nova_reply',
      message: body,
      version
    }
  }));

  await sendPushNotification(messages);
  logger.info('[UpdateBroadcast] Successfully broadcasted update notification to all devices.');
}

main().catch(err => {
  logger.error('[UpdateBroadcast] Fatal error in broadcast script', { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
