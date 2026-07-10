import { api } from './api';

export const chatService = {
  getHistory: async (conversationId?: string, limit: number = 50, beforeId?: string) => {
    let url = conversationId ? `/chat?conversation_id=${conversationId}` : '/chat';
    url += (url.includes('?') ? '&' : '?') + `limit=${limit}`;
    if (beforeId) url += `&before_id=${beforeId}`;
    const response = await api.get(url);
    const data = response.data;
    console.log("API messages received:", data?.length);
    console.log("First message:", data[0]?.created_at);
    console.log("Last message:", data[data?.length - 1]?.created_at);
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
    conversationId: string | undefined,
    onSetup: (convId: string) => void,
    onChunk: (chunk: string) => void,
    onDone: () => void,
    onError: (error: string) => void
  ) => {
    const { default: EventSource } = await import('react-native-sse');
    const SecureStore = await import('expo-secure-store');
    
    const token = await SecureStore.getItemAsync('accessToken');
    const payload: any = { message };
    if (conversationId) payload.conversation_id = conversationId;

    const url = (process.env.EXPO_PUBLIC_API_URL || 'https://human-os-zitw.onrender.com') + '/api/chat';
    
    const es = new EventSource(url, {
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
      },
      method: 'POST',
      body: JSON.stringify(payload)
    });

    es.addEventListener('message', (event: any) => {
      if (event.data) {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'setup') {
            onSetup(data.conversation_id);
          } else if (data.type === 'chunk') {
            onChunk(data.content);
          } else if (data.type === 'done') {
            es.close();
            onDone();
          } else if (data.type === 'error') {
            es.close();
            onError(data.error || 'Server error');
          }
        } catch (e) {
          console.error("Failed to parse SSE data", e);
        }
      }
    });

    es.addEventListener('error', (event: any) => {
      console.error('SSE Error:', event);
      if (event.type === 'error') {
        es.close();
        onError(event.message || 'Network error');
      }
    });

    return () => {
      es.close();
    };
  },
  
  getDiagnostics: async () => {
    const response = await api.get('/admin/diagnostics');
    return response.data;
  }
};
