/**
 * notificationService.ts
 *
 * Handles all push notification logic.
 *
 * === TOKEN FRESHNESS GUARANTEE ===
 * Every new APK install generates a new Expo push token. Without refreshing,
 * the DB holds the old token and ALL notifications (chat replies, NACE
 * proactive messages, reminders) silently fail.
 *
 * Solution: `ensureTokenFresh()` runs EVERY app launch after auth is confirmed.
 * It gets the current device token, compares with the last registered token
 * (stored in AsyncStorage), and re-registers if they differ. This handles:
 *   - New APK installs
 *   - Android FCM token rotations
 *   - App reinstalls
 *   - Any other token invalidation scenario
 *
 * Call order (in App.tsx / auth flow):
 *   1. notificationService.initialize()    — on app start (channels only, pre-auth)
 *   2. notificationService.registerAfterAuth() — immediately after login
 *   3. notificationService.ensureTokenFresh()  — also on every launch if already logged in
 */

import * as Notifications from 'expo-notifications';
import { Platform, AppState } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { chatService } from './chatService';

const LAST_REGISTERED_TOKEN_KEY = '@nova_last_push_token';

// ── Chat screen active flag — suppress banners when user is reading chat ────────
// ChatScreen calls setChatScreenActive(true) on mount and (false) on unmount.
let _isChatScreenActive = false;
export function setChatScreenActive(active: boolean) {
  _isChatScreenActive = active;
}

// ── Show notifications when app is open BUT suppress when on ChatScreen ────────
// When user is actively reading the chat, showing a banner is redundant noise.
// shouldShowList: false when on chat ensures NO heads-up banner on Android.
Notifications.setNotificationHandler({
  handleNotification: async () => {
    const isActuallyActive = _isChatScreenActive && AppState.currentState === 'active';
    return {
      shouldShowAlert: !isActuallyActive,
      shouldPlaySound: !isActuallyActive,
      shouldSetBadge: !isActuallyActive,
      shouldShowBanner: !isActuallyActive,
      shouldShowList: !isActuallyActive,
    };
  },
});

// ── Ensure Android notification channels always have HIGH importance ──────────
// Android caches channel settings immutably. Delete + recreate on every start
// so importance is always correct even if a previous install set it wrong.
async function _ensureAndroidChannels() {
  if (Platform.OS !== 'android') return;
  try {
    await Notifications.deleteNotificationChannelAsync('nova_messages').catch(() => {});
    await Notifications.deleteNotificationChannelAsync('nova_moments').catch(() => {});
    await Notifications.deleteNotificationChannelAsync('nova_reminders').catch(() => {});
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
    console.log('[Notifications] Android channels refreshed ✅');
  } catch (err) {
    console.warn('[Notifications] Channel setup error (non-critical):', err);
  }
}
_ensureAndroidChannels();

class NotificationService {

  private _pushToken: string | null = null;
  private _registered = false;
  private _tokenListener: Notifications.EventSubscription | null = null;
  private _notifReceivedListener: Notifications.EventSubscription | null = null;
  private _notifResponseListener: Notifications.EventSubscription | null = null;
  private _onNovaReply: (() => void) | null = null;

  /**
   * Register a callback that fires whenever a Nova-reply push notification
   * arrives (foreground OR background-then-tapped). Use this to trigger
   * checkProactiveMessages() from the chat store.
   */
  setOnNovaReplyCallback(cb: () => void): void {
    this._onNovaReply = cb;
  }

  private _fireReplyCallback(): void {
    if (this._onNovaReply) {
      try { this._onNovaReply(); } catch {}
    }
  }

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
   * Registers the token and sets up listeners. Safe to call multiple times.
   */
  async registerAfterAuth(): Promise<void> {
    try {
      await this._requestPermissionAndRegister();
      this._startTokenRefreshListener();
      this._startNotificationListeners();
    } catch (err) {
      console.warn('[Notifications] registerAfterAuth failed (non-critical):', err);
    }
  }

  /**
   * TOKEN FRESHNESS GUARANTEE — call this on every app launch after confirming
   * the user is already authenticated (i.e., they didn't just log in fresh).
   *
   * Every new APK install = new Expo push token. This method compares the
   * current device token with the last token we successfully registered with
   * the backend. If they differ, it re-registers immediately.
   *
   * This is what makes push notifications survive across APK upgrades.
   */
  async ensureTokenFresh(): Promise<void> {
    try {
      const { status } = await Notifications.getPermissionsAsync();
      if (status !== 'granted') {
        console.log('[Notifications] ensureTokenFresh: permission not granted, skipping');
        return;
      }

      let tokenResult;
      try {
        // Force fetch underlying FCM native token first to bypass Expo's cache on reinstall
        const deviceToken = await Notifications.getDevicePushTokenAsync();
        
        tokenResult = await Notifications.getExpoPushTokenAsync({
          projectId: '17e73685-4785-47b5-8302-82d1df185f8c',
          devicePushToken: deviceToken,
        });
      } catch (tokenErr) {
        console.warn('[Notifications] ensureTokenFresh: failed to get token:', tokenErr);
        return;
      }

      const currentToken = tokenResult.data;
      if (!currentToken) return;

      // Read the last token we successfully registered with the backend
      const lastRegistered = await SecureStore.getItemAsync(LAST_REGISTERED_TOKEN_KEY).catch(() => null);

      if (currentToken === lastRegistered) {
        // Token unchanged — no re-registration needed
        console.log('[Notifications] ensureTokenFresh: token unchanged ✅');
        return;
      }

      // Token is new (new APK, FCM rotation, reinstall) — re-register with backend
      console.log('[Notifications] ensureTokenFresh: token changed — re-registering with backend');
      console.log('[Notifications] Old:', lastRegistered?.substring(0, 30) ?? 'none');
      console.log('[Notifications] New:', currentToken.substring(0, 30));

      await chatService.registerPushToken(currentToken);
      this._pushToken = currentToken;

      // Save the newly registered token so we don't re-register on next launch
      await SecureStore.setItemAsync(LAST_REGISTERED_TOKEN_KEY, currentToken).catch(() => {});

      console.log('[Notifications] ensureTokenFresh: new token registered ✅');

      // Also start listeners if not already started
      this._startNotificationListeners();
      this._startTokenRefreshListener();
    } catch (err) {
      console.warn('[Notifications] ensureTokenFresh failed (non-critical):', err);
    }
  }

  /**
   * Clean up the token rotation listener.
   * Call this on logout to avoid re-registering a stale auth session.
   */
  cleanup(): void {
    // Wipe local cache so re-login forces a fresh sync
    SecureStore.deleteItemAsync(LAST_REGISTERED_TOKEN_KEY).catch(() => {});
    
    if (this._tokenListener) {
      this._tokenListener.remove();
      this._tokenListener = null;
    }
    if (this._notifReceivedListener) {
      this._notifReceivedListener.remove();
      this._notifReceivedListener = null;
    }
    if (this._notifResponseListener) {
      this._notifResponseListener.remove();
      this._notifResponseListener = null;
    }
    this._registered = false;
  }

  // ── Private ──────────────────────────────────────────────────────────────────

  /**
   * Listen for FCM token rotations (Android rotates these periodically).
   * When a new token is issued, immediately re-register with the backend so
   * the DB never holds a stale token.
   */
  /**
   * Listen for incoming Nova-reply push notifications and immediately fetch
   * the latest messages. This is the key link between push delivery and the
   * UI updating — previously nothing happened when the push arrived.
   */
  private _startNotificationListeners(): void {
    // Remove old listeners before adding new ones
    if (this._notifReceivedListener) {
      this._notifReceivedListener.remove();
    }
    if (this._notifResponseListener) {
      this._notifResponseListener.remove();
    }

    // Fires when a push notification arrives while the app is foregrounded
    this._notifReceivedListener = Notifications.addNotificationReceivedListener((notification) => {
      const type = notification.request.content.data?.type as string | undefined;
      // If user is on chat screen AND app is foregrounded: silently dismiss the notification and just fetch messages
      // This is the WhatsApp behavior — no banner/sound while actively reading
      const isActuallyActive = _isChatScreenActive && AppState.currentState === 'active';
      if (isActuallyActive) {
        Notifications.dismissNotificationAsync(notification.request.identifier).catch(() => {});
        Notifications.setBadgeCountAsync(0).catch(() => {});
      }
      if (type === 'nova_reply' || type === 'nova_auto_reminder' || type === 'nova_consciousness' || type === 'nova_followup') {
        console.log('[Notifications] Nova reply push received (foreground) — fetching messages');
        this._fireReplyCallback();
      }
    });

    // Fires when the user taps the notification (app was in background or killed)
    this._notifResponseListener = Notifications.addNotificationResponseReceivedListener((response) => {
      const type = response.notification.request.content.data?.type as string | undefined;
      if (type === 'nova_reply' || type === 'nova_auto_reminder' || type === 'nova_consciousness' || type === 'nova_followup') {
        console.log('[Notifications] Nova reply push tapped (background) — fetching messages');
        this._fireReplyCallback();
      }
    });

    console.log('[Notifications] Nova reply listeners active ✅');
  }

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
      const deviceToken = await Notifications.getDevicePushTokenAsync();
      
      tokenResult = await Notifications.getExpoPushTokenAsync({
        projectId: '17e73685-4785-47b5-8302-82d1df185f8c',
        devicePushToken: deviceToken,
      });
    } catch (tokenErr: any) {
      console.warn('[Notifications] Failed to get push token:', tokenErr);
      import('react-native').then(({ Alert }) => {
        Alert.alert('Push Token Error', String(tokenErr.message || tokenErr));
      });
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
        // Persist the registered token so ensureTokenFresh() can detect changes on next launch
        await SecureStore.setItemAsync(LAST_REGISTERED_TOKEN_KEY, this._pushToken).catch(() => {});
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
