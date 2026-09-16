# CURRENT TASK

## Task ID
VOICE-INDESTRUCTIBLE-CARDS-PERSISTENT-CACHE-v0.3.29

## Objective
Implement WhatsApp-style indestructible voice note cards and play buttons that never disappear after screen transitions or app restarts, coupled with persistent disk caching and lazy on-demand audio retrieval:
1. **Root Cause**:
   - `ChatScreen.tsx` evaluated `hasVoiceMessage` using a fragile condition requiring audio data (`item.audio_uri || item.reply_audio_base64 || (item.is_voice_message && item.audio_base64)...`).
   - In `useChatStore.ts` `saveMessageCache`, base64 audio strings were intentionally stripped to stay within SecureStore storage limits.
   - When navigating to Brain Galaxy and back, `loadMessageCache()` restored messages with `audio_base64: undefined` and without saved `audio_uri`, causing `hasVoiceMessage` to evaluate to `false` and destroying the voice card and play button UI.
   - In `checkProactiveMessages`, user message deduplication dropped user voice metadata (`audio_base64`, `audio_duration`, `is_voice_message`).
2. **Implementation**:
   - Hardcoded voice card UI rendering to depend on message type invariants (`is_voice_message || meta.is_voice_message || meta.is_voice_reply`), ensuring the voice card and play button never disappear regardless of RAM state.
   - Implemented persistent disk caching via `expo-file-system/legacy` (`${cacheDirectory}voice_${id}.wav`) for all incoming voice audio, preserving `audio_uri` across SecureStore cache serialization.
   - Added backend lazy audio retrieval endpoint `GET /api/chat/:messageId/audio` in `backend/src/routes/chat.ts`.
   - Added `chatService.getMessageAudio(messageId)` and a 3-tier fallback player with inline loading indicator in `ChatScreen.tsx`.
   - Fixed user message deduplication in `checkProactiveMessages` to sync voice metadata.
   - Registered `v0.3.29-beta` in `mobile/src/config/updateHistory.json`.

## Verification Gates Passed
- `cd backend && npm run build`: **EXIT 0** (0 errors).
- `cd mobile && npx tsc --noEmit`: **EXIT 0** (0 errors).
- EAS Production OTA Published: Update Group `bdbe6068-68ef-4f6c-99fb-2d84c7dc9bb6` (Android `01a0aa91-3359-78bb-acfe-8cca1e46170a`, iOS `01a0aa91-3359-7e84-90a8-b0494c7a6cb8`).
- Push broadcast dispatched to all registered user devices via `broadcast_update_push.ts`.
