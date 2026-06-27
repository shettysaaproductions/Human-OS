# Release Notes: Beta Polish Sprint

**Version:** v0.2.1-beta  
**Date:** 2026-06-28  
**Commit:** `a70de6c` · `feat: Beta Polish Sprint`  
**Branch:** `main → production`  
**EAS Branch:** production

---

## Summary

This release transforms Nova from a feature-complete prototype into a **production-ready companion** for real users. No new major features — only stability, polish, and observability.

---

## Part 1 — Crash Protection

### ErrorBoundary (`mobile/src/components/ErrorBoundary.tsx`)
- Root-level React class `ErrorBoundary` wraps the entire `NavigationContainer`
- Catches any unhandled render error in the component tree
- Shows a graceful fallback UI with an emoji, error message, and **Try Again** button
- Calls optional `onError` callback for upstream telemetry

### API Hardening (`mobile/src/services/api.ts`)
- Added **15-second request timeout** — prevents indefinite hangs on slow backend (Render cold starts)
- Added **automatic retry** with exponential backoff for pure network errors (no response received)
  - Up to 2 retries: 1s then 2s delay
  - Does not retry on 4xx/5xx responses (avoids duplicate side-effects)

### Loading skeletons (`mobile/src/components/Skeleton.tsx`)
- `Skeleton` — animated shimmer placeholder for any width/height
- `CardSkeleton` — shimmer card matching dashboard item dimensions
- `StatSkeleton` — shimmer 3-stat row
- `ListSkeleton` — composed skeleton for full screen loading states
- All use `Animated.loop` with native driver for 60fps on UI thread

### Empty States (`mobile/src/components/EmptyState.tsx`)
- `EmptyState` — reusable component with emoji, title, subtitle, and optional action button
- `OfflineBanner` — amber banner shown when network is unavailable
- Used by Goal Brain, Life Timeline, Memory Management, and Founder Dashboard

---

## Part 2 — Telemetry

### Backend: `POST /telemetry`
Accepts client-side events silently (never crashes the app if it fails):

| event_type | Trigger |
|---|---|
| `app_open` | Every ChatScreen mount (once per session) |
| `crash` | ErrorBoundary catch |
| `api_failure` | Can be sent from any screen on error |
| `memory_error` | Memory retrieval failures |
| `reflection_failure` | Reflection load failures |
| `moment_failure` | Moment delivery failures |

### Backend: `GET /admin/errors`
- Aggregates last 7 days of telemetry events
- Returns `byType` breakdown, `errors24h`, `appOpens7d`, and `recentErrors` (last 10)
- Cached 60s to prevent dashboard hammering

### Database: `telemetry_events` table (`010_beta_polish.sql`)
- Stores: `event_type`, `event_data (JSONB)`, `platform`, `app_version`, `user_id`, `created_at`
- Indexed on `user_id`, `event_type`, `created_at`

---

## Part 3 — Settings Screen (`mobile/src/screens/SettingsScreen.tsx`)

Full settings screen accessible via ⚙️ from Chat header.

| Section | Contents |
|---|---|
| ⚡ Moments & Notifications | Toggle: moment notifs, reflection notifs, goal check-ins, quiet hours |
| 🔒 Privacy | Privacy policy info, data storage explanation |
| 📦 Data | Export my data, Manage Memories, Delete all data (confirmation) |
| 💬 Feedback | Links to FeedbackScreen, email team |
| ℹ️ About Nova | Version, build, Developer Mode toggle |
| 🛠 Developer Mode | Reveals links to Diagnostics + Founder Dashboard |

---

## Part 4 — Feedback Screen (`mobile/src/screens/FeedbackScreen.tsx`)

Full-page feedback submission form:

- **Type picker**: Bug Report 🐛 / Feature Idea 💡 / Emotional Reaction 💭 / General 💬
- **Message textarea**: placeholder adapts to selected type
- **Star rating**: 1–5 stars, optional
- Submits to `POST /feedback` → stored in `user_feedback` table
- Shows graceful thank-you `Alert` on success, error message on failure

### Backend: `POST /feedback` + `GET /feedback`
- Stores: `user_id`, `feedback_type`, `message`, `rating`, `created_at`
- `GET /feedback` returns last 100 entries (admin-only)

### Database: `user_feedback` table (`010_beta_polish.sql`)
- `feedback_type` CHECK constraint: `bug | idea | emotional_reaction | general`
- `rating` CHECK: 1–5 or NULL
- Indexed on `user_id` and `feedback_type`

---

## Part 5 — Data Export (`backend/src/routes/export.ts`)

`GET /memories/export` — returns all user data in one call:
- `memories[]` — all memory entries with type, importance, confidence
- `reflections[]` — all daily and weekly reflection summaries  
- `moments[]` — all moment entries with status

Response includes counts for display in Settings, plus full `export` object for future file download.

---

## Part 6 — Chat Screen Polish (`mobile/src/screens/ChatScreen.tsx`)

Complete dark mode redesign:

| Before | After |
|---|---|
| White background, system blue bubbles | `#09090B` background, purple branded bubbles |
| Plain "Nova" header | Avatar dot + subtitle "Your AI companion" |
| System `<Button>` send | Custom purple circular send button |
| No empty state | Full empty state with onboarding copy |
| No telemetry | Tracks `app_open` silently on mount |
| No Settings button | ⚙️ navigates to new SettingsScreen |

---

## Part 7 — Navigation (`mobile/src/navigation/AppNavigator.tsx`)

- Added `SettingsScreen` to main stack
- Added `FeedbackScreen` to main stack
- Wrapped entire `NavigationContainer` in `ErrorBoundary` for top-level crash protection

---

## Part 8 — Database Migration (`010_beta_polish.sql`)

Run this in Supabase SQL Editor:

```sql
-- See: backend/supabase/migrations/010_beta_polish.sql
```

Creates:
- `public.user_feedback` — stores all in-app feedback
- `public.telemetry_events` — stores crash + event telemetry

---

## Performance

- All screen lists use `removeClippedSubviews` + `windowSize={10}`
- `FlatList` `renderItem` wrapped in `useCallback`
- Skeleton animations use `useNativeDriver: true`
- `withRetry` avoids re-renders from repeated failed calls polluting component state
- Telemetry POST is fire-and-forget (wrapped in empty catch — never blocks UI)

---

## Verification

| Check | Result |
|---|---|
| `backend npx tsc --noEmit` | ✅ Clean |
| `mobile npx tsc --noEmit` | ✅ Clean |
| `git push` | ✅ `a70de6c → main` |
| `eas update --branch production` | ✅ Published |
