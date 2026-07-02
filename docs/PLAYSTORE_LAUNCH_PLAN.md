# Play Store Launch Plan

## Release Checklist
- [ ] Finalize testing on physical Android devices.
- [ ] Build production Android App Bundle (AAB) using `eas build --platform android --profile production`.
- [ ] Prepare store listing assets (Icon, Feature Graphic, localized descriptions).
- [ ] Set up the release track (Internal Testing -> Closed Alpha -> Production).

## Crash Reporting
- [ ] Integrate Sentry (or Firebase Crashlytics) to capture JS errors and native crashes.
- [ ] Verify sourcemaps are uploaded automatically during the EAS build process to map crashes back to TypeScript code.

## Analytics
- [ ] Finalize telemetry infrastructure for core events (`app_open`, `message_sent`, `error_encountered`).
- [ ] Ensure events are batched and flushed periodically to minimize network wakeups and preserve battery.

## Privacy Policy
- [ ] Host the Privacy Policy on a public URL.
- [ ] Link the Privacy Policy in the Google Play Console under the "App Content" section.
- [ ] Fill out the Data Safety form detailing data collection (e.g., chat history, device identifiers).

## Screenshots
- [ ] Capture high-resolution screenshots of core flows (Onboarding, Chat with Nova, Settings).
- [ ] Format screenshots to meet Play Store guidelines (min 320px, max 3840px, 16:9 or 9:16 aspect ratio).

## Testing Plan
- [ ] Conduct a full regression test on the production build (force close, OTA background sync, auth state persistence).
- [ ] Deploy to Internal Testing track and invite QA / Alpha users.
- [ ] Monitor crash reports for 48 hours before promoting the release to Production.
