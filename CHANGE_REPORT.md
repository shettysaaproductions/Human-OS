# Change Report — Tester-ready pass (0.2.5-beta)

Date: 2026-09-04

This pass wires incomplete features that docs claimed were shipped, and unblocks real-user testing of auth, chat, language, offline, and settings.

## Backend

### Rate limits (`backend/src/app.ts`)
- Global limiter raised from 100 to 1000 requests / 15 min. Chat polls history every 2s while waiting for a reply (~450 GETs per window). The old cap 429'd testers mid-conversation.
- Health checks are skipped from the global limiter.
- `chatLimiter` (10 AI posts / minute) now applies only to `POST /chat` (the send). GET history, POST `/chat/read`, reactions, and thoughts no longer share that budget.

### Language preference (`backend/src/routes/chat.ts`, `NovaBrainService.ts`)
- `ChatSchema.language` is now destructured from the request body and forwarded on `brainContext.language`.
- `NovaBrainService.processInteraction` and `streamInteraction` pass `context.language` into `promptBuilder.buildSystemPrompt` instead of hardcoded `'auto'`.
- Hindi / English prompt injection in `promptBuilder` can now actually fire.

### Reminders
- `ReminderEngine.addDuration` handles `years` and clamps month overflow (Jan 31 + 1 month no longer becomes March 2/3).
- `ReminderSchedulerService.calculateNextTrigger` same month overflow clamp, plus `years` recurrence.

## Mobile

### API base URL (`mobile/src/services/api.ts`)
- Base URL always ends with `/api`. `EXPO_PUBLIC_API_URL` with or without `/api` both work.
- Request interceptor no longer logs headers or payloads (tokens). Response bodies are not logged. Method + URL only in `__DEV__`.

### Auth hydrate (`mobile/src/store/useAuthStore.ts`)
- Network errors, timeouts, and non-401 server errors no longer wipe tokens.
- Testers stay logged in across Render cold boots and offline launches.

### Language end-to-end
- Settings: Auto / Hinglish / English selector writes `useSettingsStore`.
- `chatService.sendMessage` and `sendMessageAsync` send `language` on the payload.
- Backend forwards it into the system prompt (see above).

### Auth screens
- Login and Signup: visible placeholder color, Nova-branded dark UI, themed primary buttons (no stock `Button`).
- Signup requires password length >= 6.

### Chat / UX polish
- `OfflineBanner` shown on Chat when NetInfo reports offline.
- `ErrorBoundary` wraps the navigator (was imported and unused).
- `PreferencesScreen` is a real Settings destination ("Edit Preferences").
- Splash shows Nova / Human OS branding, not only a spinner.
- Camera permission is requested only after sign-in, and not if the OS already denied it (`canAskAgain`).
- App version stamp: `0.2.5-beta`. Changelog entry added.

## What testers should verify
1. Cold start while offline or during Render sleep: stay logged in, see offline banner on chat.
2. Send a message, wait for reply: no 429 on history polling; typing indicator clears when reply arrives.
3. Settings → Hinglish, then chat: Nova replies in casual Roman Hinglish. English forces English.
4. Login / signup placeholders readable on dark background.
5. Settings → Edit Preferences opens the onboarding fields editor.

## Deploy
- Backend: `git push origin main`, then user redeploys Render. This agent does not trigger Render.
- Mobile: `cd mobile && npx eas update --branch production --message "..."`.
- OTA channel is `production` only. Never `--branch preview`.
