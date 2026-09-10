# CURRENT TASK

## Task ID
BACKEND-CHAT-IMPACT-EXPANSION-LIFESTYLE-COMPANION

## Objective
Find and fix high-impact back-end bugs in the chat section, restore truth in active reminder queries, restore 30-day temporal conversation recall, restore new user discovery phase onboarding, clean user message vision persistence, eliminate false positive busy signal matches, preserve swipe-to-reply across history reloads, and inject deep lifestyle companion awareness (fitness, study, work, pet, creative, habit).

## Scope
- Keep `main` as the production source of truth.
- Fix active reminders truth collapse in `backend/src/routes/chat.ts` by awaiting `upcomingRemindersFullPromise` concurrently in `Promise.all` and feeding real active reminders into `upcomingDbResult`.
- Restore 30-day temporal context in `chat.ts` by awaiting `temporalPromise` in `Promise.all`.
- Restore new user Discovery Phase onboarding by awaiting `totalMemoriesPromise` in `Promise.all` rather than hardcoding `{ count: 15 }`.
- Clean user message image persistence in `chat_history` by storing original clean text in `content` and `image_description` in `meta`, removing prompt pollution and redundant `[HIDDEN_CONTEXT]` duplicate inserts.
- Add `reply_to_id, reply_to_content` to `chatRouter.get('/')` `.select(...)` so quoted swipe-to-reply headers persist across app restarts and reloads.
- Add lifestyle signal detection (`FITNESS_SIGNALS`, `STUDY_SIGNALS`, `WORK_SIGNALS`, `PET_SIGNALS`, `CREATIVE_SIGNALS`, `HABIT_SIGNALS`) and actionable lifestyle companion directives in `SituationalAwareness.ts`.
- Fix false-positive busy signal matching using `SHORT_BUSY_REGEX` so words like `assignment`, `design`, and `signal` do not match `gn`.
- Pass all verification gates: `cd backend && npm run build` (exit 0) and `cd mobile && npx tsc --noEmit` (exit 0).

## Approved Code
All changes pass `cd backend && npm run build` (code 0), `cd mobile && npx tsc --noEmit` (code 0), and all unit tests (code 0).

## Autonomous Deployment
Standing user directive: automatically commit, merge, and push to `origin main`.
Push to `main` triggers Render backend deployment and GitHub Actions Mobile EAS OTA update.

