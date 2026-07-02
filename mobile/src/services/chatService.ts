import { api, BASE_URL } from './api';
import EventSource from 'react-native-sse';
import * as SecureStore from 'expo-secure-store';

export const chatService = {
  getHistory: async (conversationId?: string) => {
    const url = conversationId ? `/chat?conversation_id=${conversationId}` : '/chat';
    const response = await api.get(url);
    const data = response.data;
    // Guard: if the backend returns null/undefined or a non-array, treat as empty history
    if (!Array.isArray(data)) {
      console.warn('[chatService] getHistory received non-array response:', data);
      return [];
    }
    console.log("API messages received:", data.length);
    console.log("First message:", data[0]?.created_at);
    console.log("Last message:", data[data.length - 1]?.created_at);
    return data; // array of { id, role, content, created_at, conversation_id }
  },

  sendMessage: async (message: string, conversationId?: string) => {
    const payload: any = { message };
    if (conversationId) payload.conversation_id = conversationId;

    const response = await api.post('/chat', payload);
    return response.data; // { reply, conversation_id, meta }
  },
  
  streamMessage: async (
    message: string, 
    conversationId?: string,
    callbacks?: {
      onStart?: (data: any) => void;
      onChunk?: (text: string) => void;
      onDone?: (data: any) => void;
      onError?: (error: any) => void;
    }
  ): Promise<any> => {
    return new Promise(async (resolve, reject) => {
      try {
        const payload: any = { message };
        if (conversationId) payload.conversation_id = conversationId;

        const token = await SecureStore.getItemAsync('accessToken');
        const es = new EventSource(`${BASE_URL}/chat/stream`, {
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { 'Authorization': `Bearer ${token}` } : {})
          },
          method: 'POST',
          body: JSON.stringify(payload),
        });

        let fullReply = '';
        let activeConversationId = conversationId;

        es.addEventListener('start' as any, (event: any) => {
          if (event.data) {
            try {
              const data = JSON.parse(event.data);
              activeConversationId = data.conversation_id;
              if (callbacks?.onStart) callbacks.onStart(data);
            } catch (e) {}
          }
        });

        es.addEventListener('chunk' as any, (event: any) => {
          if (event.data) {
            try {
              const data = JSON.parse(event.data);
              if (data.content) {
                fullReply += data.content;
                if (callbacks?.onChunk) callbacks.onChunk(data.content);
              }
            } catch (e) {}
          }
        });

        es.addEventListener('first_token' as any, (event: any) => {
            // Can be used for metrics later
        });

        es.addEventListener('done' as any, (event: any) => {
          es.close();
          const meta = event.data ? JSON.parse(event.data) : {};
          if (callbacks?.onDone) callbacks.onDone(meta);
          resolve({ reply: fullReply, conversation_id: activeConversationId, meta });
        });

        es.addEventListener('error', (event: any) => {
          es.close();
          if (callbacks?.onError) callbacks.onError(event);
          reject(new Error(event.message || 'SSE Error'));
        });
      } catch (err) {
        reject(err);
      }
    });
  },

  getDiagnostics: async () => {
    const response = await api.get('/admin/diagnostics');
    return response.data;
  }
};
