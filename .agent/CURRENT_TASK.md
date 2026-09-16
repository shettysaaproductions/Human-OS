# CURRENT TASK

## Task ID
VOICE-PROMPT-LEAK-ERADICATION-TEMPORAL-FIX-v0.3.27

## Objective
Eradicate verbatim system prompt / rule leaks from voice note replies, refine temporal intent detection so present-tense conversational status never triggers archive queries, ensure warm human companion dialogue, and eliminate duplicate voice player cards across split bubbles:
1. **Root Cause**:
   - Spoken user input *"i am in office right now"* matched `'abhi'` in `TEMPORAL_KEYWORDS`.
   - `chat.ts` injected shouting prompt `CRITICAL TEMPORAL RULE: The user is asking about a past conversation or timestamp...`.
   - The LLM had a cognitive clash with the user's present location, reciting internal rule text into the answer.
   - `isPromptLeak` did not catch rule headers or archive search phrases, allowing the text to be spoken and displayed in two bubbles.
   - Mobile store spread voice audio metadata to both split chunks, creating two identical voice note cards.
2. **Implementation**:
   - Refactored `chat.ts` `isTemporalQuery` with strict regex `TEMPORAL_RECALL_PATTERNS` requiring explicit question/recall intent.
   - Replaced shouting `CRITICAL TEMPORAL RULE:` with passive reference guidance.
   - Expanded `isPromptLeak` in `NovaBrainService.ts` to detect rule headers, situational/temporal rule fragments, and directive leaks.
   - Added `isPromptLeak` check to `VoiceResponseLifecycle.finalizeTurn` and `chat.ts` voice finalization gate.
   - Implemented `getNaturalCompanionFallback` for warm, empathetic responses ("Achha, office me ho? Kaam kaisa chal raha hai?").
   - Restricted audio metadata in `useChatStore.ts` and `ChatScreen.tsx` strictly to `idx === 0`, completely preventing audio player duplication on subsequent chunks.
   - Registered `v0.3.27-beta` in `updateHistory.json`.

## Verification Gates Passed
- `backend/src/scripts/test_user_office_leak_fix.ts`: **ALL TESTS PASSED**.
- `backend/src/scripts/test_voice_response_lifecycle.ts`: **48 PASSED, 0 FAILED**.
- `cd backend && npm run build`: **EXIT 0** (0 errors).
- `cd mobile && npx tsc --noEmit`: **EXIT 0** (0 errors).
- EAS Production OTA Published: Update Group `a15ac043-cf3a-4dd1-9bcf-bb437c2eac0e` (Android `01a0aa4a-b0dd-713f-a2fc-549f83771629`, iOS `01a0aa4a-b0dd-787b-8216-97a500dfde52`).
- Push broadcast dispatched to all registered user devices via `broadcast_update_push.ts`.
