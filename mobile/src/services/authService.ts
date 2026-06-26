import { api } from './api';

export const authService = {
  signup: async (email: string, password: string) => {
    const response = await api.post('/auth/signup', { email, password });
    return response.data; // { access_token, user }
  },
  
  login: async (email: string, password: string) => {
    const response = await api.post('/auth/login', { email, password });
    return response.data; // { access_token, user }
  },

  getMe: async () => {
    const response = await api.get('/auth/me');
    return response.data; // { user }
  }
};
