/**
 * notificationService.ts
 *
 * Handles all push notification logic:
 * - Requesting permission on first launch
 * - Getting the Expo Push Token for this device
 * - Registering the token with our backend
 * - Setting up notification channels (Android: messages vs moments)
 * - Showing notifications while app is foregrounded
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

  /**
   * Call once on app startup (in App.tsx).
   * Requests permission, gets token, registers with backend.
   */
  async initialize(): Promise<void> {
    try {
      await this._createAndroidChannels();
      await this._requestPermissionAndRegister();
    } catch (err) {
      console.warn('[Notifications] Initialization failed (non-critical):', err);
    }
  }

  get pushToken(): string | null {
    return this._pushToken;
  }

  // ── Private ──────────────────────────────────────────────────────────────────

  private async _createAndroidChannels(): Promise<void> {
    if (Platform.OS !== 'android') return;

    // High-priority channel for Nova replies (makes sound + heads-up banner)
    await Notifications.setNotificationChannelAsync('nova_messages', {
      name: 'Nova Messages',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#8B5CF6',
      sound: 'default',
      enableVibrate: true,
      showBadge: true,
    });

    // Default priority for proactive moments / check-ins
    await Notifications.setNotificationChannelAsync('nova_moments', {
      name: 'Nova Moments & Check-ins',
      importance: Notifications.AndroidImportance.DEFAULT,
      vibrationPattern: [0, 150],
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
      console.warn('[Notifications] Permission not granted');
      return;
    }

    const tokenResult = await Notifications.getExpoPushTokenAsync({
      projectId: '17e73685-4785-47b5-8302-82d1df185f8c',
    });

    this._pushToken = tokenResult.data;
    console.log('[Notifications] Push token obtained:', this._pushToken);

    // Register with our backend so Nova can send notifications to this device
    try {
      await chatService.registerPushToken(this._pushToken);
      console.log('[Notifications] Token registered with backend');
    } catch (err) {
      console.warn('[Notifications] Failed to register token:', err);
    }
  }
}

export const notificationService = new NotificationService();
