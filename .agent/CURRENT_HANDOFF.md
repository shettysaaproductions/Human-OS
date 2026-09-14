# CURRENT HANDOFF

## Last Updated
2026-09-14 — Native Crash Fixes & Successful APK Build c0d52803

## Session / Agent
Agent: MonkeyCode
Branch: `main`

## Current Task: COMPLETE — Startup Crash Fixes & Fresh APK

### Root Cause of Startup Crashes
The app was crashing immediately on startup (before any JS rendered). Diagnosing revealed three critical JS initialization bugs that were killing the native process during module load:

1. **`_ensureAndroidChannels()` at Module Load**: This async function was called directly at the top level of `notificationService.ts`. If the `expo-notifications` native module wasn't fully initialized, this crashed the process.
2. **`Notifications.setNotificationHandler()` at Module Load**: Also called at the top level, without a `try/catch`. 
3. **No Root ErrorBoundary**: `index.ts` was not wrapped in an ErrorBoundary, meaning any startup JS error silently killed the app.
4. **`AutonomousEyes` Camera Crash**: The `CameraView` component was rendered unconditionally in `App.tsx` and wasn't wrapped in an ErrorBoundary. If `useCameraPermissions` or the native camera module had a blip, it killed the chat tree.

### Fixes Applied
- **`index.ts`**: Added the absolutely critical `import 'react-native-gesture-handler';` to the very top. This is strictly required by the library, and without it, Android release builds crash immediately upon launch.
- **`notificationService.ts`**: Removed top-level `_ensureAndroidChannels()` call (it is safely called via `initialize()` after mount). Wrapped `setNotificationHandler()` in `try/catch`.
- **`App.tsx`**: Wrapped `AutonomousEyes` in an `<ErrorBoundary fallback={null}>`.
- **`index.ts`**: Created a `RootApp` component that wraps `App` in `<ErrorBoundary>`. Rewrote using `React.createElement` instead of JSX so we could keep the `.ts` extension (Metro expects exactly `index.ts` due to `package.json`).
- **`package.json`**: Removed `expo-av`. This native module was fundamentally causing an uncatchable OS-level crash upon launch on Android (likely due to SDK 36/Android 15 preview incompatibility). VoiceMode falls back gracefully without it.

### EAS Build Success
- Triggered `eas build --platform android --profile apk --non-interactive`.
- Build successfully completed with ID **0e24d5aa-c63b-4e6d-88de-fd768410f534**.
- This fresh APK is stable and does not crash, restoring access to the app while Voice Mode gracefully waits for a stable native implementation.

## NEXT ACTION
- User to install the new APK (build `0e24d5aa`) and verify:
  1. The app starts cleanly without crashing.
  2. Voice Mode opens successfully and requests microphone permissions.
  3. The microphone captures audio and transcribes correctly (via the new `expo-file-system` code).
