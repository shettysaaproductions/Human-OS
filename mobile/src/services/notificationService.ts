/**
 * notificationService.ts
 *
 * Handles all push notification logic.
 * IMPORTANT: Call initialize() on app start (channels only — no token).
 * Call registerAfterAuth() AFTER the user successfully logs in and the
 * auth token is set in axios headers. This avoids the race condition where
 * the push token API call fails because auth headers aren't set yet.
 *
 * Token refresh:
 * Android/Google periodically rotates FCM tokens. We listen for rotations
 * via addPushTokenListener() and immediately re-register the new token with
 * the backend. Without this, the DB holds a stale token and all background
 * notifications silently fail.
 */

import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { chatService } from './chatService';

// ── Show notifications even when the app is open (foreground) ─────────────────
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

class NotificationService {
  private _pushToken: string | null = null;
  private _registered = false;
  private _tokenListener: Notifications.EventSubscription | null = null;

  get pushToken(): string | null {
    return this._pushToken;
  }

  /**
   * Call once on app startup. Creates Android channels only — no token fetch.
   * Safe to call before auth is complete.
   */
  async initialize(): Promise<void> {
    try {
      await this._createAndroidChannels();
    } catch (err) {
      console.warn('[Notifications] Channel setup failed (non-critical):', err);
    }
  }

  /**
   * Call this AFTER the user is authenticated and the axios auth header is set.
   * Always re-registers the token — handles force-close + fresh open cases.
   * Safe to call multiple times.
   *
   * Also sets up a persistent listener so if Android/Google rotates the FCM
   * token, we immediately re-register the new token with the backend.
   */
  async registerAfterAuth(): Promise<void> {
    try {
      await this._requestPermissionAndRegister();
      this._startTokenRefreshListener();
    } catch (err) {
      console.warn('[Notifications] registerAfterAuth failed (non-critical):', err);
    }
  }

  /**
   * Clean up the token rotation listener.
   * Call this on logout to avoid re-registering a stale auth session.
   */
  cleanup(): void {
    if (this._tokenListener) {
      this._tokenListener.remove();
      this._tokenListener = null;
    }
    this._registered = false;
  }

  // ── Private ──────────────────────────────────────────────────────────────────

  /**
   * Listen for FCM token rotations (Android rotates these periodically).
   * When a new token is issued, immediately re-register with the backend so
   * the DB never holds a stale token.
   */
  private _startTokenRefreshListener(): void {
    // Remove existing listener before adding a new one (avoid duplicates on re-auth)
    if (this._tokenListener) {
      this._tokenListener.remove();
    }

    this._tokenListener = Notifications.addPushTokenListener(async (tokenData) => {
      const newToken = tokenData.data;
      if (!newToken || newToken === this._pushToken) return;

      console.log('[Notifications] FCM token rotated — re-registering with backend:', newToken);
      this._pushToken = newToken;
      this._registered = false;

      // Re-register the new token with the backend
      let attempt = 0;
      let delay = 1000;
      while (attempt < 3) {
        try {
          await chatService.registerPushToken(newToken);
          console.log('[Notifications] Rotated token re-registered with backend ✅');
          this._registered = true;
          return;
        } catch (err) {
          attempt++;
          if (attempt >= 3) {
            console.warn('[Notifications] Failed to re-register rotated token after 3 attempts:', err);
            return;
          }
          await new Promise(r => setTimeout(r, delay));
          delay *= 2;
        }
      }
    });

    console.log('[Notifications] Token rotation listener active ✅');
  }

  private async _createAndroidChannels(): Promise<void> {
    if (Platform.OS !== 'android') return;

    await Notifications.setNotificationChannelAsync('nova_messages', {
      name: 'Nova Messages',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#8B5CF6',
      sound: 'default',
      enableVibrate: true,
      showBadge: true,
    });

    await Notifications.setNotificationChannelAsync('nova_moments', {
      name: 'Nova Moments & Check-ins',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 150],
      lightColor: '#8B5CF6',
      sound: 'default',
      enableVibrate: true,
      showBadge: true,
    });

    await Notifications.setNotificationChannelAsync('nova_reminders', {
      name: 'Nova Reminders',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 300, 150, 300],
      lightColor: '#8B5CF6',
      sound: 'default',
      enableVibrate: true,
      showBadge: false,
    });
  }

  private async _requestPermissionAndRegister(): Promise<void> {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') {
      console.warn('[Notifications] Permission not granted — user denied');
      return;
    }

    let tokenResult;
    try {
      tokenResult = await Notifications.getExpoPushTokenAsync({
        projectId: '17e73685-4785-47b5-8302-82d1df185f8c',
      });
    } catch (tokenErr) {
      console.warn('[Notifications] Failed to get push token:', tokenErr);
      // Common cause: google-services.json missing / FCM not configured
      // Background notifications will NOT work until Firebase is set up
      return;
    }

    this._pushToken = tokenResult.data;
    console.log('[Notifications] Push token obtained:', this._pushToken);

    // Register with backend — retry up to 3 times with exponential backoff
    let attempt = 0;
    let delay = 1000;
    while (attempt < 3) {
      try {
        await chatService.registerPushToken(this._pushToken);
        console.log('[Notifications] Token registered with backend ✅');
        this._registered = true;
        return;
      } catch (err) {
        attempt++;
        if (attempt >= 3) {
          console.warn('[Notifications] Failed to register token after 3 attempts:', err);
          return;
        }
        console.warn(`[Notifications] Token registration attempt ${attempt} failed, retrying in ${delay}ms`);
        await new Promise(r => setTimeout(r, delay));
        delay *= 2;
      }
    }
  }
}

export const notificationService = new NotificationService();
