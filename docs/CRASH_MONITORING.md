# Crash Monitoring & Telemetry

This application uses [Sentry](https://sentry.io/) for crash reporting and performance monitoring.

## Supported Platforms
- Android
- iOS
- Web (Not currently officially supported, but works)

## Features Monitored
- **JS Exceptions**: Uncaught JavaScript errors.
- **Native Crashes**: Hard crashes in native modules (Android/iOS).
- **Unhandled Promise Rejections**: Asynchronous functions failing without a `.catch()`.
- **API Failures**: Monitored using custom hooks or the `logError` wrapper.
- **OTA Updates**: We tag the `runtimeVersion` and `updateId` so that you can trace a crash back to a specific EAS Update.

## Setup Instructions

1. Create a [Sentry Project](https://sentry.io/) for React Native.
2. Obtain your `DSN`.
3. Add the `DSN` to your `.env` file:
   ```env
   EXPO_PUBLIC_SENTRY_DSN="https://your-dsn-here@o0.ingest.sentry.io/0"
   ```
4. Sentry is initialized automatically in `App.tsx` on launch.

## Viewing Crashes
- **Dashboard**: Visit your Sentry dashboard at `https://sentry.io/organizations/[your-org]/issues/`
- **Filtering**:
  - Filter by `appVersion`
  - Filter by `updateId` (OTA ID)
  - Filter by `platform` (ios / android)

## Helper Methods

To manually log issues throughout the codebase, use the `logger.ts` methods:

```typescript
import { logError, logWarning, triggerCrash } from '../services/logger';

// 1. Log a handled error
try {
  await api.post('/some-endpoint');
} catch (error) {
  logError(error, { endpoint: '/some-endpoint', context: 'retry_failed' });
}

// 2. Log a non-fatal warning
if (!user.hasAcceptedTerms) {
  logWarning('User attempted action without accepting terms', { userId: user.id });
}

// 3. Trigger a test crash
triggerCrash(); // Will throw an unhandled JS error
```

## How to Reproduce Test Crashes

You can call the `triggerCrash()` function from `src/services/logger.ts` on a button press to intentionally crash the JS thread:

```tsx
import { triggerCrash } from '../services/logger';

<Button title="Crash App" onPress={triggerCrash} />
```

*Note: In development mode, the Expo Redbox will appear. In a production build, it will crash silently and send the event to Sentry.*

## Rollback Instructions

If Sentry detects a spike in crashes linked to a specific OTA `updateId`:

1. View the OTA Update History in the EAS Dashboard.
2. Find the last known stable `Update Group ID`.
3. Republish the stable update to the production branch:
   ```bash
   eas update --branch production --republish <STABLE-GROUP-ID>
   ```
4. The devices will download the reverted bundle on the next launch.
