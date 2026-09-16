# CURRENT HANDOFF

## Last Updated
2026-09-16 — Human Voice Companion & Zero Prompt-Leak Guard (v0.3.27-beta)

## Session / Agent
Agent: MonkeyCode
Branch: `main`

## Status: VERIFIED & PRODUCTION DEPLOYED (OTA v0.3.27-beta Published + Broadcasted)

### EAS Production OTA Deployment (v0.3.27-beta)
- **Update Group ID**: `a15ac043-cf3a-4dd1-9bcf-bb437c2eac0e`
- **Android Update ID**: `01a0aa4a-b0dd-713f-a2fc-549f83771629`
- **iOS Update ID**: `01a0aa4a-b0dd-787b-8216-97a500dfde52`
- **Runtime Version**: `1.1.0`
- **Branch**: `production`
- **Broadcast Push**: Dispatched to registered devices via `broadcast_update_push.ts`.

---

### Critical Problem Solved & Core Invariants Enforced (v0.3.27-beta)

1. **Root Cause Diagnosis**:
   - User voice note stating: *"i am in office right now"*.
   - Nova replied with verbatim system prompt leaks:
     - Bubble 1: *"SITUATIONAL TEMPORAL RULE: This conversation is happening now, and the user is currently at the office. CRITICAL TEMPORAL RULE: The user is asking about a past conversation or timestamp. 💫"*
     - Bubble 2: *"Find the answer in the archive above and tell them the exact time or context. Do NOT bring up unrelated facts from your long-term memory. 🎉"*
   - Both bubbles displayed the voice card *"Nova's Voice Reply 🎙️ 22s"*.
   - **Why this occurred**:
     1. In `backend/src/routes/chat.ts`, `TEMPORAL_KEYWORDS` had `'abhi'`. Any message with "abhi" (present tense conversational word!) or similar words falsely triggered `isTemporalQuery = true`.
     2. Line 1611 injected an aggressive prompt block: `CRITICAL TEMPORAL RULE: The user is asking about a past conversation or timestamp. Find the answer in the archive above and tell them the exact time or context...`.
     3. The LLM suffered a meta-cognitive contradiction (the user is in the office right now, but prompt dictates that the user is asking about a past conversation), resulting in the model narrating and echoing internal rules.
     4. `isPromptLeak` did not catch rule headers or archive search phrases, allowing the text to pass to TTS and client bubbles.
     5. In `mobile/src/store/useChatStore.ts` and `ChatScreen.tsx`, chunk splitting attached voice audio metadata to every chunk, causing multiple bubbles to render the audio player card.

2. **Backend Prompt Leak & Temporal Invariants**:
   - **Refined Temporal Query Detection**: Replaced greedy single keywords with strict regex patterns requiring explicit recall questions (`yaad hai`, `do you remember`, `what did you say`, `exact time`, `kab bola tha`). Present-tense conversational talk ("i am in office right now", "abhi office me hoon", "pehle ye sun") strictly evaluates to `false`.
   - **Passive Reference Block**: Replaced shouting `CRITICAL TEMPORAL RULE:` with soft, non-intrusive reference context: `## RECENT CONVERSATION ARCHIVE (Context only)`.
   - **Comprehensive Prompt Leak Detection**: Added signatures to `isPromptLeak` catching `temporal rule`, `situational temporal rule`, `critical temporal rule`, `find the answer in the archive`, and regex `/\b(?:SITUATIONAL|TEMPORAL|CRITICAL|ANTI-ROBOT|ANTI-HALLUCINATION|GROUNDING|SYSTEM)\b[^\n:]*RULE\s*:/i`.
   - **Zero-Leak Finalization Gate**: Added `isPromptLeak` check to `VoiceResponseLifecycle.finalizeTurn` and `chat.ts` line 2721/2748.
   - **Warm Human Companion Fallbacks**: Implemented `getNaturalCompanionFallback(primaryMessage, isEnglishUser)` acknowledging user context naturally ("Achha, office me ho? Kaam kaisa chal raha hai?" / "Got it, you're at the office! Hope work isn't too hectic today.") instead of robotic glitch phrases.

3. **Mobile Single Voice Card Per Turn Invariant**:
   - In `useChatStore.ts` (`formattedHistory`, `updateLocalMessageIfNeeded`, and `newMessages` realtime chunks), isolated `is_voice_message`, `audio_base64`, `audio_duration`, `reply_audio_base64`, `reply_audio_duration`, and `meta.is_voice_reply` strictly to `idx === 0` (or `_part_1`).
   - In `ChatScreen.tsx`, added `isSubsequentChunk` guard to `hasVoiceMessage` so subsequent bubbles (`_part_2`, `_part_3`, etc.) never render the voice note player card.

---

### Verification Results

1. **Automated User Office Leak Fix Suite (`backend/src/scripts/test_user_office_leak_fix.ts`)**:
   - Verified verbatim screenshot text caught by `isPromptLeak(leak1)` and `isPromptLeak(leak2)` (both `true`).
   - Verified `sanitizeReply` discards leaks cleanly (returns empty string).
   - Verified `checkTemporal("i am in office right now")` -> `false`.
   - Verified `checkTemporal("abhi office me hoon")` -> `false`.
   - Verified `checkTemporal("kal maine kya bola tha?")` -> `true`.
   - Verified `checkTemporal("do you remember what we talked about yesterday?")` -> `true`.
   - Verified genuine human conversation phrases are NOT marked as prompt leaks.

2. **Automated Voice Response Lifecycle Regression Suite (`backend/src/scripts/test_voice_response_lifecycle.ts`)**:
   - **48 PASSED, 0 FAILED**.

3. **Pre-flight Compilation**:
   - `cd mobile && npx tsc --noEmit`: **0 errors (Exit 0)**
   - `cd backend && npm run build`: **0 errors (Exit 0)**

---

### Files Added / Modified

| File | Status | Description |
|---|---|---|
| `backend/src/routes/chat.ts` | **MODIFIED** | Refined temporal recall detection, softened archive context block, added `getNaturalCompanionFallback`, guarded voice finalization against prompt leaks |
| `backend/src/services/NovaBrainService.ts` | **MODIFIED** | Expanded `isPromptLeak` and `sanitizeReply` to catch and strip situational/temporal rule leaks |
| `backend/src/services/VoiceResponseLifecycle.ts` | **MODIFIED** | Added `isPromptLeak` check to `finalizeTurn` gate |
| `mobile/src/store/useChatStore.ts` | **MODIFIED** | Restricted voice audio metadata strictly to `idx === 0`, preventing audio card duplication on split bubbles |
| `mobile/src/screens/ChatScreen.tsx` | **MODIFIED** | Added `isSubsequentChunk` guard to voice player card renderer |
| `mobile/src/config/updateHistory.json` | **MODIFIED** | Added `v0.3.27-beta` release notes for in-app update notification modal |
| `backend/src/scripts/test_user_office_leak_fix.ts` | **NEW** | Regression test verifying office scenario, temporal patterns, and prompt leak eradication |

---

### NEXT ACTION
- All changes verified, committed, EAS OTA published (`a15ac043-cf3a-4dd1-9bcf-bb437c2eac0e`), and push broadcast sent.
- Push to `origin main` to trigger automatic Render backend deployment.
