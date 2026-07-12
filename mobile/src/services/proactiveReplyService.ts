/**
 * Proactive Reply Service — Nova initiates conversation like a real friend
 *
 * Logic:
 * - If the user hasn't sent a message in > 4 hours, Nova may initiate
 * - Uses a randomised window (3–8 hours) to feel natural and human
 * - Rate-limited: never fires more than once every 3 hours
 * - Throttled so it only fires on foreground (not repeatedly)
 * - Adds Nova's message directly to the chat store as an assistant bubble
 */

import { api } from './api';
import * as SecureStore from 'expo-secure-store';

const MIN_GAP_MS  = 3 * 60 * 60 * 1000; // 3 hours minimum between proactive pings
const MAX_GAP_MS  = 8 * 60 * 60 * 1000; // 8 hours maximum gap before forcing a check

const RATE_LIMIT_KEY      = 'nova_last_proactive_ts';
const RATE_LIMIT_WINDOW   = 3 * 60 * 60 * 1000; // 3 hours between Nova-initiated messages

class ProactiveReplyService {
  private _isFiring = false;

  /**
   * Called when the app comes to the foreground.
   * @param lastUserMessageTimestamp ISO string of the last USER message
   */
  async triggerProactiveCheck(lastUserMessageTimestamp?: string): Promise<void> {
    if (this._isFiring) return;

    if (!lastUserMessageTimestamp) return;

    const lastMsgTime = new Date(lastUserMessageTimestamp).getTime();
    const now = Date.now();
    const gapMs = now - lastMsgTime;

    // Only fire if the user has been silent for at least MIN_GAP_MS
    if (gapMs < MIN_GAP_MS) return;

    // Rate limit: don't fire if we already sent a proactive message recently
    const lastProactiveRaw = await SecureStore.getItemAsync(RATE_LIMIT_KEY);
    if (lastProactiveRaw) {
      const lastProactiveTs = parseInt(lastProactiveRaw, 10);
      if (now - lastProactiveTs < RATE_LIMIT_WINDOW) {
        return; // Still within rate-limit window
      }
    }

    // Randomise within the gap window so it feels organic
    const randomDelay = Math.floor(Math.random() * (MAX_GAP_MS - MIN_GAP_MS));
    if (gapMs < MIN_GAP_MS + randomDelay) return;

    this._isFiring = true;
    try {
      // Mark as fired BEFORE the API call so we don't double-fire on slow connections
      await SecureStore.setItemAsync(RATE_LIMIT_KEY, now.toString());

      const response = await api.post('/chat', {
        message: '[NOVA_PROACTIVE_TRIGGER]',
        is_proactive: true,
      });

      if (response?.data) {
        const reply: string = response.data.reply || '';
        const messages: string[] = response.data.messages || (reply ? [reply] : []);
        const conversationId: string = response.data.conversation_id || '';

        if (messages.length > 0) {
          // Import lazily to avoid circular dependency
          const { useChatStore } = await import('../store/useChatStore');
          const store = useChatStore.getState();
          const now = new Date().toISOString();

          const novaMessages = messages.map((content: string, idx: number) => ({
            id: `${Date.now()}_proactive_${idx}_${Math.random().toString(36).substring(2, 7)}`,
            role: 'assistant' as const,
            content,
            status: 'responded' as const,
            timestamp: now,
          }));

          useChatStore.setState((s: any) => ({
            messages: [...s.messages, ...novaMessages],
            conversationId: conversationId || s.conversationId,
          }));
        }
      }
    } catch (err) {
      console.warn('[ProactiveReply] Failed to trigger proactive message:', err);
      // Reset rate limit on failure so it can retry next foreground
      await SecureStore.deleteItemAsync(RATE_LIMIT_KEY).catch(() => {});
    } finally {
      this._isFiring = false;
    }
  }
}

export const proactiveReplyService = new ProactiveReplyService();
