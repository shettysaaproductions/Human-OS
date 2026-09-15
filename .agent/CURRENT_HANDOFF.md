# CURRENT HANDOFF

## Last Updated
2026-09-15 — v0.3.19-beta OTA & Backend WebSocket Proxy with Gemini 2.5 Live Audio

## Session / Agent
Agent: MonkeyCode
Branch: `main`
Latest commit: `350a0fa`

## Status: OTA DEPLOYING & TEST PENDING

---

### The Real Breakthrough: Root Cause Uncovered & Fixed

**PREVIOUS ISSUE**: Tap to talk to Nova → spinner runs for 30–35s → "Connection issue" / timeout.

1. **Google Gemini Live API Model Deprecation**:
   - Google **deprecated** `gemini-2.0-flash-exp` for `bidiGenerateContent` in API version `v1beta`.
   - Any WebSocket connection requesting `models/gemini-2.0-flash-exp` was immediately closed by Google with:
     `WebSocket Code 1008: "models/gemini-2.0-flash-exp is not found for API version v1beta, or is not supported for bidiGenerateContent"`.
   - Verified via Google's `ModelService.ListModels` that the current supported model for bidirectional live audio is:
     **`models/gemini-2.5-flash-native-audio-latest`**.
   - Verified via standalone Node script that WebSocket connections with `models/gemini-2.5-flash-native-audio-latest` open immediately, return `setupComplete`, and stream two-way audio (`audio/pcm;rate=24000`) without errors.

2. **Keys (AQ. vs AIzaSy) Clarification**:
   - The user's Google Cloud project credentials starting with `AQ.` (OAuth/service credentials) **DO WORK** for Gemini Live WebSocket connections when the supported model is specified.
   - The failures previously attributed to key format were actually caused by Google rejecting the outdated model name `gemini-2.0-flash-exp`.

3. **Backend WebSocket Proxy Architecture**:
   - Implemented `NovaVoiceProxy.ts` at `/voice/ws`.
   - Mobile connects via `wss://[backend]/voice/ws?token=JWT&voice=Kore`.
   - Backend authenticates JWT, enriches with memory context and voice tools, connects to Gemini Live, and relays frames bidirectionally.
   - Mobile no longer connects directly to Google or exposes keys client-side.


---

### OTA / Deployment Record

| Version | Update Group ID | Android Update ID | Commit |
|---|---|---|---|
| v0.3.19-beta | d2f2b44a-96d9-4f93-b4cd-a4bfbf3a9817 | 01a0a3f7-b57a-74d3-8cbf-17936be9dbd7 | 65ceed6 |
| v0.3.16-beta | e3dd1dd5-f437-46f3-a0dc-6d942a9f2a67 | 01a0a057-b66e-7354-92e6-a4aa7268a51a | 324e69e |
| v0.3.15-beta | 48c6db6f-f465-4c7f-96a7-8b2632a50cd4 | 01a0a043-3693-7b91-9bca-8303b9471d8b | d34d8c1 |
| v0.3.14-beta | (prev session) | — | a3c1e9e |

---

### Files Modified This Session

| File | Change |
|---|---|
| `backend/src/lib/geminiLivePool.ts` | Skip authTokens.create; return raw API key directly |
| `mobile/src/hooks/useVoiceSession.ts` | File-based WAV playback; AudioModule fix; timeout 35s |
| `mobile/src/config/updateHistory.json` | v0.3.15 + v0.3.16 entries |

---

### Expected Flow After v0.3.16

1. User taps mic
2. Backend `/api/voice/session` → returns API key directly (no authTokens.create crash)
3. Mobile opens WebSocket to Gemini Live with that key
4. `setupComplete` received → "Listening..." state
5. User speaks → 16kHz float32→int16 PCM streamed to Gemini
6. Gemini responds → 24kHz PCM chunks written to temp `.wav` files → played via ExoPlayer

### NEXT ACTION
**User must test v0.3.16-beta**:
- Restart app and tap mic
- First attempt may take 20-30s if Render is cold (server wakes up → session returns → WS connects)
- Should reach "Listening..." and Nova should speak

### If Still Failing
Run `adb logcat | grep -E "VoiceSession|ExoPlayer|AudioPlayer"` and share output.
Key log lines to look for:
- `[VoiceSession] Session config received` → backend is working
- `[VoiceSession] WebSocket opened` → WS connected
- `[VoiceSession] setupComplete received` → Gemini ready
- `[VoiceSession] Playing chunk #1 from file` → playback started
