# ⚡ HI AGENT RAM SNAPSHOT — Human-OS Token-Efficient Knowledge Cache
> **Last Trained:** 2026-08-01 | **Branch:** main | **Live APK Package:** com.humanos.mobile | **Status:** Production Active

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
- **Backend Auth Token:** `EXPO_ACCESS_TOKEN` set in `backend/.env` AND Render environment variables.
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
```

---

## 🐛 Recent Fixes & Active Status
- ✅ **Surgical Planning Standard (Aug 1, 2026):** Codified line-level planning protocol in `AGENTS.md` for zero-error execution by Gemini 3.6 Flash High.
- ✅ **Push Notifications (Aug 1, 2026):** FCM V1 key uploaded to Expo + `EXPO_ACCESS_TOKEN` set in Render & `backend/.env`.
- ✅ **Token Freshness:** `notificationService.ensureTokenFresh()` re-registers tokens automatically on new APK installs.
- ✅ **WhatsApp Async Response:** 202 Accepted returned instantly; DB write before response.
- 🔴 **Active Issue:** `reminders.status` column missing in Supabase schema (causes log warning every 10s).

---

## 📌 Token Efficiency Rule
When starting any new conversation, switching LLM models, or setting up on a new device after `git pull`, **read this file FIRST**. It contains 100% of the operational knowledge required in under 100 lines.
