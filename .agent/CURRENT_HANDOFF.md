# CURRENT HANDOFF

## Last Updated
2026-09-14 — Voice Engine Root-Cause Fix (v0.3.15-beta) — OTA deployed (48c6db6f)

## Session / Agent
Agent: MonkeyCode
Branch: `main`
Commit: `d34d8c1`

## Current Task: COMPLETE — Nova Voice Audio Playback Root-Cause Fixed

---

### Full Root Cause Chain (all versions)

**v0.3.12-beta** — "Listening..." state reached, but no audio heard in either direction.
- **Mic**: `createRecording()` doesn't exist in expo-audio@56 → null → no mic audio to Gemini
- **Playback**: `player.playing` poll deadlocked the queue → no chunks ever played

**v0.3.13-beta** — Stuck at "Connecting to Nova..." (MonkeyCode regression).
- **Root cause**: `await setAudioModeAsync()` hangs indefinitely on Android audio focus conflict
- Fix: made fire-and-forget (non-blocking)

**v0.3.14-beta** — "Connecting" fixed, "Listening" reached, mic streams — but still no audio from Nova.
- **Root cause (CRITICAL)**: `createAudioPlayer({ uri: 'data:audio/wav;base64,...' })` fails silently on Android.
  ExoPlayer's `ProgressiveMediaSource` cannot infer MIME type from a `data:` URI scheme.
  The player is created, `.play()` is called, but ExoPlayer internally errors and plays nothing.
  No JS exception thrown. No log. Completely silent failure.
- **Additional root cause**: `!player.playing && currentTime > 0` polling condition never fires for
  short audio chunks because `currentTime` resets to 0 at end of playback.
- **Additional**: No `interruptionMode: 'doNotMix'` → audio could route to earpiece instead of speaker.

---

### Fixes Applied (v0.3.15-beta, commit d34d8c1)

| # | Bug | Fix |
|---|---|---|
| 1 | `data:` URI playback silently fails on Android (ExoPlayer can't detect MIME) | Write WAV bytes to temp file in `expo-file-system` cache dir; play from `file://` URI |
| 2 | expo-file-system legacy API `writeAsStringAsync`/`cacheDirectory` throws at runtime in v56 | Use new v56 API: `new File(Paths.cache, name).write(Uint8Array)` |
| 3 | `interruptionMode` missing → possible earpiece routing | Added `interruptionMode: 'doNotMix'` to `setAudioModeAsync` |
| 4 | `AudioModule` access via build path may fail in OTA bundles | Try `ExpoAudio.AudioModule` first (re-exported at ExpoAudio.js:565), fall back to build path |
| 5 | Poll condition `!playing && currentTime > 0` never fires for short chunks | Changed to `isLoaded && !playing` after 3 warmup ticks (200ms interval) |
| 6 | Temp file cleanup | `tmpFile.delete()` in `cleanAndAdvance`; session end scans `Paths.cache.list()` |

---

### OTA / Deployment Record

| Version | OTA Update Group ID | Android | iOS | Commit |
|---|---|---|---|---|
| v0.3.15-beta | 48c6db6f-f465-4c7f-96a7-8b2632a50cd4 | 01a0a043-3693-7b91-9bca-8303b9471d8b | 01a0a043-3693-76ed-8648-bc82e5bc6429 | d34d8c1 |
| v0.3.14-beta | (previous session) | — | — | a3c1e9e |

---

### Files Modified

- `mobile/src/hooks/useVoiceSession.ts` — Full root-cause fix (v0.3.15)
- `mobile/src/config/updateHistory.json` — v0.3.15-beta changelog entry added

---

### NEXT ACTION

**User must test v0.3.15-beta**:
1. Restart the app (or wait for OTA to load — shown by in-app modal)
2. Tap mic → should reach "Listening..." quickly (same as v0.3.14)
3. Speak → Nova should hear and **reply with voice through the speaker**
4. If Nova still silent: share logcat (`adb logcat | grep VoiceSession`) so we can see:
   - `AudioStream started ✓` → mic is working
   - `Playing chunk #N from file` → playback is being attempted
   - `Chunk #N done (event)` → ExoPlayer confirmed playback
   - Any `Chunk playback error` lines → ExoPlayer-level failure

### Known Remaining Issue
- Broadcast push notification sent WITHOUT `EXPO_ACCESS_TOKEN` → FCM V1 may reject it.
  OTA will still be delivered on next app launch / foreground.
