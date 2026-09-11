# CURRENT TASK

## Task ID
WATCHTOWER-INSPECTOR-QUALITY-AND-REPLY-COHERENCE-ENGINE-PHASE8

## Objective
Act as a strict Quality Inspector in Watchtower:
1. Inspect Nova's replies (both Version 1 pre-delivery and Version 2 reflection) for coherence, grammar, and sense.
2. Eliminate ungrammatical Hindi ("Maine samajh gaya", "purn karna", "main samajh mein aata hoon") and enforce 100% feminine first-person Hindi ("main samajh gayi", "karti hoon", "sochti hoon").
3. Eliminate contradictory conversational logic (e.g. telling a user working at the office on a target "kuch mat karo").
4. Eliminate physical meeting hallucinations ("milne ke liye wait karta hoon").
5. Eliminate multi-bubble duplication in `chat_history` by passing only individual bubble text to `scheduleReflection`.
6. Decouple hardcoded scenario prompts in Pass 2 and Pass 3 of `WatchtowerReflectionService`.
7. Remediate corrupted historical messages in the database.

## Scope
- `backend/src/services/WatchtowerInspector.ts` (NEW)
- `backend/src/services/__tests__/WatchtowerInspector.test.ts` (NEW)
- `backend/src/services/NovaBrainService.ts`
- `backend/src/services/WatchtowerReflectionService.ts`
- `backend/src/routes/chat.ts`
- `backend/scripts/remediate_corrupted_versions.ts`

## Verification Gates Passed
- `npm run build` in `backend`: EXIT 0 (0 errors).
- `npx tsc --noEmit` in `mobile`: EXIT 0 (0 errors).
- `WatchtowerInspector` Unit Test Suite: 10/10 PASSED (100%).
- Existing backend test suites (`BackendChatCompanionHardening.test.ts`, `watchtowerReflection.test.ts`, `NovaBrainService.test.ts`): 53/53 PASSED (100%).
- Live historical database remediation executed cleanly.

## Autonomous Deployment
Standing user directive: automatically commit, merge, and push to `origin main`.
Push to `main` triggers Render backend deployment and GitHub Actions Mobile EAS OTA update.
