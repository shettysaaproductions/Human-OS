import React, { useEffect, useState } from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as Updates from 'expo-updates';
import { AppNavigator } from './src/navigation/AppNavigator';

export default function App() {
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);

  useEffect(() => {
    checkForUpdate();
  }, []);

  const checkForUpdate = async () => {
    // Skip update check in development
    if (__DEV__) return;

    try {
      setIsCheckingUpdate(true);
      console.log('[Updates] Checking for OTA update...');
      const update = await Updates.checkForUpdateAsync();

      if (update.isAvailable) {
        console.log('[Updates] Update found — downloading...');
        await Updates.fetchUpdateAsync();
        console.log('[Updates] Download complete — reloading app');
        await Updates.reloadAsync();
      } else {
        console.log('[Updates] App is up to date.');
      }
    } catch (error) {
      // Non-fatal — just continue with cached bundle
      console.warn('[Updates] Update check failed (non-fatal):', error);
    } finally {
      setIsCheckingUpdate(false);
    }
  };

  if (isCheckingUpdate) {
    return (
      <View style={styles.updateScreen}>
        <ActivityIndicator size="large" color="#007AFF" />
        <Text style={styles.updateText}>Checking for updates...</Text>
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <AppNavigator />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  updateScreen: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff',
    gap: 16,
  },
  updateText: {
    fontSize: 16,
    color: '#666',
  },
});
