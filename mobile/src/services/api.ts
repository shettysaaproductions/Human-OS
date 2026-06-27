import axios from 'axios';
import * as SecureStore from 'expo-secure-store';

// ── Base URL ───────────────────────────────────────────────────────────────────
const BASE_URL = process.env.EXPO_PUBLIC_API_URL || 'https://human-os-zitw.onrender.com';

export const api = axios.create({
  baseURL: BASE_URL,
  timeout: 15000, // 15s timeout — fail fast on slow connections
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
    
    if (error.response) {
      console.log(`[API RESPONSE ERROR] ${error.response.status} ${originalRequest?.url}`);
      console.log(`[API RESPONSE BODY]`, JSON.stringify(error.response.data));
    } else {
      console.log(`[API NETWORK ERROR]`, error.message);
    }

    // Only attempt token refresh on 401 for protected routes.
    // NEVER intercept /auth/ endpoints (login, signup, refresh) — they don't
    // use bearer tokens and intercepting them causes "No refresh token" errors
    // to mask the real failure (bad credentials, cold backend, etc.).
    if (
      error.response?.status !== 401 ||
      originalRequest._retried ||
      originalRequest.url?.includes('/auth/')
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

      // Refresh failed — wipe stored tokens so the app navigates to login
      await SecureStore.deleteItemAsync('accessToken');
      await SecureStore.deleteItemAsync('refreshToken');

      console.error('[api] Token refresh failed — user must re-authenticate.', refreshError);
      return Promise.reject(refreshError);
    } finally {
      isRefreshing = false;
    }
  }
);
