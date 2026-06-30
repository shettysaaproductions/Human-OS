import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import { authService } from '../services/authService';
import { setUserContext } from '../services/logger';

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
      const accessToken = await SecureStore.getItemAsync('accessToken');
      const refreshToken = await SecureStore.getItemAsync('refreshToken');
      const userStr = await SecureStore.getItemAsync('user');

      if (!accessToken && !refreshToken) {
        // Nothing stored — first launch or after logout
        set({ isLoading: false });
        return;
      }

      if (accessToken) {
        // Fast path: unblock UI immediately with cached user state
        let cachedUser = null;
        if (userStr) {
          try { cachedUser = JSON.parse(userStr); } catch {}
        }
        
        set({ 
          accessToken, 
          user: cachedUser, 
          onboardingStatus: cachedUser?.onboardingCompleted || false, 
          isLoading: false 
        });
        setUserContext(cachedUser);

        // Background sync to verify token and update user state
        authService.getMe().then(async (fetchedUser) => {
          await SecureStore.setItemAsync('user', JSON.stringify(fetchedUser));
          set({ user: fetchedUser, onboardingStatus: fetchedUser.onboardingCompleted || false });
          setUserContext(fetchedUser);
        }).catch(async () => {
          // Token expired, attempt background refresh
          if (refreshToken) {
            try {
              const data = await authService.refresh(refreshToken);
              await SecureStore.setItemAsync('accessToken', data.access_token);
              await SecureStore.setItemAsync('refreshToken', data.refresh_token);
              await SecureStore.setItemAsync('user', JSON.stringify(data.user));
              set({ accessToken: data.access_token, user: data.user, onboardingStatus: data.user?.onboardingCompleted || false });
              setUserContext(data.user);
            } catch {
              await SecureStore.deleteItemAsync('accessToken');
              await SecureStore.deleteItemAsync('refreshToken');
              await SecureStore.deleteItemAsync('user');
              set({ accessToken: null, user: null, onboardingStatus: false });
              setUserContext(null);
            }
          } else {
            await SecureStore.deleteItemAsync('accessToken');
            await SecureStore.deleteItemAsync('user');
            set({ accessToken: null, user: null, onboardingStatus: false });
            setUserContext(null);
          }
        });
        
        return;
      }

      if (refreshToken) {
        try {
          // Slow path: silent refresh
          const data = await authService.refresh(refreshToken);
          await SecureStore.setItemAsync('accessToken', data.access_token);
          await SecureStore.setItemAsync('refreshToken', data.refresh_token);
          await SecureStore.setItemAsync('user', JSON.stringify(data.user));
          set({ accessToken: data.access_token, user: data.user, onboardingStatus: data.user?.onboardingCompleted || false, isLoading: false });
          setUserContext(data.user);
          return;
        } catch {
          // Refresh token also expired — force re-login
          console.warn('[AuthStore] Refresh token expired, clearing session.');
        }
      }

      // All tokens invalid — wipe and go to login
      await SecureStore.deleteItemAsync('accessToken');
      await SecureStore.deleteItemAsync('refreshToken');
      await SecureStore.deleteItemAsync('user');
      set({ accessToken: null, user: null, isLoading: false });
      setUserContext(null);
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
    if (user) {
      await SecureStore.setItemAsync('user', JSON.stringify(user));
    }
    set({ accessToken, user, onboardingStatus: user?.onboardingCompleted || false });
    setUserContext(user);
  },

  logout: async () => {
    await SecureStore.deleteItemAsync('accessToken');
    await SecureStore.deleteItemAsync('refreshToken');
    await SecureStore.deleteItemAsync('user');
    set({ accessToken: null, user: null, onboardingStatus: false });
    setUserContext(null);
  },

  setOnboardingStatus: (status: boolean) => {
    set({ onboardingStatus: status });
  },
}));
