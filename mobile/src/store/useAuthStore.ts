import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import { authService } from '../services/authService';

interface AuthState {
  user: any | null;
  accessToken: string | null;
  isLoading: boolean;
  onboardingStatus: boolean;
  
  hydrate: () => Promise<void>;
  login: (token: string, user: any) => Promise<void>;
  logout: () => Promise<void>;
  setOnboardingStatus: (status: boolean) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  accessToken: null,
  isLoading: true,
  onboardingStatus: false,

  hydrate: async () => {
    try {
      set({ isLoading: true });
      const token = await SecureStore.getItemAsync('accessToken');
      
      if (token) {
        // Try to fetch the user to verify token is valid
        // Important: api interceptor will attach this token automatically
        try {
          const { user } = await authService.getMe();
          set({ accessToken: token, user, isLoading: false });
        } catch (error) {
          // Token is likely invalid or expired
          await SecureStore.deleteItemAsync('accessToken');
          set({ accessToken: null, user: null, isLoading: false });
        }
      } else {
        set({ isLoading: false });
      }
    } catch (error) {
      console.error('Failed to hydrate auth store', error);
      set({ isLoading: false });
    }
  },

  login: async (token: string | null, user: any) => {
    if (token) {
      await SecureStore.setItemAsync('accessToken', token);
    }
    set({ accessToken: token, user });
  },

  logout: async () => {
    await SecureStore.deleteItemAsync('accessToken');
    set({ accessToken: null, user: null, onboardingStatus: false });
  },

  setOnboardingStatus: (status: boolean) => {
    set({ onboardingStatus: status });
  }
}));
