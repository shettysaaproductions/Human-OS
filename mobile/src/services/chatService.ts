import { api } from './api';

export const chatService = {
  sendMessage: async (message: string) => {
    // Calling the endpoint developed in Backend V1
    const response = await api.post('/chat/test', { message });
    return response.data; // { reply, meta }
  }
};
