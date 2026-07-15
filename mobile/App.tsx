import React, { useEffect, useRef, useState } from 'react';
import { AppState, AppStateStatus, View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as Updates from 'expo-updates';
import * as SecureStore from 'expo-secure-store';
import { StatusBar } from 'expo-status-bar';
import { AppNavigator } from './src/navigation/AppNavigator';
import { ThemeProvider, useTheme } from './src/theme/ThemeContext';
import { notificationService } from './src/services/notificationService';
import { useChatStore } from './src/store/useChatStore';
import * as Notifications from 'expo-notifications';
import { NavigationContainerRef } from '@react-navigation/native';
import updateHistory from './src/config/updateHistory.json';

const latestUpdate = updateHistory[0];

// Navigation ref so we can navigate from outside React tree (notification tap handler)
const navigationRef = React.createRef<NavigationContainerRef<any>>();

function AppContent() {
  const { isDark, colors } = useTheme();
  const [modalVisible, setModalVisible] = useState(false);
  const [modalType, setModalType] = useState<'downloaded' | 'changelog'>('changelog');

  useEffect(() => {
    console.log('APP_VERSION');
    console.log('UPDATE_ID', Updates.updateId);
    console.log('CHANNEL', Updates.channel);
    console.log('RUNTIME_VERSION', Updates.runtimeVersion);
    console.log('IS_EMBEDDED', Updates.isEmbeddedLaunch);
    // All background — never block the UI
    runBackgroundChecks();
    // Initialize notification channels only (safe before auth)
    // Token registration happens post-login via notificationService.registerAfterAuth()
    notificationService.initialize();

    // ── Notification tap handler: user tapped a Nova notification ──────────────
    // Navigates to Chat and refreshes messages so Nova's follow-up is visible
    const tapSub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as any;
      const type = data?.type;
      // Navigate to Chat for any Nova notification type
      const novaTypes = ['nova_reply', 'nova_followup', 'nova_reminder', 'nova_auto_reminder', 'nova_moment'];
      if (novaTypes.includes(type)) {
        // Small delay to allow navigation to mount after cold start
        setTimeout(() => {
          if (navigationRef.current?.isReady()) {
            navigationRef.current.navigate('Chat' as never);
          }
          // Refresh messages to show Nova's new message
          useChatStore.getState().checkProactiveMessages();
        }, 300);
      }
    });

    // ── Foreground notification handler: show badge + refresh messages ──────────
    // When app is open and a Nova notification arrives, silently refresh messages
    const fgSub = Notifications.addNotificationReceivedListener((notification) => {
      const data = notification.request.content.data as any;
      const novaTypes = ['nova_reply', 'nova_followup', 'nova_reminder', 'nova_auto_reminder', 'nova_moment'];
      if (novaTypes.includes(data?.type)) {
        useChatStore.getState().checkProactiveMessages();
      }
    });

    // ── AppState listener: refresh messages when app comes back from background ──
    // This handles the case where the user opens the app from the recents tray
    // WITHOUT tapping a notification — e.g. Nova sent a follow-up while minimized.
    let lastAppState: AppStateStatus = AppState.currentState;
    const appStateSub = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      if (lastAppState !== 'active' && nextState === 'active') {
        // App just came to foreground — check for new messages from Nova
        setTimeout(() => {
          useChatStore.getState().checkProactiveMessages();
        }, 500); // small delay to ensure auth/hydration is ready
      }
      lastAppState = nextState;
    });

    return () => {
      tapSub.remove();
      fgSub.remove();
      appStateSub.remove();
    };
  }, []);

  const runBackgroundChecks = async () => {
    // Skip OTA check in development
    if (!__DEV__) {
      try {
        const update = await Updates.checkForUpdateAsync();
        if (update.isAvailable) {
          await Updates.fetchUpdateAsync();
          // Only surface popup when update is actually ready
          setModalType('downloaded');
          setModalVisible(true);
          return; // skip changelog if update downloaded
        }
      } catch {
        // Non-fatal — silently ignore
      }
    }
    // Check changelog after OTA check (or in dev)
    await checkChangelog();
  };

  const checkChangelog = async () => {
    try {
      const lastSeen = await SecureStore.getItemAsync('lastSeenVersion');
      if (lastSeen !== latestUpdate.version) {
        setModalType('changelog');
        setModalVisible(true);
      }
    } catch {
      // Non-fatal
    }
  };

  const handleUpdateNow = async () => {
    try {
      setModalVisible(false);
      await Updates.reloadAsync();
    } catch (err) {
      console.error('[Updates] Reload failed:', err);
    }
  };

  const handleCloseChangelog = async () => {
    try {
      setModalVisible(false);
      await SecureStore.setItemAsync('lastSeenVersion', latestUpdate.version);
    } catch {
      // Non-fatal
    }
  };

  return (
    <SafeAreaProvider>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <AppNavigator navigationRef={navigationRef} />
      

      
      {modalVisible && (
        <View style={[styles.modalOverlay, { backgroundColor: 'rgba(0, 0, 0, 0.75)' }]}>
          <View style={[styles.modalContent, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.modalTitle, { color: colors.textPrimary }]}>{latestUpdate.title}</Text>
            <Text style={styles.versionTag}>v{latestUpdate.version}</Text>
            
            <ScrollView style={styles.notesContainer} showsVerticalScrollIndicator={false}>
              {latestUpdate.message.map((note, index) => (
                <View key={index} style={styles.noteRow}>
                  <Text style={styles.bullet}>•</Text>
                  <Text style={[styles.noteText, { color: colors.textSecondary }]}>{note}</Text>
                </View>
              ))}
            </ScrollView>

            <View style={styles.buttonContainer}>
              {modalType === 'downloaded' ? (
                <>
                  <TouchableOpacity style={styles.primaryBtn} onPress={handleUpdateNow}>
                    <Text style={styles.primaryBtnText}>Update Now</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.secondaryBtn} onPress={() => setModalVisible(false)}>
                    <Text style={[styles.secondaryBtnText, { color: colors.textSecondary }]}>Later</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <TouchableOpacity style={styles.primaryBtn} onPress={handleCloseChangelog}>
                  <Text style={styles.primaryBtnText}>Got It</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        </View>
      )}
    </SafeAreaProvider>
  );
}

import { GestureHandlerRootView } from 'react-native-gesture-handler';

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider>
        <AppContent />
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    zIndex: 99999,
    elevation: 99999,
  },
  modalContent: {
    width: '100%',
    maxWidth: 340,
    borderRadius: 24,
    padding: 24,
    borderWidth: 1,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.5,
    shadowRadius: 20,
    elevation: 10,
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    marginBottom: 6,
    textAlign: 'center',
  },
  versionTag: {
    fontSize: 14,
    fontWeight: '600',
    color: '#8B5CF6',
    backgroundColor: 'rgba(139, 92, 246, 0.1)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    marginBottom: 20,
  },
  notesContainer: {
    width: '100%',
    maxHeight: 200,
    marginBottom: 24,
  },
  noteRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 10,
    paddingHorizontal: 4,
  },
  bullet: {
    fontSize: 16,
    color: '#8B5CF6',
    marginRight: 8,
    lineHeight: 22,
  },
  noteText: {
    flex: 1,
    fontSize: 15,
    lineHeight: 22,
  },
  buttonContainer: {
    width: '100%',
    gap: 10,
  },
  primaryBtn: {
    width: '100%',
    backgroundColor: '#8B5CF6',
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  secondaryBtn: {
    width: '100%',
    backgroundColor: 'transparent',
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
  },
  secondaryBtnText: {
    fontSize: 16,
    fontWeight: '600',
  },
});
