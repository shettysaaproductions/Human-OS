import { api } from './api';
import * as SecureStore from 'expo-secure-store';

export const chatService = {
  getHistory: async (conversationId?: string, limit: number = 50, beforeId?: string) => {
    let url = conversationId ? `/chat?conversation_id=${conversationId}` : '/chat';
    url += (url.includes('?') ? '&' : '?') + `limit=${limit}`;
    if (beforeId) url += `&before_id=${beforeId}`;
    const response = await api.get(url);
    const data = response.data;
    console.log('API messages received:', data?.length);
    console.log('First message:', data[0]?.created_at);
    console.log('Last message:', data[data?.length - 1]?.created_at);
    return data;
  },

  setReaction: async (messageId: string, reaction: string | null) => {
    const response = await api.post(`/chat/${messageId}/reaction`, { reaction });
    return response.data;
  },

  sendMessage: async (message: string, conversationId?: string) => {
    const payload: any = { message };
    if (conversationId) payload.conversation_id = conversationId;
    const response = await api.post('/chat', payload);
    return response.data;
  },

  sendMessageAsync: async (message: string, conversationId?: string, replyToId?: string, replyToContent?: string) => {
    const payload: any = { message, async_mode: true };
    if (conversationId) payload.conversation_id = conversationId;
    if (replyToId) payload.reply_to_id = replyToId;
    if (replyToContent) payload.reply_to_content = replyToContent;

    // We use the native fetch API with keepalive: true so that the OS
    // completes the HTTP request even if the JS thread is suspended immediately after.
    const token = await SecureStore.getItemAsync('accessToken');
    const url = `${api.defaults.baseURL}/chat`;
    
    // 30-second hard timeout — on Android, battery optimization can suspend the JS
    // thread mid-await, causing it to hang indefinitely with no error.
    // We race the request against a timer so the retry loop always gets control back.
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);
    
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify(payload),
        keepalive: true, // Crucial for background completion
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      return data;
    } finally {
      clearTimeout(timeoutId);
    }
  },

  streamMessage: (
    message: string,
    conversationId: string | undefined,
    onSetup: (convId: string) => void,
    onChunk: (chunk: string) => void,
    onDone: () => void,
    onError: (error: string) => void
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
};
