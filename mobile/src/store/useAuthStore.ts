import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import { authService } from '../services/authService';

// Key for persisting onboarding status locally — survives offline/network errors
const ONBOARDING_KEY = 'onboardingCompleted';

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
   * Called once on app start.
   *
   * FAST PATH (< 5ms, no network):
   *   Read accessToken + onboardingStatus from SecureStore.
   *   If both exist → show Chat immediately, no spinner.
   *
   * BACKGROUND (after UI is shown):
   *   Try /auth/me to refresh user profile.
   *   On network error → keep session, don't log out.
   *   Only a real 401/403 from the server triggers logout.
   */
  hydrate: async () => {
    try {
      set({ isLoading: true });

      // ── STEP 1: Read all local data in parallel (zero network, ~1-2ms) ──────
      const [accessToken, refreshToken, savedOnboarding] = await Promise.all([
        SecureStore.getItemAsync('accessToken'),
        SecureStore.getItemAsync('refreshToken'),
        SecureStore.getItemAsync(ONBOARDING_KEY),
      ]);

      const cachedOnboardingStatus = savedOnboarding === 'true';

      if (!accessToken && !refreshToken) {
        // First launch or after logout
        set({ isLoading: false, onboardingStatus: false });
        return;
      }

      // ── STEP 2: Unblock the UI immediately with cached data ──────────────────
      // User sees Chat instantly — no spinner — even before network responds.
      if (accessToken) {
        set({
          accessToken,
          onboardingStatus: cachedOnboardingStatus,
          isLoading: false, // ← UI unblocks HERE
          user: null, // will be filled by background /auth/me call
        });
      }

      // ── STEP 3: Background refresh of user profile ───────────────────────────
      if (accessToken) {
        try {
          const user = await authService.getMe();
          // Update onboarding from server (source of truth) and persist locally
          const serverOnboarding = user.onboardingCompleted || false;
          await SecureStore.setItemAsync(ONBOARDING_KEY, String(serverOnboarding));
          set({ user, onboardingStatus: serverOnboarding });
          return;
        } catch (err: any) {
          const isNetworkError = !err?.response;
          const isAuthError = err?.response?.status === 401 || err?.response?.status === 403;

          if (isNetworkError) {
            // Backend offline — keep cached session, UI already unblocked
            console.warn('[AuthStore] Backend offline. Using cached session.');
            return;
          }

          if (!isAuthError) {
            // 5xx or other server error — keep cached session
            console.warn('[AuthStore] Server error during /auth/me. Keeping cached session.');
            return;
          }

          // Real 401/403 — token is invalid. Try refresh.
        }
      }

      // ── STEP 4: Silent token refresh (only if token is confirmed invalid) ────
      if (refreshToken) {
        try {
          const data = await authService.refresh(refreshToken);
          await SecureStore.setItemAsync('accessToken', data.access_token);
          await SecureStore.setItemAsync('refreshToken', data.refresh_token);
          const serverOnboarding = data.user?.onboardingCompleted || false;
          await SecureStore.setItemAsync(ONBOARDING_KEY, String(serverOnboarding));
          set({
            accessToken: data.access_token,
            user: data.user,
            onboardingStatus: serverOnboarding,
          });
          return;
        } catch (err: any) {
          const isNetworkError = !err?.response;
          if (isNetworkError) {
            console.warn('[AuthStore] Backend offline during refresh. Keeping cached session.');
            return;
          }
          // Real 401 from refresh — tokens expired
          console.warn('[AuthStore] Refresh token expired. Logging out.');
        }
      }

      // ── STEP 5: All tokens confirmed invalid by server → force logout ─────────
      await SecureStore.deleteItemAsync('accessToken');
      await SecureStore.deleteItemAsync('refreshToken');
      await SecureStore.deleteItemAsync(ONBOARDING_KEY);
      set({ accessToken: null, user: null, onboardingStatus: false, isLoading: false });

    } catch (error) {
      console.error('[AuthStore] hydrate failed', error);
      // Never lock the user out due to an unexpected error
      set({ isLoading: false });
    }
  },

  login: async (accessToken: string | null, refreshToken: string | null, user: any) => {
    if (accessToken) await SecureStore.setItemAsync('accessToken', accessToken);
    if (refreshToken) await SecureStore.setItemAsync('refreshToken', refreshToken);
    const onboarding = user?.onboardingCompleted || false;
    await SecureStore.setItemAsync(ONBOARDING_KEY, String(onboarding));
    set({ accessToken, user, onboardingStatus: onboarding });
  },

  logout: async () => {
    await SecureStore.deleteItemAsync('accessToken');
    await SecureStore.deleteItemAsync('refreshToken');
    await SecureStore.deleteItemAsync(ONBOARDING_KEY);
    set({ accessToken: null, user: null, onboardingStatus: false });
  },

  setOnboardingStatus: (status: boolean) => {
    // Persist immediately so it survives offline restarts
    SecureStore.setItemAsync(ONBOARDING_KEY, String(status)).catch(() => {});
    set({ onboardingStatus: status });
  },
}));
