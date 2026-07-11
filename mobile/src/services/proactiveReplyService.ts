/**
 * Proactive Reply Service (Simulates Nova initiating conversation)
 * 
 * Logic:
 * If the user hasn't sent a message in > 4 hours, and the app comes to the foreground,
 * we can insert a "random" ping from Nova (e.g. "Hey! Been a while, what are you up to?")
 * by simply calling the standard /chat endpoint with a silent trigger payload.
 */

import { api } from './api';
import * as SecureStore from 'expo-secure-store';
import { useChatStore } from '../store/useChatStore';

const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;

class ProactiveReplyService {
  async triggerProactiveCheck(lastMessageTimestamp?: string) {
    if (!lastMessageTimestamp) return;

    const lastMsgTime = new Date(lastMessageTimestamp).getTime();
    const now = Date.now();
    const gapMs = now - lastMsgTime;

    if (gapMs > FOUR_HOURS_MS) {
      // Check if we already sent a proactive message recently to avoid spam
      const lastProactive = await SecureStore.getItemAsync('last_proactive_timestamp');
      if (lastProactive) {
        const lastProactiveTime = parseInt(lastProactive, 10);
        if (now - lastProactiveTime < FOUR_HOURS_MS) {
          return; // Don't send more than one every 4 hours
        }
      }

      try {
        await SecureStore.setItemAsync('last_proactive_timestamp', now.toString());
        
        // Use a silent prompt to trigger Nova to initiate conversation
        const payload = {
          message: "[SYSTEM: The user has just opened the app after a long break. Initiate a casual, warm conversation naturally. Do not mention that they were gone, just say hi and ask what they are up to. KEEP IT SHORT.]",
          language: 'auto'
        };

        const response = await api.post('/chat', payload);
        if (response.data && response.data.reply) {
          // Add the reply to the chat store locally as an assistant message
          const { messages, addMessage } = useChatStore.getState();
          addMessage({
            id: Date.now().toString(),
            text: response.data.reply,
            sender: 'bot',
            timestamp: new Date().toISOString()
          });
        }
      } catch (err) {
        console.warn('[ProactiveReply] Failed to fetch proactive message', err);
      }
    }
  }
}

export const proactiveReplyService = new ProactiveReplyService();
