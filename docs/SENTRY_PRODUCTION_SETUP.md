# SENTRY PRODUCTION SETUP

## 1. Step-by-Step Setup
1. Log into your Sentry dashboard.
2. Select your `humanos-mobile` project.
3. Obtain the DSN from **Settings > Projects > [Project Name] > Client Keys (DSN)**.

## 2. Environment Variables
### Local Development
Place the DSN in your `.env` file inside the `mobile` folder:
```env
EXPO_PUBLIC_SENTRY_DSN="https://your-dsn@sentry.io/project"
```

### EAS Update & Production
You must expose the DSN in your EAS build environment.
Run the following to set it for your production profile:
```bash
eas secret:create --scope project --name EXPO_PUBLIC_SENTRY_DSN --value "your_dsn_here"
```

## 3. Dashboard Creation
In Sentry, navigate to **Dashboards** and create a custom dashboard tracking:
- Crashes grouped by `updateId` (Critical for OTA).
- User impact (unique users experiencing crashes).
- Breadcrumbs leading to `triggerTestError` to ensure logs are propagating.

## 4. OTA Compatibility
HumanOS utilizes Expo EAS for Over-The-Air updates.
- Sentry tags each event with the `updateId` and `runtimeVersion`.
- If an OTA causes a crash loop, you can pinpoint the exact `updateId` from Sentry and run:
  `eas update --branch production --republish <previous-stable-update-id>`

## 5. Release Tracking
The app automatically uploads source maps to Sentry on native builds via the `@sentry/react-native` Expo plugin configured in `app.json`. Make sure you authenticate your Sentry CLI on your CI/CD server if automating builds.

## 6. Verification Steps
1. Enable **Developer Mode** in the app's Settings.
2. Scroll to the **TEST CRASH REPORTING** section.
3. Press **Send Test Error** (this should appear in Sentry as an issue but won't crash the app).
4. Press **Force Crash** (this will fatally crash the app).
5. Reload the app and verify that both the error and crash appear in the Sentry dashboard with the correct `appVersion` and `updateId` tags.
