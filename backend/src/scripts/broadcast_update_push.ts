import { supabaseAdmin } from '../lib/supabase';
import { sendPushNotification } from '../lib/pushNotifications';
import { logger } from '../lib/logger';

import * as fs from 'fs';
import * as path from 'path';

interface UpdateEntry {
  version: string;
  date: string;
  title: string;
  message: string[];
}

function loadLatestUpdate(targetVersion?: string): UpdateEntry | null {
  const candidatePaths = [
    path.resolve(process.cwd(), '../mobile/src/config/updateHistory.json'),
    path.resolve(process.cwd(), 'mobile/src/config/updateHistory.json'),
    path.resolve(__dirname, '../../../../mobile/src/config/updateHistory.json'),
    path.resolve(__dirname, '../../../mobile/src/config/updateHistory.json'),
  ];

  for (const p of candidatePaths) {
    try {
      if (fs.existsSync(p)) {
        const history: UpdateEntry[] = JSON.parse(fs.readFileSync(p, 'utf8'));
        if (Array.isArray(history) && history.length > 0) {
          if (targetVersion) {
            const cleanTarget = targetVersion.replace(/^v/, '');
            const matched = history.find(h => h.version === cleanTarget || `v${h.version}` === targetVersion);
            if (matched) return matched;
          }
          return history[0];
        }
      }
    } catch {}
  }
  return null;
}

async function main() {
  const versionArg = process.argv[2];
  const updateInfo = loadLatestUpdate(versionArg);

  const version = updateInfo?.version ? `v${updateInfo.version.replace(/^v/, '')}` : (versionArg || 'v0.3.11-beta');
  const title = updateInfo?.title ? `${updateInfo.title}` : `🚀 Nova Update ${version} Live!`;

  // Build high-impact bullet summary for the notification plate
  let body: string;
  if (updateInfo?.message && updateInfo.message.length > 0) {
    const highlights = updateInfo.message.slice(0, 3).map(m => {
      // Shorten bullet if too long for notification shade preview
      return m.length > 120 ? `• ${m.substring(0, 117)}...` : `• ${m}`;
    });
    body = highlights.join('\n');
  } else {
    body = `Nova just got smarter! Check out the latest features and improvements in HumanOS.`;
  }

  logger.info(`[UpdateBroadcast] Preparing update broadcast for ${version}: "${title}"`);
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
    channelId: 'nova_updates',
    priority: 'high' as const,
    ttl: 86400,
    data: {
      type: 'nova_update',
      version,
      title,
      message: body,
      notes: updateInfo?.message || []
    }
  }));

  await sendPushNotification(messages);
  logger.info('[UpdateBroadcast] Successfully broadcasted update notification to all devices.');
}

main().catch(err => {
  logger.error('[UpdateBroadcast] Fatal error in broadcast script', { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
