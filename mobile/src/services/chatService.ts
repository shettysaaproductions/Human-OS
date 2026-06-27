import { api } from './api';

export const chatService = {
  getHistory: async (conversationId?: string) => {
    const url = conversationId ? `/chat?conversation_id=${conversationId}` : '/chat';
    const response = await api.get(url);
    return response.data; // array of { id, role, content, created_at, conversation_id }
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
