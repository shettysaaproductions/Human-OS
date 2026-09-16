# CURRENT HANDOFF

## Last Updated
2026-09-16 — Indestructible Voice Cards & WhatsApp-Style Persistent Audio Caching (v0.3.29-beta)

## Session / Agent
Agent: MonkeyCode
Branch: `main`

## Status: VERIFIED & PRODUCTION DEPLOYED (OTA v0.3.29-beta Published + Broadcasted)

### EAS Production OTA Deployment (v0.3.29-beta)
- **Update Group ID**: `bdbe6068-68ef-4f6c-99fb-2d84c7dc9bb6`
- **Android Update ID**: `01a0aa91-3359-78bb-acfe-8cca1e46170a`
- **iOS Update ID**: `01a0aa91-3359-7e84-90a8-b0494c7a6cb8`
- **Runtime Version**: `1.1.0`
- **Branch**: `production`
- **Broadcast Push**: Dispatched to registered devices via `broadcast_update_push.ts`.

---

### Critical Problems Solved & Core Invariants Enforced (v0.3.29-beta)

1. **Indestructible WhatsApp-Style Voice Card UI**:
   - **Diagnosis**: After navigating away to the Brain section (e.g. Brain Galaxy) and returning to Chat, voice note cards and play buttons completely disappeared, degrading to plain text bubbles.
   - **Root Cause**: `ChatScreen.tsx` evaluated `hasVoiceMessage = !!(item.audio_uri || item.reply_audio_base64 || (item.is_voice_message && (item.audio_base64 || item.meta?.audio_base64)) || ...)`. When navigating away, `saveMessageCache` purposefully deleted large `audio_base64` strings before writing to SecureStore to respect device quotas. On unmount/remount, `loadMessageCache` restored messages with `audio_base64: undefined` and without a preserved `audio_uri`, evaluating `hasVoiceMessage` to `false` and destroying the voice card UI.
   - **Fix**: Hardcoded voice note card rendering to depend strictly on message classification invariants: `item.is_voice_message || item.meta?.is_voice_message || item.meta?.is_voice_reply || item.audio_uri || item.audio_base64 || item.reply_audio_base64 || item.meta?.audio_base64`. Like WhatsApp, once a message is a voice note, its card and play button **never** disappear under any screen transition or cache reload.

2. **Persistent Local Disk Audio Caching (`expo-file-system`)**:
   - **Fix**: Implemented `getLocalVoiceUri(messageId)` and `writeVoiceFileIfPresent(messageId, b64)` in `useChatStore.ts`. Incoming base64 audio chunks are immediately saved to local persistent disk storage (`${FileSystem.cacheDirectory}voice_${messageId}.wav`) and assigned to `audio_uri`.
   - **SecureStore Preservation**: `saveMessageCache` preserves `audio_uri` in SecureStore (a tiny ~50-byte string), ensuring instantaneous playback after app restarts or screen transitions without consuming RAM.

3. **Dedicated On-Demand Audio Retrieval Endpoint**:
   - **Backend**: Added `GET /api/chat/:messageId/audio` in `backend/src/routes/chat.ts` to lazily fetch audio base64 and duration directly from `chat_history.meta` when needed.
   - **Frontend**: Added `chatService.getMessageAudio(messageId)` and a 3-tier fallback in `handleTogglePlayAudio` in `ChatScreen.tsx`:
     1. Play local disk URI (`file://...`) if present.
     2. Play in-memory base64 and cache to disk.
     3. Lazily fetch from backend audio endpoint, cache to disk, update store via `setAudioUri`, and play immediately with an inline activity indicator.

4. **User Message Deduplication Metadata Fix**:
   - **Diagnosis**: In `checkProactiveMessages` in `useChatStore.ts`, user message deduplication matched existing text content and ran `continue;`, dropping user voice metadata (`audio_base64`, `audio_duration`, `is_voice_message`).
   - **Fix**: Updated deduplication logic to preserve and sync voice flags, durations, and audio URIs onto existing local user messages.

---

### Verification Results

1. **Pre-flight Compilation**:
   - `cd backend && npm run build`: **0 errors (Exit 0)**
   - `cd mobile && npx tsc --noEmit`: **0 errors (Exit 0)**

2. **EAS Production OTA Publish**:
   - Successfully published to `production` branch.
   - Update Group ID: `bdbe6068-68ef-4f6c-99fb-2d84c7dc9bb6`.

3. **Push Notification Broadcast**:
   - Successfully broadcasted `v0.3.29-beta` release alert to registered devices.

---

### Files Modified

| File | Status | Description |
|---|---|---|
| `backend/src/routes/chat.ts` | **MODIFIED** | Added dedicated lazy audio retrieval endpoint `GET /api/chat/:messageId/audio` |
| `mobile/src/services/chatService.ts` | **MODIFIED** | Added `chatService.getMessageAudio(messageId)` client method |
| `mobile/src/store/useChatStore.ts` | **MODIFIED** | Added local disk caching of voice files, preserved `audio_uri` in cache, fixed user deduplication |
| `mobile/src/screens/ChatScreen.tsx` | **MODIFIED** | Permanent voice card rendering invariant, on-demand audio fallback, loading spinner |
| `mobile/src/config/updateHistory.json` | **MODIFIED** | Registered `v0.3.29-beta` changelog for in-app update notification modal |

---

### NEXT ACTION
- Push verified changes to `origin main` to deploy backend updates to Render.
