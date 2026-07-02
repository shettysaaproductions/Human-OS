# Play Store Release Checklist

## 1. App Icons
- [ ] Ensure adaptive icons are provided (foreground and background layers).
- [ ] Verify 512x512 high-res icon is ready for the store listing.

## 2. Splash Screen
- [ ] Verify `expo-splash-screen` is correctly configured.
- [ ] Ensure background color matches app theme (dark/light) to avoid flash.

## 3. Privacy Policy
- [ ] Ensure a valid Privacy Policy URL is accessible.
- [ ] Add Privacy Policy link to the Google Play Console under App Content.

## 4. Permissions Audit
- [ ] Review `android.permissions` in `app.json`.
- [ ] Remove unused permissions (e.g., location, camera) if not required.
- [ ] Complete Data Safety form in Play Console.

## 5. Versioning
- [ ] Increment `versionCode` in `app.json` for Android.
- [ ] Increment `version` string (e.g., "1.0.1").
- [ ] Tag git commit before building (`git tag v1.0.1`).

## 6. Release Process
- [ ] Run `eas build --platform android --profile production`.
- [ ] Download `.aab` file and upload to Google Play Console (Internal Testing or Production track).
- [ ] Add release notes for this version.

## 7. Crash Reporting
- [ ] Ensure Sentry (or equivalent) is initialized early in `App.tsx`.
- [ ] Upload sourcemaps during build process.

## 8. Analytics
- [ ] Verify production telemetry endpoints are active.
- [ ] Ensure events (e.g., `app_open`, `message_sent`) are batched and do not block UI.

## 9. OTA Strategy
- [ ] Publish OTA updates using `eas update --branch production`.
- [ ] Ensure updates are backward compatible with the native `.aab` binary.
- [ ] Only force native updates when adding new native libraries or permissions.
