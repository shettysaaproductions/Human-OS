# CURRENT TASK

## Task ID
VOICE-RAPID-SYNC-ZERO-DESYNC-v0.3.28

## Objective
Optimize multimodal voice note processing speed to <15s, fix real-time voice play button rendering without app restart, guarantee zero audio/text desync, and eliminate duplicate chat bubble rendering:
1. **Root Cause**:
   - `transcribeAudio` sequentially tried up to 20 candidate API keys with 12s timeout each, and `synthesizeVoiceReply` had 45s timeouts, causing voice note requests to exceed mobile's 120s polling ceiling and showing the soft-timeout error.
   - `useChatStore.ts` line 1136 used nullish coalescing `m.is_voice_message ?? !!(...)` which evaluated to `false` when `m.is_voice_message === false`, hiding the play button until app restart.
   - Watchtower Pass 3 updated message content to Version 2 in `chat_history` without regenerating `audio_base64`, causing the play button to speak Version 1 audio while displaying Version 2 text.
   - `hydrateMessages` assigned `_part_1` even for single messages, while polling assigned `msg.id`, causing ID mismatches and duplicate bubbles on screen.
2. **Implementation**:
   - Bounded `transcribeAudio` candidate attempts to 3 (6s timeout = max 18s failover) and tightened `synthesizeVoiceReply` timeout dynamically to 12s-22s max.
   - Replaced nullish coalescing with boolean OR in `updateLocalMessageIfNeeded` and enabled dynamic audio metadata sync to render the play button immediately.
   - Guarded Watchtower reflection in `chat.ts` and `WatchtowerReflectionService.ts` to skip spoken voice replies, preserving 1:1 audio-text fidelity.
   - Standardized single-message IDs to `msg.id` across `hydrateMessages`, `loadMoreMessages`, and polling, preventing duplicate bubble rendering.
   - Added in-place content update support in `updateLocalMessageIfNeeded` for text messages.
   - Registered `v0.3.28-beta` in `updateHistory.json`.

## Verification Gates Passed
- `cd backend && npm run build`: **EXIT 0** (0 errors).
- `cd mobile && npx tsc --noEmit`: **EXIT 0** (0 errors).
- EAS Production OTA Published: Update Group `f85d0f4f-a8ac-448d-ad3f-8e713d97b791` (Android `01a0aa6e-7ed3-714f-a6d5-8a03073a14c8`, iOS `01a0aa6e-7ed3-7c48-8813-4bd732a0d25a`).
- Push broadcast dispatched to all registered user devices via `broadcast_update_push.ts`.
