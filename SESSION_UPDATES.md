# Human OS — Session Update Log

> **Purpose:** This file is a running log of all significant changes made to the project.  
> Any new Antigravity session should **read this file first** before making changes, to avoid duplicating work or breaking existing fixes.

---

## Session: 2026-06-27

### Summary
Fixed the critical bug where pressing **Finish** on the onboarding screen showed `"Unauthorized: Invalid token"` even though authentication was working. Implemented full silent token refresh. Configured EAS Update for future OTA deployments. Triggered a preview APK build.

---

## 🐛 Bug Fixed: Onboarding Finish → "Unauthorized: Invalid token"

### Root Cause 1 — Token Expiry (Primary)
Supabase access tokens expire after **1 hour**. The app never stored the `refresh_token`, so when a user spent time on onboarding and then pressed Finish, the expired token caused a 401 on `POST /onboarding`. With no refresh mechanism, the error surfaced directly to the user.

### Root Cause 2 — Duplicate `authenticateUser` Middleware
In `backend/src/app.ts` line 95:
```ts
app.use('/onboarding', authenticateUser, onboardingRouter);  // ← middleware applied here
```
And inside `backend/src/routes/onboarding.ts` (old code):
```ts
onboardingRouter.post('/', authenticateUser, ...);  // ← duplicate! now removed
```
The duplicate was harmless but has been cleaned up.

### Why Render Showed No Request Logs
The request **was** reaching Render. The 401 was being returned by the backend's own auth middleware (`supabaseAdmin.auth.getUser(token)` failing on an expired token). The error message `"Unauthorized: Invalid token"` is defined in `backend/src/middleware/auth.ts` line 20. Render logs may have been delayed or filtered.

---

## 📁 Files Changed This Session

### Backend

#### `backend/src/routes/auth.ts`
- **Added:** `POST /auth/refresh` endpoint
- Accepts `{ refresh_token }` in the request body
- Calls `supabaseAnon.auth.refreshSession({ refresh_token })`
- Returns `{ access_token, refresh_token, user }` on success
- Returns `401` if the refresh token is expired (user must re-login)
- This endpoint requires **no Authorization header** — it's the mechanism to get a new one

#### `backend/src/routes/onboarding.ts`
- **Removed:** duplicate `authenticateUser` middleware from both route handlers
- Authentication is already applied at the app level in `app.ts` (`app.use('/onboarding', authenticateUser, onboardingRouter)`)
- Removed the unused `import { authenticateUser }` import

---

### Mobile

#### `mobile/src/services/api.ts` ⭐ Most Important Change
- **Added:** Response interceptor for automatic silent token refresh
- When any API call returns **401**:
  1. Reads `refreshToken` from SecureStore
  2. Calls `POST /auth/refresh` directly (using plain axios, not the `api` instance, to avoid interceptor loops)
  3. Saves new `accessToken` + `refreshToken` to SecureStore
  4. Updates `api.defaults.headers.common['Authorization']` with new token
  5. Drains any queued requests that arrived during the refresh
  6. Retries the original failed request automatically
  7. If refresh also fails → wipes both tokens → app navigates to Login screen
- Uses a `isRefreshing` flag + `pendingQueue` to prevent multiple simultaneous refresh calls
- Skips retry logic for the `/auth/refresh` call itself (prevents infinite loop)

```ts
// Key SecureStore keys used:
'accessToken'   // Supabase JWT (expires in 1 hour)
'refreshToken'  // Supabase refresh token (expires in 60 days)
```

#### `mobile/src/services/authService.ts`
- **Added:** `refresh(refreshToken: string)` method — calls `POST /auth/refresh`
- All existing methods (`login`, `signup`, `getMe`) unchanged

#### `mobile/src/store/useAuthStore.ts`
- **Changed:** `login()` signature now accepts `(accessToken, refreshToken, user)` (was `(accessToken, user)`)
- **Changed:** `login()` now saves both `accessToken` and `refreshToken` to SecureStore
- **Changed:** `hydrate()` now uses a two-phase recovery strategy:
  1. Read `accessToken` → try `/auth/me` → success → restore session
  2. If that fails (expired) → read `refreshToken` → call `/auth/refresh` → restore session with new tokens
  3. If both fail → wipe tokens → send to Login screen
- **Changed:** `logout()` now deletes both `accessToken` and `refreshToken` from SecureStore

#### `mobile/src/screens/LoginScreen.tsx`
- **Changed:** `login(data.access_token, data.user)` → `login(data.access_token, data.refresh_token, data.user)`

#### `mobile/src/screens/SignupScreen.tsx`
- **Changed:** `login(data.access_token, data.user)` → `login(data.access_token, data.refresh_token, data.user)`

#### `mobile/src/services/onboardingService.ts`
- Temporarily added debug logging (since removed)
- Currently clean — just calls `api.post('/onboarding', answers)` and `api.get('/onboarding/status')`

---

## ⚡ EAS Update (OTA) — Configured

### What was configured
EAS Update allows future **JavaScript-only changes** to be pushed to installed apps without requiring a new APK build.

#### `mobile/package.json`
- **Added:** `expo-updates` package (SDK 56 compatible, installed via `npx expo install expo-updates`)

#### `mobile/app.json`
- **Added:** `updates` block:
  ```json
  "updates": {
    "url": "https://u.expo.dev/17e73685-4785-47b5-8302-82d1df185f8c",
    "fallbackToCacheTimeout": 0,
    "checkAutomatically": "ON_LOAD"
  }
  ```
- **Added:** `runtimeVersion` policy:
  ```json
  "runtimeVersion": { "policy": "appVersion" }
  ```
- **Added:** `"expo-updates"` to the plugins array

#### `mobile/eas.json`
- **Added:** `"channel"` field to all three build profiles:
  - `development` → channel: `"development"`
  - `preview` → channel: `"preview"`
  - `production` → channel: `"production"`

### How to push an OTA update (future sessions)
```powershell
cd "c:\Users\HP-3\Documents\Human Os\mobile"

# For preview builds (APK testing):
eas update --channel preview --message "describe what changed"

# For production:
eas update --channel production --message "describe what changed"
```

### When a full rebuild IS required
OTA only works for JS changes. A new `eas build` is required if you:
- Add a new Expo native module (e.g., `expo-camera`, `expo-location`)
- Change `app.json` permissions or native config
- Change Android package name
- Upgrade Expo SDK version

---

## 🏗️ Build in Progress (as of this session)

A preview APK build was triggered:
- **Build URL:** https://expo.dev/accounts/shettysaa/projects/mobile/builds/e86b307e-f7dd-4017-90bd-db033eade5fe
- **Profile:** `preview` (internal distribution, APK format)
- **Channel:** `preview`
- **Platform:** Android

**After this APK is installed**, the user must log in once (to populate both `accessToken` and `refreshToken` in SecureStore). After that, the silent refresh system is fully active.

---

## 🏛️ Project Architecture Reference

### Backend — `https://human-os-zitw.onrender.com`
- **Runtime:** Node.js + Express + TypeScript
- **Database:** Supabase (PostgreSQL)
- **Auth:** Supabase JWTs validated server-side via `supabaseAdmin.auth.getUser(token)`
- **Deployed on:** Render (auto-deploys from GitHub `main` branch)

#### Key routes
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/auth/signup` | None | Create account |
| POST | `/auth/login` | None | Sign in, returns `access_token` + `refresh_token` |
| POST | `/auth/refresh` | None | Exchange refresh token for new token pair |
| POST | `/auth/logout` | Bearer | Sign out |
| GET | `/auth/me` | Bearer | Get current user |
| POST | `/onboarding` | Bearer | Submit 6 onboarding answers |
| GET | `/onboarding/status` | Bearer | Check if onboarding completed |
| POST | `/chat/test` | Bearer | Send a chat message |

#### Middleware
- `authenticateUser` (`backend/src/middleware/auth.ts`) — validates Bearer JWT via Supabase Admin
- Applied at app level in `backend/src/app.ts` for `/onboarding`, `/chat`, `/memory/debug`

### Mobile — Expo (React Native)
- **Framework:** Expo SDK 56, React Native 0.85.3
- **State:** Zustand (`useAuthStore`, `useOnboardingStore`, `useChatStore`)
- **HTTP:** Axios with request + response interceptors in `mobile/src/services/api.ts`
- **Secure Storage:** `expo-secure-store` — stores `accessToken` and `refreshToken`
- **Navigation:** React Navigation (native stack)
- **OTA Updates:** EAS Update configured on `preview` and `production` channels
- **EAS Project ID:** `17e73685-4785-47b5-8302-82d1df185f8c`
- **EAS Owner:** `shettysaa`

#### Key files
| File | Purpose |
|------|---------|
| `mobile/src/services/api.ts` | Axios instance + auth interceptors (read this first) |
| `mobile/src/store/useAuthStore.ts` | Auth state, token persistence, hydration logic |
| `mobile/src/store/useOnboardingStore.ts` | Onboarding step state, draft persistence in SecureStore |
| `mobile/src/services/authService.ts` | login, signup, refresh, getMe |
| `mobile/src/services/onboardingService.ts` | submitOnboarding, getStatus |
| `mobile/src/screens/OnboardingScreen.tsx` | 6-step onboarding UI, Finish → submitOnboarding |
| `mobile/app.json` | Expo config, EAS project ID, OTA update URL |
| `mobile/eas.json` | EAS build profiles with channels |

---

## ✅ Known Working State (as of 2026-06-27)

- [x] Signup → saves both tokens → navigates to Onboarding
- [x] Login → saves both tokens → navigates to Chat (if onboarding done) or Onboarding
- [x] Onboarding Step 1–6 → answers saved to SecureStore draft on each step
- [x] Onboarding Finish → POST /onboarding → auto-refreshes token if expired → success
- [x] App relaunch → hydrate() silently restores session (or refreshes if token expired)
- [x] Logout → wipes both tokens from SecureStore
- [x] EAS Update configured — future JS fixes deployable without rebuild
- [x] Backend auto-deploys to Render on every push to `main`

## ⚠️ Known Limitations / Future Work

- [ ] No token refresh on the iOS platform (not built/tested yet — only Android APK)
- [ ] No push notifications configured
- [ ] Chat history is not persisted between app sessions
- [ ] No profile edit screen — onboarding answers are write-once
- [ ] `expo-updates` is installed but there has been no OTA update published yet (first build embeds the channel, first `eas update` will activate OTA)

---

*Last updated: 2026-06-27 by Antigravity session a27960e6-d680-42e1-b325-813ae98eedd9*
