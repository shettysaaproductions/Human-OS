# CURRENT TASK

## Task ID
FRONTEND-CHAT-BUGFIXES-LIFESTYLE-OVERHAUL

## Objective
Find and fix critical front-end bugs in the chat section, protect SecureStore offline message cache from base64 image overflow, optimize FlatList scroll to 60fps, wire up 1-tap retry for failed messages, and build the Lifestyle Onboarding Hub and Smart Quick Actions Bar to transform Nova into an autonomous smart living companion for diverse lifestyles (fitness, students, work, pet parents, creative, daily habits).

## Scope
- Keep `main` as the production source of truth.
- Implement 1-tap message retry on red `❌` status icon and dedicated `↺ Tap to retry` button in `mobile/src/screens/ChatScreen.tsx`.
- Expand `retryMessage` in `mobile/src/store/useChatStore.ts` to support both `status === 'error'` and `status === 'failed'`.
- Sanitize `image_base64` before persisting to `SecureStore` in `saveMessageCache` and `savePendingQueue` to prevent size limit drops.
- Implement deterministic comparator `compareMessagesDeterministic` for stable message sorting and chunk part ordering.
- Fix `formatTime` and `formatDateSeparator` with `isNaN(date.getTime())` validation.
- Optimize FlatList scroll with a persistent `useRef` Animated event listener and `scrollEventThrottle={16}`.
- Fix `KeyboardAvoidingView`: `behavior={Platform.OS === 'ios' ? 'padding' : undefined}`.
- Overhaul `ListEmptyComponent` into a dynamic **Lifestyle Onboarding Hub** with 6 tracks (Fitness, Student, Work, Pet Parent, Creative, Habits).
- Add floating **Smart Quick Actions Bar** with 1-tap shortcuts (`⏰ Remind`, `🎯 Goal`, `📝 Note`, `🌿 Routine`, `🧠 Brain Galaxy`).
- Add draft clear button `✕` and character limit warning to `TextInput`.
- Fix `LiveThinkingIndicator` unmount timeout leak and `ThoughtBubble` theme alignment.
- Verify 100% clean TypeScript build in both `mobile` and `backend`, and passing unit test suites.

## Approved Code
All changes pass `cd backend && npm run build` (code 0), `cd mobile && npx tsc --noEmit` (code 0), and 62/62 backend unit tests.

## Autonomous Deployment
Standing user directive: automatically commit, merge, and push to `origin main`.
Push to `main` triggers Render backend deployment and GitHub Actions Mobile EAS OTA update.
