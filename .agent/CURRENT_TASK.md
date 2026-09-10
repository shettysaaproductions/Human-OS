# CURRENT TASK

## Task ID
FRONTEND-CHAT-IMPACT-EXPANSION-LIFESTYLE-COMPANION

## Objective
Find and fix high-impact front-end bugs in the chat section, implement in-bubble attached image rendering with a full-screen zoom modal, provide live in-chat keyword search, build an autonomous stop generation/abort action, prevent double-send race conditions, add floating copy feedback, enable keyboard dismissal on drag, and expand the smart lifestyle companion actions for all user personas.

## Scope
- Keep `main` as the production source of truth.
- Render attached photos (`image_uri`, `image_base64`, `meta.image_url`) inside message bubbles with a full-screen interactive zoom modal on tap.
- Add `image_uri?: string` to `Message` in `mobile/src/store/useChatStore.ts` and ensure lightweight local paths survive cache persistence without overflowing SecureStore.
- Build live in-chat search with keyword matching, match counter badge, and clear controls.
- Implement `abortGeneration()` in `useChatStore.ts` and wire a glowing Stop button (⏹️) when Nova is thinking to give users instant control.
- Prevent rapid double-tap duplicate message sends with a 400ms debounce guard.
- Add `keyboardDismissMode="on-drag"` to `<FlatList>` for smooth natural keyboard dismissal while scrolling.
- Add floating copy confirmation toast for code blocks, tables, and message selections.
- Add unread message indicator badge to the scroll-to-bottom FAB when new responses arrive while scrolled up.
- Expand `QUICK_ACTION_CHIPS` to cover all 6 core lifestyle personas (Workout, Study, Work, Pet Care, Idea, Routine, Remind, Goal, Brain Galaxy).
- Verify 100% clean builds in both `mobile` (`npx tsc --noEmit`) and `backend` (`npm run build`).

## Approved Code
All changes pass `cd backend && npm run build` (code 0) and `cd mobile && npx tsc --noEmit` (code 0).

## Autonomous Deployment
Standing user directive: automatically commit, merge, and push to `origin main`.
Push to `main` triggers Render backend deployment and GitHub Actions Mobile EAS OTA update.
