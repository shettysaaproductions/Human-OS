# Play Store Launch: Gap Analysis

## 1. Completed
- **App Icons:** Basic icon designs exist.
- **Splash Screen:** `expo-splash-screen` is configured.
- **Core App Flows:** Chat, history, pagination, OTA updates, and auth are stable.

## 2. Missing Requirements
- **Privacy Policy:** No public URL or document exists.
- **Data Safety Form:** Needs to be completed indicating data collection (messages, auth tokens).
- **Crash Reporting & Telemetry:** Sentry or Firebase Crashlytics are not fully integrated into `App.tsx` for production.
- **Screenshots:** Play Store formatted screenshots (16:9 / 9:16) of core flows are missing.
- **Permissions Audit:** Unused permissions may still be present in the build and need stripping in `app.json`.

## 3. Blocking Issues
- **Crashlytics / Sentry Integration:** Without this, production monitoring is impossible.
- **Privacy Policy URL:** Google Play will reject the app without a valid privacy policy link.

## 4. Estimated Timeline
- **Days 1-2:** Generate Privacy Policy, capture Screenshots, strip Permissions.
- **Days 3-4:** Integrate and verify Sentry/Crashlytics, finalize AAB build.
- **Days 5-6:** Internal Testing track deployment & QA.
- **Day 7:** Closed Alpha or Production rollout.

## 5. Priority Order
1. Host Privacy Policy (Blocking).
2. Integrate Crash Reporting (Blocking for QA).
3. Capture Screenshots & update store listing.
4. Finalize AAB build.
5. Submit to Internal Testing.
