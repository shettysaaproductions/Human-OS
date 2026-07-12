/**
 * logger.ts — lightweight console logger
 *
 * Sentry integration is stubbed out. Install @sentry/react-native and
 * expo-device, then un-stub initLogger() when you have a real DSN.
 */

// ── Stub Sentry so the app compiles without the package installed ──────────────
const Sentry = {
  init: (_config: any) => {},
  setTags: (_tags: any) => {},
  setUser: (_user: any) => {},
  captureException: (_err: any) => {},
  captureMessage: (_msg: any, _level?: any) => {},
  withScope: (cb: (scope: { setExtras: (e: any) => void }) => void) => {
    cb({ setExtras: () => {} });
  },
};

import * as Application from 'expo-application';
import * as Updates from 'expo-updates';
import { Platform } from 'react-native';

export const initLogger = () => {
  Sentry.init({
    dsn: process.env.EXPO_PUBLIC_SENTRY_DSN || '',
    tracesSampleRate: 1.0,
  });

  Sentry.setTags({
    appVersion: Application.nativeApplicationVersion || 'unknown',
    runtimeVersion: Updates.runtimeVersion || 'unknown',
    updateId: Updates.updateId || 'embedded',
    branch: Updates.channel || 'development',
    platform: Platform.OS,
  });
};

export const setUserContext = (user: { id?: string; email?: string; username?: string } | null) => {
  if (user) {
    Sentry.setUser({ id: user.id || 'anonymous', email: user.email, username: user.username });
  } else {
    Sentry.setUser(null);
  }
};

export const logError = (error: Error | unknown, context?: Record<string, any>) => {
  console.error('[Logger]', error);
  Sentry.withScope((scope) => {
    if (context) scope.setExtras(context);
    Sentry.captureException(error);
  });
};

export const logWarning = (message: string, context?: Record<string, any>) => {
  console.warn('[Logger]', message);
  Sentry.withScope((scope) => {
    if (context) scope.setExtras(context);
    Sentry.captureMessage(message, 'warning');
  });
};

export const triggerCrash = () => {
  throw new Error('Test Crash: ' + new Date().toISOString());
};

export const triggerTestCrash = () => {
  throw new Error('Force Crash Test triggered from Settings: ' + new Date().toISOString());
};

export const triggerTestError = () => {
  try {
    throw new Error('Send Test Error triggered from Settings: ' + new Date().toISOString());
  } catch (err) {
    logError(err, { source: 'SettingsScreen_TestButton' });
  }
};
