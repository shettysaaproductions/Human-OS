/**
 * pushNotifications.ts
 *
 * Sends push notifications via Expo's Push Notification service.
 * No extra SDK required — it's a plain HTTPS POST.
 * https://docs.expo.dev/push-notifications/sending-notifications/
 *
 * Key behaviours:
 * - Automatically clears stale FCM tokens (DeviceNotRegistered) from the DB
 *   so dead tokens never accumulate and silently block future notifications.
 * - Sets a TTL so FCM retries delivery if the device was briefly offline.
 */

import { logger } from './logger';
import { supabaseAdmin } from './supabase';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

interface ExpoPushMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sound?: 'default' | null;
  badge?: number;
  channelId?: string;
  priority?: 'default' | 'normal' | 'high';
  /** Seconds to keep the message on Expo's servers if device is offline (max 2419200 = 28 days) */
  ttl?: number;
}

interface ExpoTicket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
}

/**
 * Send a push notification to one or more Expo Push Tokens.
 * Silently swallows errors — never crashes the chat flow.
 * Automatically removes DeviceNotRegistered tokens from the DB.
 */
export async function sendPushNotification(messages: ExpoPushMessage[]): Promise<void> {
  if (!messages.length) return;

  // Filter out non-Expo tokens (safety guard)
  const validMessages = messages.filter(m => m.to.startsWith('ExponentPushToken['));
  if (!validMessages.length) {
    logger.warn('[Push] No valid ExponentPushToken tokens found — skipping', {
      tokenPreviews: messages.map(m => m.to.substring(0, 20)),
    });
    return;
  }

  // Add TTL: 1 hour for high-priority, 6 hours for normal
  // This ensures FCM retries delivery if the device is temporarily offline
  const messagesWithTtl = validMessages.map(m => ({
    ...m,
    ttl: m.ttl ?? (m.priority === 'high' ? 3600 : 21600),
  }));

  try {
    const response = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(messagesWithTtl),
      signal: AbortSignal.timeout(8000), // 8-second timeout
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      logger.warn('[Push] Expo push API error', { status: response.status, body: text });
      return;
    }

    const result = await response.json() as { data?: ExpoTicket[] };
    const tickets = result?.data ?? [];

    const errors = tickets.filter(t => t.status === 'error');
    const successes = tickets.filter(t => t.status === 'ok');

    if (successes.length > 0) {
      logger.info('[Push] Notifications sent', { count: successes.length });
    }

    if (errors.length > 0) {
      logger.warn('[Push] Some tokens rejected by Expo', { errors });

      // Auto-clear DeviceNotRegistered tokens — these are stale FCM tokens
      // that Android/Google has rotated. Keeping them in the DB means all future
      // pushes to this user silently fail.
      const staleTokens: string[] = [];
      for (let i = 0; i < tickets.length; i++) {
        const ticket = tickets[i];
        if (
          ticket.status === 'error' &&
          ticket.details?.error === 'DeviceNotRegistered'
        ) {
          const staleToken = validMessages[i]?.to;
          if (staleToken) staleTokens.push(staleToken);
        }
      }

      if (staleTokens.length > 0) {
        logger.warn('[Push] Clearing stale DeviceNotRegistered tokens from DB', {
          count: staleTokens.length,
        });

        // Clear push_token for all users whose token is in the stale list
        for (const staleToken of staleTokens) {
          try {
            await supabaseAdmin
              .from('profiles')
              .update({ push_token: null })
              .eq('push_token', staleToken);
          } catch (err) {
            logger.warn('[Push] Failed to clear stale token from DB', {
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
      }
    }
  } catch (err: any) {
    // Fire-and-forget — never let this crash the chat response
    logger.warn('[Push] Failed to send notification (non-critical)', { error: err?.message });
  }
}

/**
 * Send a "Nova replied" notification to a user's push token.
 */
export async function sendNovaReplyNotification(
  pushToken: string,
  replyPreview: string
): Promise<void> {
  const preview = replyPreview.length > 100
    ? replyPreview.substring(0, 97) + '...'
    : replyPreview;

  await sendPushNotification([{
    to: pushToken,
    title: 'Nova',
    body: preview,
    sound: 'default',
    channelId: 'nova_messages',
    priority: 'high',
    ttl: 3600, // 1 hour — if device is offline, try for up to an hour
    data: { type: 'nova_reply' },
  }]);
}

/**
 * Send a proactive moment / check-in notification.
 */
export async function sendMomentNotification(
  pushToken: string,
  title: string,
  body: string
): Promise<void> {
  await sendPushNotification([{
    to: pushToken,
    title,
    body,
    sound: 'default',
    channelId: 'nova_moments',
    priority: 'normal',
    ttl: 21600, // 6 hours — less urgent, still retried
    data: { type: 'nova_moment' },
  }]);
}
