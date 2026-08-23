import { api } from './api';
import * as SecureStore from 'expo-secure-store';
import { useAuthStore } from '../store/useAuthStore';
import * as Crypto from 'expo-crypto';

export const chatService = {
  getHistory: async (conversationId?: string, limit: number = 50, beforeId?: string) => {
    let url = conversationId ? `/chat?conversation_id=${conversationId}` : '/chat';
    url += (url.includes('?') ? '&' : '?') + `limit=${limit}`;
    if (beforeId) url += `&before_id=${beforeId}`;
    const response = await api.get(url);
    const data = response.data;
    console.log('API messages received:', data?.length);
    console.log('First message:', data?.[0]?.created_at);
    console.log('Last message:', data?.[data?.length - 1]?.created_at);
    return data;
  },

  setReaction: async (messageId: string, reaction: string | null) => {
    const response = await api.post(`/chat/${messageId}/reaction`, { reaction });
    return response.data;
  },

  // Read receipt: called when the user opens/foregrounds the chat. Tells the backend
  // "Nova's pending messages are now SEEN", which feeds `unreadNovaMessages` into the
  // situation brief so Nova can distinguish "left on read" from "never saw it".
  markMessagesRead: async (): Promise<void> => {
    try {
      await api.post('/chat/read', {});
    } catch (e) {
      // Non-fatal — if this fails, Nova simply won't get the seen signal this time.
    }
  },

  sendMessage: async (message: string, conversationId?: string, clientMessageId?: string) => {
    const payload: any = { message };
    if (conversationId) payload.conversation_id = conversationId;
    if (clientMessageId) payload.client_message_id = clientMessageId;
    else payload.client_message_id = Crypto.randomUUID();
    const response = await api.post('/chat', payload);
    return response.data;
  },

  async sendMessageAsync(messages: { message: string, reply_to_id?: string, reply_to_content?: string, image_base64?: string, client_message_id?: string }[], conversationId?: string): Promise<{ conversation_id: string, user_message_id?: string } | null> {
    // Fill in default IDs for any message missing one (to match backend fallback)
    const formattedMessages = messages.map(m => ({
      ...m,
      client_message_id: m.client_message_id || Crypto.randomUUID()
    }));

    const payload: any = { messages: formattedMessages, async_mode: true };
    if (conversationId) payload.conversation_id = conversationId;

    // We use the native fetch API with keepalive: true so that the OS
    // completes the HTTP request even if the JS thread is suspended immediately after.
    const url = `${api.defaults.baseURL}/chat`;

    // 30-second hard timeout — on Android, battery optimization can suspend the JS
    // thread mid-await, causing it to hang indefinitely with no error.
    // We race the request against a timer so the retry loop always gets control back.
    const doSend = async (authToken: string | null): Promise<Response> => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);
      try {
        return await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(authToken ? { 'Authorization': `Bearer ${authToken}` } : {})
          },
          body: JSON.stringify(payload),
          signal: controller.signal,
          // Let the OS complete the HTTP request even if the JS thread is suspended right
          // after — without keepalive the fetch is aborted the moment the app backgrounds.
          keepalive: true,
        });
      } finally {
        clearTimeout(timeoutId);
      }
    };

    let token = await SecureStore.getItemAsync('accessToken');
    let response = await doSend(token);

    // Expired token (401) — silently refresh once, then retry once. Without this the
    // request would keep 401ing (or loop forever, see the 4xx branch below).
    if (response.status === 401) {
      const fresh = await useAuthStore.getState().refreshSession();
      if (fresh) {
        token = fresh;
        response = await doSend(fresh);
      }
    }

    if (!response.ok) {
      // Attach status so the caller can distinguish a real 4xx (permanent) from a
      // transient network error instead of retrying a doomed request forever.
      const err: any = new Error(`HTTP ${response.status}`);
      err.status = response.status;
      err.response = { status: response.status };
      throw err;
    }

    return await response.json();
  },

  streamMessage: (
    message: string,
    conversationId: string | undefined,
    onSetup: (convId: string) => void,
    onChunk: (chunk: string) => void,
    onDone: () => void,
    onError: (error: string) => void,
    clientMessageId?: string
  ): Promise<void> => {
    return new Promise(async (resolve, reject) => {
      let settled = false;
      const controller = new AbortController();

      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        fn();
      };

      // 45-second hard timeout
      const timeout = setTimeout(() => {
        controller.abort();
        settle(() => reject(new Error('Request timed out')));
      }, 45000);

      try {
        const token = await SecureStore.getItemAsync('accessToken');
        const payload: any = { message };
        if (conversationId) payload.conversation_id = conversationId;
        if (clientMessageId) payload.client_message_id = clientMessageId;
        else payload.client_message_id = crypto.randomUUID();

        const url = `${api.defaults.baseURL}/chat`;
        console.log('[STREAM] Connecting to:', url);

        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream',
        };
        if (token) headers['Authorization'] = `Bearer ${token}`;

        const response = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
          signal: controller.signal,
        });

        console.log('[STREAM] Response status:', response.status);

        if (!response.ok) {
          const text = await response.text().catch(() => '');
          settle(() => reject(new Error(`HTTP ${response.status}: ${text}`)));
          return;
        }

        const reader = response.body?.getReader();
        if (!reader) {
          settle(() => reject(new Error('No response body')));
          return;
        }

        const decoder = new TextDecoder();
        let buffer = '';

        const processLine = (line: string) => {
          if (!line.startsWith('data: ')) return;
          const jsonStr = line.slice(6).trim();
          if (!jsonStr) return;
          try {
            const data = JSON.parse(jsonStr);
            if (data.type === 'setup') {
              onSetup(data.conversation_id);
            } else if (data.type === 'chunk') {
              onChunk(data.content);
            } else if (data.type === 'done') {
              onDone();
              settle(() => resolve());
            } else if (data.type === 'error') {
              settle(() => reject(new Error(data.error || 'Server error')));
            }
          } catch (e) {
            console.error('[STREAM] Parse error on line:', line, e);
          }
        };

        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            if (buffer.trim()) {
              buffer.split('\n').forEach(processLine);
            }
            // Stream ended — resolve if not already settled (handles proxies that drop 'done')
            settle(() => { onDone(); resolve(); });
            break;
          }
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';
          lines.forEach(processLine);
        }
      } catch (err: any) {
        if (err?.name === 'AbortError') {
          settle(() => reject(new Error('Request timed out')));
        } else {
          console.error('[STREAM] Fetch error:', err);
          settle(() => reject(err));
        }
      }
    });
  },

  getDiagnostics: async () => {
    const response = await api.get('/admin/diagnostics');
    return response.data;
  },

  registerPushToken: async (token: string) => {
    const response = await api.post('/auth/push-token', { token });
    return response.data;
  },

  // Presence heartbeat — call every 30s while ChatScreen is focused to keep presence fresh
  updatePresence: async (status: 'online' | 'away' | 'offline') => {
    try {
      const { useAuthStore } = await import('../store/useAuthStore');
      const userId = useAuthStore.getState().user?.id;
      if (!userId) return;
      await api.post('/presence', { userId, status, timestamp: new Date().toISOString() });
    } catch (_e) {
      // Non-fatal: presence heartbeat failure should never block chat
    }
  },
};
