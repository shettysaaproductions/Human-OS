import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import { authService } from '../services/authService';
import { notificationService } from '../services/notificationService';

interface AuthState {
  user: any | null;
  accessToken: string | null;
  isLoading: boolean;
  onboardingStatus: boolean;

  hydrate: () => Promise<void>;
  login: (accessToken: string | null, refreshToken: string | null, user: any) => Promise<void>;
  logout: () => Promise<void>;
  setOnboardingStatus: (status: boolean) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  accessToken: null,
  isLoading: true,
  onboardingStatus: false,

  /**
   * Called once on app start. Strategy:
   * 1. Read stored accessToken and try /auth/me (fast path — token still valid).
   * 2. If that 401s, read the refreshToken and call /auth/refresh to get a new pair.
   * 3. If refresh also fails, clear everything → navigates to Login.
   */
  hydrate: async () => {
    try {
      set({ isLoading: true });

      const accessToken = await SecureStore.getItemAsync('accessToken');
      const refreshToken = await SecureStore.getItemAsync('refreshToken');

      if (!accessToken && !refreshToken) {
        // Nothing stored — first launch or after logout
        set({ isLoading: false });
        return;
      }

      if (accessToken) {
        try {
          // Fast path: existing token is still valid
          const user = await authService.getMe();
          set({ accessToken, user, onboardingStatus: user.onboardingCompleted || false, isLoading: false });
          notificationService.registerAfterAuth().catch(() => {});
          return;
        } catch {
          // Token expired — fall through to refresh
        }
      }

      if (refreshToken) {
        try {
          // Slow path: silent refresh
          const data = await authService.refresh(refreshToken);
          await SecureStore.setItemAsync('accessToken', data.access_token);
          await SecureStore.setItemAsync('refreshToken', data.refresh_token);
          set({ accessToken: data.access_token, user: data.user, onboardingStatus: data.user?.onboardingCompleted || false, isLoading: false });
          notificationService.registerAfterAuth().catch(() => {});
          return;
        } catch {
          // Refresh token also expired — force re-login
          console.warn('[AuthStore] Refresh token expired, clearing session.');
        }
      }

      // All tokens invalid — wipe and go to login
      await SecureStore.deleteItemAsync('accessToken');
      await SecureStore.deleteItemAsync('refreshToken');
      set({ accessToken: null, user: null, isLoading: false });
    } catch (error) {
      console.error('[AuthStore] hydrate failed', error);
      set({ isLoading: false });
    }
  },

  /**
   * Called after login or signup. Saves both tokens to SecureStore.
   */
  login: async (accessToken: string | null, refreshToken: string | null, user: any) => {
    if (accessToken) {
      await SecureStore.setItemAsync('accessToken', accessToken);
    }
    if (refreshToken) {
      await SecureStore.setItemAsync('refreshToken', refreshToken);
    }
    set({ accessToken, user, onboardingStatus: user?.onboardingCompleted || false });
    notificationService.registerAfterAuth().catch(() => {});
  },

  logout: async () => {
    await SecureStore.deleteItemAsync('accessToken');
    await SecureStore.deleteItemAsync('refreshToken');
    set({ accessToken: null, user: null, onboardingStatus: false });
  },

  setOnboardingStatus: (status: boolean) => {
    set({ onboardingStatus: status });
  },
}));
