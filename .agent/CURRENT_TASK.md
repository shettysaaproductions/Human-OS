# CURRENT TASK

## Task ID
NOVA-VOICE-LIVE-STREAM-BREAKTHROUGH-v0.3.19

## Objective
Fix Nova Voice Mode end-to-end:
1. **Root Cause Discovered & Resolved**:
   - Google deprecated `gemini-2.0-flash-exp` for bidirectional live audio (`bidiGenerateContent`) in the Gemini Live v1beta API.
   - Any client attempting to open a WebSocket with `model: 'models/gemini-2.0-flash-exp'` was instantly closed with WebSocket code 1008: `models/gemini-2.0-flash-exp is not found for API version v1beta, or is not supported for bidiGenerateContent`.
   - Verified via Google's `ModelService.ListModels` that the official active model for live bidirectional audio is **`models/gemini-2.5-flash-native-audio-latest`**.
   - Direct end-to-end WebSocket test with `models/gemini-2.5-flash-native-audio-latest` confirmed full bidirectional streaming audio (receiving `audio/pcm;rate=24000` chunks).
2. **Backend WebSocket Proxy Architecture**:
   - Implemented secure backend WebSocket proxy (`backend/src/services/NovaVoiceProxy.ts`) attached to the HTTP server at `/voice/ws`.
   - Mobile client connects to `wss://[backend]/voice/ws?token=[JWT]&voice=[voiceName]`.
   - Backend validates Supabase JWT, loads user memory context and tool definitions, connects upstream to Gemini Live, sends setup frame, and bidirectionally relays audio and client content.
   - Keys from `geminiLivePool` and Google Cloud OAuth credentials (`AQ.` prefix) are fully accepted and managed securely on the server.
3. **Mobile Client Updates**:
   - `mobile/src/hooks/useVoiceSession.ts`: Replaced direct Google WebSocket connection with backend proxy WebSocket connection.
   - Converted `prefetchSession` into a lightweight server warm-up health ping (`/health`) to prevent cold-start delays.
   - Handled proxy errors and graceful teardown.
   - Updated `updateHistory.json` with `v0.3.19-beta` changelog.

## Verification Gates Passed
- Direct WebSocket Node test with `AQ.` key and `models/gemini-2.5-flash-native-audio-latest`: **100% SUCCESS** (`setupComplete` received, audio chunks received at 24kHz PCM, turn complete).
- `cd backend && npm run build`: **EXIT 0** (0 errors).
- `cd mobile && npx tsc --noEmit`: **EXIT 0** (0 errors).
- Git pushed to `origin main` (commit `350a0fa`).

