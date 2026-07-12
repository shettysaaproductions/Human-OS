import React from 'react';
import { NavigationContainer, NavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

// Screens
import { LoginScreen } from '../screens/LoginScreen';
import { SignupScreen } from '../screens/SignupScreen';
import { SplashScreen } from '../screens/SplashScreen';
import { OnboardingScreen } from '../screens/OnboardingScreen';
import { ChatScreen } from '../screens/ChatScreen';
import { DiagnosticsScreen } from '../screens/DiagnosticsScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { UpdateHistoryScreen } from '../screens/UpdateHistoryScreen';
import { FeedbackScreen } from '../screens/FeedbackScreen';
import { BrainNavigator } from './BrainNavigator';
import { ErrorBoundary } from '../components/ErrorBoundary';

import { useAuthStore } from '../store/useAuthStore';

const Stack = createNativeStackNavigator();

interface AppNavigatorProps {
  navigationRef?: React.RefObject<NavigationContainerRef<any> | null>;
}

export function AppNavigator({ navigationRef }: AppNavigatorProps) {
  const { isLoading, accessToken, onboardingStatus, hydrate } = useAuthStore();

  React.useEffect(() => {
    hydrate();
  }, []);

  if (isLoading) {
    return <SplashScreen />;
  }

  const isAuthenticated = !!accessToken;
  const hasCompletedOnboarding = onboardingStatus;

  return (
    <ErrorBoundary>
      <NavigationContainer ref={navigationRef}>
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

