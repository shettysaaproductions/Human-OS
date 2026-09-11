# CURRENT TASK

## Task ID
BACKEND-CHAT-COMPANION-INVARIANTS-PHASE4

## Objective
Forensically audit real Nova interaction screenshots, identify all root causes of wrong/unprompted responses, and harden backend chat architecture into an autonomous, smartest living companion across diverse lifestyles:
1. Degraded mode & fast retry prompt leak prevention (`No Formalities: Use "tu/tum/"`).
2. Hinglish temporal "Kal" past vs future disambiguation (eliminating past reminder hallucination and updating directive phrasing).
3. Circadian sanity & midnight chores ban (preventing 12:20 AM cooking / workout suggestions).
4. Entity wardrobe & plausibility grounding (preventing wife Sakshi's nail art from being attributed to 6-month infant son Shreshth).
5. 1-word habit dead-nod transformation (converting "Sahi" into proactive companion reminder offers).
6. Mistake callout unprompted topic jump guard (preventing random baby milestones when user says "I didn't understood").
7. Memory Browser age label sanity (`key: 'birth_date'` with `"6 months"` value displays as `"Age"`).
8. Female Hinglish grammatical gender agreement hardening.

## Scope
- Modify `backend/src/routes/chat.ts` (degraded mode sanitization, leak retry fallback, bubble fallback).
- Modify `backend/src/services/NovaBrainService.ts` (isPromptLeak expansion, sanitizeReply quote & gender hardening, validateAndRepairGrounding rules 7-10).
- Modify `backend/src/services/promptBuilder.ts` (temporal reasoning, circadian sanity, entity plausibility invariants).
- Modify `backend/src/services/ReminderIntentDetector.ts` (directive phrasing update).
- Modify `backend/src/routes/memoryManagement.ts` (label formatting for duration values).
- Pass all verification gates: `cd backend && npm run build` (exit 0), `cd mobile && npx tsc --noEmit` (exit 0), and 91/91 unit tests passing.

## Approved Code
All changes pass `cd backend && npm run build` (code 0), `cd mobile && npx tsc --noEmit` (code 0), and all 91 automated unit tests (code 0).

## Autonomous Deployment
Standing user directive: automatically commit, merge, and push to `origin main`.
Push to `main` triggers Render backend deployment and GitHub Actions Mobile EAS OTA update.
