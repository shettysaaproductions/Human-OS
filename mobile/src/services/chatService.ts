import { api } from './api';

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
  
  getDiagnostics: async () => {
    const response = await api.get('/admin/diagnostics');
    return response.data;
  }
};
