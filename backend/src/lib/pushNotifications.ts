/**
 * pushNotifications.ts
 *
 * Sends push notifications via Expo's Push Notification service.
 * No extra SDK required — it's a plain HTTPS POST.
 * https://docs.expo.dev/push-notifications/sending-notifications/
 */

import { logger } from './logger';

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
}

/**
 * Send a push notification to one or more Expo Push Tokens.
 * Silently swallows errors — never crashes the chat flow.
 */
export async function sendPushNotification(messages: ExpoPushMessage[]): Promise<void> {
  if (!messages.length) return;

  // Filter out non-Expo tokens (safety guard)
  const validMessages = messages.filter(m => m.to.startsWith('ExponentPushToken['));
  if (!validMessages.length) return;

  try {
    const response = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(validMessages),
      signal: AbortSignal.timeout(8000), // 8-second timeout
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      logger.warn('[Push] Expo push API error', { status: response.status, body: text });
      return;
    }

    const result = await response.json();
    const errors = result?.data?.filter((r: any) => r.status === 'error') ?? [];
    if (errors.length > 0) {
      logger.warn('[Push] Some tokens rejected', { errors });
    } else {
      logger.info('[Push] Notifications sent', { count: validMessages.length });
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
    data: { type: 'nova_moment' },
  }]);
}
