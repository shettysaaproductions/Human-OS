import React from 'react';
import { View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

// Screens
import { LoginScreen } from '../screens/LoginScreen';
import { SignupScreen } from '../screens/SignupScreen';
import { OnboardingScreen } from '../screens/OnboardingScreen';
import { ChatScreen } from '../screens/ChatScreen';
import { DiagnosticsScreen } from '../screens/DiagnosticsScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { UpdateHistoryScreen } from '../screens/UpdateHistoryScreen';
import { FeedbackScreen } from '../screens/FeedbackScreen';
import { BrainNavigator } from './BrainNavigator';
import { ErrorBoundary } from '../components/ErrorBoundary';

import { useAuthStore } from '../store/useAuthStore';
import { useChatStore } from '../store/useChatStore';
import * as SplashScreenNative from 'expo-splash-screen';

const Stack = createNativeStackNavigator();

export function AppNavigator() {
  const { isLoading, accessToken, onboardingStatus, hydrate } = useAuthStore();
  const isHydrated = useChatStore((state) => state.isHydrated);

  React.useEffect(() => {
    console.log('[STARTUP] APP_START');
    console.log('[STARTUP] AUTH_LOADING', isLoading);
    console.log('[STARTUP] CHAT_HYDRATED', isHydrated);
    hydrate();
  }, []);

  const [failSafeTriggered, setFailSafeTriggered] = React.useState(false);

  React.useEffect(() => {
    // FAIL SAFE: If stuck for 3 seconds, force render
    const timer = setTimeout(() => {
      if (isLoading || !isHydrated) {
        console.log('[STARTUP] FAILSAFE_TRIGGERED - Stuck in hydration for 3s, triggering FAIL SAFE');
        setFailSafeTriggered(true);
        SplashScreenNative.hideAsync().catch(() => {});
      }
    }, 3000);
    return () => clearTimeout(timer);
  }, [isLoading, isHydrated]);

  if ((isLoading || !isHydrated) && !failSafeTriggered) {
    return <View style={{ flex: 1, backgroundColor: '#111827' }} />;
  }

  const isAuthenticated = !!accessToken;
  const hasCompletedOnboarding = onboardingStatus;

  return (
    <ErrorBoundary>
      <NavigationContainer onReady={() => {
        console.log('[STARTUP] NAVIGATOR_RENDER');
        if (!isAuthenticated || !hasCompletedOnboarding || failSafeTriggered) {
          console.log('[STARTUP] HIDE_SPLASH from AppNavigator');
          SplashScreenNative.hideAsync().catch(() => {});
        }
      }}>
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          {!isAuthenticated ? (
            <>
              <Stack.Screen name="Login" component={LoginScreen} />
              <Stack.Screen name="Signup" component={SignupScreen} />
            </>
          ) : !hasCompletedOnboarding ? (
            <Stack.Screen name="Onboarding" component={OnboardingScreen} />
          ) : (
            <>
              <Stack.Screen name="Chat" component={ChatScreen} />
              <Stack.Screen name="Diagnostics" component={DiagnosticsScreen} />
              <Stack.Screen name="Brain" component={BrainNavigator} />
              <Stack.Screen name="Settings" component={SettingsScreen} />
              <Stack.Screen name="UpdateHistory" component={UpdateHistoryScreen} />
              <Stack.Screen name="Feedback" component={FeedbackScreen} />
            </>
          )}
        </Stack.Navigator>
      </NavigationContainer>
    </ErrorBoundary>
  );
}
