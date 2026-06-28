import React, { useEffect, useState } from 'react';
import { View, Text, ActivityIndicator, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as Updates from 'expo-updates';
import * as SecureStore from 'expo-secure-store';
import { StatusBar } from 'expo-status-bar';
import { AppNavigator } from './src/navigation/AppNavigator';
import { ThemeProvider, useTheme } from './src/theme/ThemeContext';
import changelog from './src/config/changelog.json';

function AppContent() {
  const { isDark, colors } = useTheme();
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [modalType, setModalType] = useState<'downloaded' | 'changelog'>('changelog');


  useEffect(() => {
    checkForUpdate();
  }, []);

  const checkForUpdate = async () => {


    // Skip update check in development
    if (__DEV__) {
      await checkChangelog();
      return;
    }

    try {
      setIsCheckingUpdate(true);
      console.log('[Updates] Checking for OTA update...');
      const update = await Updates.checkForUpdateAsync();

      if (update.isAvailable) {
        console.log('[Updates] Update found — downloading...');
        await Updates.fetchUpdateAsync();
        console.log('[Updates] Download complete — ready to reload');
        setModalType('downloaded');
        setModalVisible(true);
      } else {
        console.log('[Updates] App is up to date.');
        await checkChangelog();
      }
    } catch (error) {
      console.warn('[Updates] Update check failed (non-fatal):', error);
      await checkChangelog();
    } finally {
      setIsCheckingUpdate(false);
    }
  };

  const checkChangelog = async () => {
    try {
      const lastSeen = await SecureStore.getItemAsync('lastSeenVersion');
      if (lastSeen !== changelog.version) {
        setModalType('changelog');
        setModalVisible(true);
      } else {
        setModalVisible(false);
      }
    } catch (err) {
      console.warn('[Updates] Failed to read lastSeenVersion:', err);
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
      await SecureStore.setItemAsync('lastSeenVersion', changelog.version);
    } catch (err) {
      console.warn('[Updates] Failed to write lastSeenVersion:', err);
    }
  };

  if (isCheckingUpdate) {
    return (
      <View style={[styles.updateScreen, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color="#8B5CF6" />
        <Text style={[styles.updateText, { color: colors.textSecondary }]}>Checking for updates...</Text>
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <AppNavigator />
      

      
      {modalVisible && (
        <View style={[styles.modalOverlay, { backgroundColor: 'rgba(0, 0, 0, 0.75)' }]}>
          <View style={[styles.modalContent, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.modalTitle, { color: colors.textPrimary }]}>✨ Nova Updated</Text>
            <Text style={styles.versionTag}>v{changelog.version}</Text>
            
            <ScrollView style={styles.notesContainer} showsVerticalScrollIndicator={false}>
              {changelog.notes.map((note, index) => (
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

export default function App() {
  return (
    <ThemeProvider>
      <AppContent />
    </ThemeProvider>
  );
}

const styles = StyleSheet.create({
  updateScreen: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
  },
  updateText: {
    fontSize: 16,
  },
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
