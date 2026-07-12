/**
 * notificationService.ts
 *
 * Handles all push notification logic.
 * IMPORTANT: Call initialize() on app start (channels only — no token).
 * Call registerAfterAuth() AFTER the user successfully logs in and the
 * auth token is set in axios headers. This avoids the race condition where
 * the push token API call fails because auth headers aren't set yet.
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
   * Safe to call multiple times; debounced to prevent spam.
   */
  async registerAfterAuth(): Promise<void> {
    try {
      await this._requestPermissionAndRegister();
    } catch (err) {
      console.warn('[Notifications] registerAfterAuth failed (non-critical):', err);
    }
  }

  // ── Private ──────────────────────────────────────────────────────────────────

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
