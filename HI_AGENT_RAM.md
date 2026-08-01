# ⚡ HI AGENT RAM SNAPSHOT — Human-OS Token-Efficient Knowledge Cache
> **Last Trained:** 2026-08-01 | **Branch:** main | **Live APK Package:** com.humanos.mobile | **Status:** Production Active

---

## 🏷️ Mode Lock & Response Framing Rules
- **Mode Lock:** Once `hi agent` is called, the agent **NEVER leaves Hi Agent mode** across turns until explicitly ended with `"bye agent"` or `"update agent"`.
- **`Hi Agent — Planner Mode`**: Header used for research, architectural planning, design, and `implementation_plan.md` creation (recommended for reasoning models: Claude Sonnet, Gemini Pro).
- **`Hi Agent — Execute Mode`**: Header used for terminal execution, code modifications, surgical edits, build verification, and git pushes (ideal for fast execution models: Gemini Flash).
- **Model Auto-Routing:** The agent must proactively route between Planner/Execute modes depending on the active LLM engine in use.

---

## ⚡ Multi-Machine Sync & RAM Auto-Compression
- **Token Compression:** If chat context exceeds >70% window limits, the agent must silently compress active state into this RAM file, trim chat history, and continue executing seamlessly.
- **Multi-Machine Resume:** On a new machine, `git pull` fetches `.agents/memory/state.json`. The agent reads this file + RAM to immediately resume mid-thought with zero context loss.
- **Universal Auto-Detector:** Running `hi agent init` in any new directory scans `.env`, `package.json`, etc., and automatically generates a tailored version of this RAM snapshot.
---

## 🎯 Surgical Implementation Standard (Senior Staff Engineer Level)
- **High-Rigor Planning:** Every `implementation_plan.md` MUST contain line-level target mappings (`file:///...#L12-L30`), exact prop & state contracts, defensive failure matrix, and phase-by-phase execution sequence.
- **Implementer Compatibility:** Structured so fast/high-tier implementer models (e.g. Gemini 3.6 Flash High) execute edits with surgical accuracy without guessing or breaking existing code contracts.

---

## 🚀 Live APK & Push Notification Configuration (Aug 1, 2026 Fixed)
- **Package Name:** `com.humanos.mobile` (Expo SDK 56)
- **FCM Push Setup:** FCM V1 HTTP API with Firebase project `humanos-3895f`.
- **Expo Credentials:** FCM V1 Service Account Key uploaded to Expo Dashboard (`expo.dev` -> Credentials -> Android -> Service Credentials).
- **Client Config:** `google-services.json` present in `/mobile` root and linked in `mobile/app.json` (`android.googleServicesFile`). Tracked in Git.
- **Backend Auth Token:** `EXPO_ACCESS_TOKEN` set in `backend/.env` AND **MUST be in Render environment variables** (local `.env` is NOT deployed to Render).
- **Push Diagnostic:** `GET /admin/diagnostics/push-diagnostic?user_id=<id>` performs a live end-to-end push test.
- **Startup Validation:** Backend logs `✅ EXPO_ACCESS_TOKEN is configured` or `⚠️ ...NOT set` on every boot.
- **EAS Channel:** `production` (APK listens to `production` channel ONLY for OTA updates).

---

## ⚙️ Core Architecture (7 Engines)
Backend: Node.js / TypeScript on **Render** | DB: **Supabase (PostgreSQL)** | Models: **NVIDIA 70B**
1. **NovaBrain (`NovaBrainService.ts`)** — Main LLM response generator.
2. **NACE Consciousness (`NovaConsciousnessEngine.ts`)** — 15-min pulse for proactive check-ins & double-texts.
3. **Situational Awareness (`SituationalAwareness.ts`)** — Time, session, mood & phase contextualizer.
4. **Moment Engine (`MomentEngineService.ts`)** — Daily memory moment generator.
5. **Reflection Scheduler (`ReflectionSchedulerService.ts`)** — Daily/weekly memory synthesis.
6. **Model Router (`ModelRouterService.ts`)** — Dual key router (Key 1: Chat, Key 2: Background).
7. **Prompt Builder (`promptBuilder.ts`)** — Identity & anti-robot rules.

---

## 🛠️ Critical Developer Commands & Locations
```
BACKEND DIR:   d:\Software\Human Os\Human-OS\backend
MOBILE DIR:    d:\Software\Human Os\Human-OS\mobile
ROOT DIR:      d:\Software\Human Os\Human-OS

BUILD CHECK:   cd backend && npm run build (Run before git push — 0 errors required!)
OTA COMMAND:   cd mobile && npx eas update --branch production --message "..."
GIT PUSH:      git add . && git commit -m "..." && git push origin main
TRAIN COMMAND: Type "train agent" or "train" to compress and refresh this RAM snapshot.
INIT COMMAND:  Type "hi agent init" in any new project to auto-generate a RAM snapshot.
```

---

## 🐛 Recent Fixes & Active Status
- ✅ **Hi Agent Header Framing & Mode Lock (Aug 1, 2026):** Codified mandatory `Planner Mode` vs `Execute Mode` headers and persistent mode lock until `bye agent`.
- ✅ **Universal Auto-Detector & Model Auto-Routing (Aug 1, 2026):** `hi agent init` generates RAM from any stack; agent auto-routes execution/planning.
- ✅ **RAM Auto-Compressor & Multi-Machine Sync (Aug 1, 2026):** Implemented `.agents/memory/state.json` sync and >70% token auto-pruning.
- ✅ **Surgical Planning Standard (Aug 1, 2026):** Codified line-level planning protocol in `AGENTS.md` for zero-error execution by Gemini 3.6 Flash High.
- ✅ **Push Notifications (Aug 1, 2026):** FCM V1 key uploaded to Expo + `EXPO_ACCESS_TOKEN` set in Render & `backend/.env`.
- ✅ **Push Hardening (Aug 1, 2026):** Added startup validation, enhanced error logging, `/admin/diagnostics/push-diagnostic` live test endpoint, and `config.expo.accessToken` formalization.
- ✅ **Critical Auth Fix (Aug 1, 2026):** Fixed fatal zero-UUID bug in `backend/src/middleware/auth.ts`. Replaced hardcoded `00000000...` dummy user with actual Supabase JWT validation (`supabaseAnon.auth.getUser()`). This fixes 500 crashes on telemetry events and ensures push tokens are mapped to the correct user.
- ✅ **Token Freshness (Aug 1, 2026):** Fixed FCM `DeviceNotRegistered` stale token bug by forcing `getDevicePushTokenAsync` before `getExpoPushTokenAsync` in `ensureTokenFresh()` and `_requestPermissionAndRegister()`.
- ✅ **WhatsApp Async Response:** 202 Accepted returned instantly; DB write before response.
- ✅ **Database Bug Resolved (Aug 1, 2026):** `reminders.status` column successfully added to Supabase.

---

## 📌 Token Efficiency Rule
When starting any new conversation, switching LLM models, or setting up on a new device after `git pull`, **read this file FIRST**. It contains 100% of the operational knowledge required in under 100 lines.
