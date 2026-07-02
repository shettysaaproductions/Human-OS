import axios from 'axios';
import * as SecureStore from 'expo-secure-store';

// ── Base URL ───────────────────────────────────────────────────────────────────
export const BASE_URL = process.env.EXPO_PUBLIC_API_URL || 'https://human-os-zitw.onrender.com';

export const api = axios.create({
  baseURL: BASE_URL,
  timeout: 60000, // 60s timeout — wait for cold boot if needed
  headers: {
    'Content-Type': 'application/json',
  },
});

// ── Retry on network errors (not auth errors) ─────────────────────────────────
const MAX_RETRIES = 2;
async function withRetry(fn: () => Promise<any>, retries = MAX_RETRIES): Promise<any> {
  try {
    return await fn();
  } catch (err: any) {
    const isNetworkError = !err.response && err.code !== 'ECONNABORTED';
    if (isNetworkError && retries > 0) {
      const delay = (MAX_RETRIES - retries + 1) * 1000;
      await new Promise(r => setTimeout(r, delay));
      return withRetry(fn, retries - 1);
    }
    throw err;
  }
}

// ── Request interceptor: attach the current access token ─────────────────────
api.interceptors.request.use(
  async (config) => {
    try {
      const token = await SecureStore.getItemAsync('accessToken');
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
      
      console.log(`[API REQUEST] ${config.method?.toUpperCase()} ${config.url}`);
      console.log(`[API HEADERS]`, JSON.stringify(config.headers));
      if (config.data) console.log(`[API PAYLOAD]`, JSON.stringify(config.data));
      
    } catch (error) {
      console.error('[api] Error reading accessToken from SecureStore', error);
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// ── Response interceptor: on 401, try to refresh once then retry ──────────────
let isRefreshing = false;
let pendingQueue: Array<{ resolve: (token: string) => void; reject: (err: any) => void }> = [];

function drainQueue(error: any, token: string | null) {
  pendingQueue.forEach((p) => (token ? p.resolve(token) : p.reject(error)));
  pendingQueue = [];
}

api.interceptors.response.use(
  (response) => {
    console.log(`[API RESPONSE] ${response.status} ${response.config.url}`);
    console.log(`[API BODY]`, JSON.stringify(response.data));
    return response;
  },
  async (error) => {
    const originalRequest = error.config;
    
    // 1. Log specific failure details
    if (error.code === 'ECONNABORTED') {
      console.warn(`[api] Request to ${originalRequest?.url} timed out (timeout: ${originalRequest?.timeout || 60000}ms). This is likely a Render cold boot.`);
    } else if (!error.response) {
      console.warn(`[api] Network error or DNS lookup failure for request to ${originalRequest?.url}. Device might be offline.`);
    } else {
      console.log(`[API RESPONSE ERROR] ${error.response.status} ${originalRequest?.url}`);
      console.log(`[API RESPONSE BODY]`, JSON.stringify(error.response.data));
      if (error.response.status >= 500) {
        console.warn(`[api] Server error (HTTP ${error.response.status}) on request to ${originalRequest?.url}`);
      }
    }

    // 2. Auto-retry on network errors or timeouts (max 2 retries)
    const isTimeout = error.code === 'ECONNABORTED';
    const isNetworkErr = !error.response;
    if ((isTimeout || isNetworkErr) && (!originalRequest._retryCount || originalRequest._retryCount < 2)) {
      originalRequest._retryCount = (originalRequest._retryCount || 0) + 1;
      const delay = originalRequest._retryCount * 2000; // Exponential backoff (2s, 4s)
      console.warn(`[api] Retrying request to ${originalRequest?.url} (Attempt ${originalRequest._retryCount}/2) in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
      return api(originalRequest);
    }

    // Only attempt token refresh on 401 for protected routes.
    // NEVER intercept /auth/ or /onboarding/ endpoints:
    // - /auth/ doesn't use bearer tokens
    // - /onboarding/ uses fresh tokens from signup; intercepting causes crashes
    if (
      error.response?.status !== 401 ||
      originalRequest._retried ||
      originalRequest.url?.includes('/auth/') ||
      originalRequest.url?.includes('/onboarding')
    ) {
      return Promise.reject(error);
    }

    // If a refresh is already in flight, queue this request
    if (isRefreshing) {
      return new Promise((resolve, reject) => {
        pendingQueue.push({
          resolve: (token) => {
            originalRequest.headers.Authorization = `Bearer ${token}`;
            resolve(api(originalRequest));
          },
          reject,
        });
      });
    }

    originalRequest._retried = true;
    isRefreshing = true;

    try {
      const refreshToken = await SecureStore.getItemAsync('refreshToken');
      if (!refreshToken) {
        throw new Error('No refresh token stored — user must log in again.');
      }

      // Call the backend refresh endpoint (no Authorization header needed)
      const { data } = await axios.post(`${BASE_URL}/auth/refresh`, {
        refresh_token: refreshToken,
      });

      const newAccessToken: string = data.access_token;
      const newRefreshToken: string = data.refresh_token;

      // Persist the new tokens
      await SecureStore.setItemAsync('accessToken', newAccessToken);
      await SecureStore.setItemAsync('refreshToken', newRefreshToken);

      // Update the default header so subsequent requests use the new token
      api.defaults.headers.common['Authorization'] = `Bearer ${newAccessToken}`;

      drainQueue(null, newAccessToken);

      // Retry the original failed request with the new token
      originalRequest.headers.Authorization = `Bearer ${newAccessToken}`;
      return api(originalRequest);
    } catch (refreshError) {
      drainQueue(refreshError, null);

      // Refresh failed — wipe stored tokens.
      // We delete from SecureStore but do NOT call useAuthStore here
      // (circular dependency risk). The next hydrate() call will see no
      // tokens and navigate to Login automatically.
      try {
        await SecureStore.deleteItemAsync('accessToken');
        await SecureStore.deleteItemAsync('refreshToken');
        await SecureStore.deleteItemAsync('onboardingCompleted');
      } catch {
        // SecureStore delete failures are non-fatal
      }

      console.error('[api] Token refresh failed — clearing session.', refreshError);
      return Promise.reject(refreshError);
    } finally {
      isRefreshing = false;
    }
  }
);
