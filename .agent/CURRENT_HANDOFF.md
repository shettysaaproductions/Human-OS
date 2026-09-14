# CURRENT HANDOFF

## Last Updated
2026-09-14 — v0.3.11-beta crash fix: FileReader + expo-av native module guard

## Session / Agent
Agent: MonkeyCode
Branch: `main`

## Current Task: COMPLETE — Crash Fix (v0.3.11-beta)

### Root Cause of Crash
The app was crashing on startup due to **two bugs introduced in the Voice Mode implementation**:

1. **`FileReader` is not available in React Native** — `useVoiceSession.ts` used `new FileReader()` to convert audio blobs to base64. `FileReader` is a Web API and does not exist in the RN runtime. This caused an immediate crash whenever `sendAudioChunk()` was called.

2. **`expo-av` is a native module** — it must be compiled into the APK. When the user downloaded a fresh APK from Expo Dev Servers, if that build didn't include `expo-av` native code, importing it at module level would crash the entire JS bundle at startup.

### Fixes Applied
- **`mobile/src/hooks/useVoiceSession.ts`**: Replaced `FileReader` with `expo-file-system`'s `readAsStringAsync` (which works in RN). Also wrapped `require('expo-av')` and `require('expo-file-system')` in try/catch so missing native modules degrade gracefully instead of crashing.
- **`mobile/src/components/VoiceMode.tsx`**: Added `isNativeAvailable` check — if `expo-av` is not compiled into the current build, shows a friendly "Voice Mode requires a native build" screen instead of crashing.

### Additional Changes (same session)
- **`broadcast_update_push.ts`**: Now reads `updateHistory.json` to get real update title + bullet points for the push notification plate, so users always see full feature details.
- **`notificationService.ts`**: Added `nova_updates` channel (MAX importance) to ensure update notifications always show even when on chat screen.
- **`App.tsx`**: Update notification plate now shows full feature changelog on `nova_update` push tap, and has a fallback that always shows changelog if `lastSeenVersion` read fails.
- **`ChatScreen.tsx`**: Added `🎙️ Live` pill button in the header and styled circular mic button in the input bar.

## OTA Deployment Protocol
| # | Version | Update Group ID | Description |
|---|---------|----------------|-------------|
| 1 | v0.3.11-beta | `15dfd2cd-ae70-4337-b20d-7116f774b67d` | Voice Mode initial |
| 2 | v0.3.11-beta | `ac1f3f0` (commit) | Header Live button + notification plate |
| 3 | v0.3.11-beta | `20fc4b1a-6ec4-484d-b74c-05d81932a4b5` | **CRASH FIX** — FileReader removed, expo-av guard |

- **Git**: `main` at `461ed79`
- **Runtime version**: `1.1.0`
- **Broadcast**: Dispatched to registered devices

## Why the Old "2.0.0" APK
The user saw version `2.0.0` in the Expo Dev Client APK. This is a **different build profile** — the Expo Dev Client bundles all installed native modules. The production OTA (`runtimeVersion: 1.1.0`) should now apply correctly to the APK they have installed if it was built from the same `appVersion: 1.1.0`.

**If crash persists**: The APK may have a different `runtimeVersion` than `1.1.0`, which means the OTA won't apply. In that case, a new production APK build (`eas build --platform android --profile production`) is required.

## NEXT ACTION
- Wait for user to confirm the crash is fixed after app reload.
- If user still sees crash → trigger a new `eas build` for a fresh production APK.
