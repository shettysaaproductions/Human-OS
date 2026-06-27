import { api } from './api';

export const authService = {
  signup: async (email: string, password: string) => {
    const response = await api.post('/auth/signup', { email, password });
    return response.data; // { access_token, refresh_token, user }
  },

  login: async (email: string, password: string) => {
    const response = await api.post('/auth/login', { email, password });
    return response.data; // { access_token, refresh_token, user }
  },

  /**
   * Exchange a stored refresh_token for a new access_token + refresh_token pair.
   * This is called by the axios 401 interceptor and by store hydration.
   */
  refresh: async (refreshToken: string) => {
    const response = await api.post('/auth/refresh', { refresh_token: refreshToken });
    return response.data; // { access_token, refresh_token, user }
  },

  getMe: async () => {
    const response = await api.get('/auth/me');
    return response.data; // { id, email }
  }
};
