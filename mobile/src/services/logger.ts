// @ts-ignore
import * as Sentry from '@sentry/react-native';
// @ts-ignore
import * as Application from 'expo-application';
import * as Updates from 'expo-updates';
import { Platform } from 'react-native';
// @ts-ignore
import * as Device from 'expo-device';

// Setup Sentry routing (replace YOUR_DSN with actual project DSN when ready)
export const initLogger = () => {
  Sentry.init({
    dsn: process.env.EXPO_PUBLIC_SENTRY_DSN || 'https://placeholder@sentry.io/placeholder',
    debug: __DEV__, // If `true`, Sentry will try to print out useful debugging information if something goes wrong with sending the event. Set it to `false` in production
    tracesSampleRate: 1.0, // Set to 1.0 to capture 100% of transactions for performance monitoring
  });

  // Attach metadata that does not change
  Sentry.setTags({
    appVersion: Application.nativeApplicationVersion || 'unknown',
    runtimeVersion: Updates.runtimeVersion || 'unknown',
    updateId: Updates.updateId || 'embedded',
    branch: Updates.channel || 'development',
    platform: Platform.OS,
    deviceModel: Device.modelName || 'unknown',
  });
};

export const setUserContext = (user: { id?: string; email?: string; username?: string } | null) => {
  if (user) {
    Sentry.setUser({
      id: user.id || 'anonymous',
      email: user.email,
      username: user.username,
    });
  } else {
    Sentry.setUser(null);
  }
};

export const logError = (error: Error | unknown, context?: Record<string, any>) => {
  console.error('[Logger]', error);
  if (context) {
    Sentry.withScope((scope: any) => {
      scope.setExtras(context);
      Sentry.captureException(error);
    });
  } else {
    Sentry.captureException(error);
  }
};

export const logWarning = (message: string, context?: Record<string, any>) => {
  console.warn('[Logger]', message);
  if (context) {
    Sentry.withScope((scope: any) => {
      scope.setExtras(context);
      Sentry.captureMessage(message, 'warning');
    });
  } else {
    Sentry.captureMessage(message, 'warning');
  }
};

export const triggerCrash = () => {
  throw new Error("Test Crash: " + new Date().toISOString());
};

export const triggerTestCrash = () => {
  throw new Error("Force Crash Test triggered from Settings: " + new Date().toISOString());
};

export const triggerTestError = () => {
  try {
    throw new Error("Send Test Error triggered from Settings: " + new Date().toISOString());
  } catch (err) {
    logError(err, { source: 'SettingsScreen_TestButton' });
  }
};
