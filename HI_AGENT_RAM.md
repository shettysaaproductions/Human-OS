# ⚡ HI AGENT RAM SNAPSHOT — Human-OS Token-Efficient Knowledge Cache
> **Last Trained:** 2026-08-22 | **Branch:** main | **Live APK Package:** com.humanos.mobile | **Status:** Production Active

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

## ⚙️ Core Architecture (7 Engines + 4-Key Brain)
Backend: Node.js / TypeScript on **Render** | DB: **Supabase (PostgreSQL)**

**🧠 Nova Brain Architecture (Human Brain Model):**
Uses 4 dedicated NVIDIA API keys (Nemotron 49B) mapped to specialized brain regions so background tasks never starve real-time chat:
- **Key 1 (Frontal Cortex):** Real-time user replies (`chatCompletion`). Failover to Reserve.
- **Key 2 (Hippocampus):** 8 memory agents + learning (`chatCompletionMemory`, `chatCompletionLearning`).
- **Key 3 (Cerebellum):** Background tasks like WebSearch/Weather (`chatCompletionBackground`).
- **Key 4 (Reserve):** Emergency failover if Frontal Cortex times out + extra key capacity.

**Core Engines:**
1. **NovaBrain (`NovaBrainService.ts`)** — Main LLM response generator.
2. **NACE Consciousness (`NovaConsciousnessEngine.ts`)** — 15-min pulse for proactive check-ins & double-texts.
3. **Situational Awareness (`SituationalAwareness.ts`)** — Time, session, mood & phase contextualizer.
4. **Moment Engine (`MomentEngineService.ts`)** — Daily memory moment generator.
5. **Reflection Scheduler (`ReflectionSchedulerService.ts`)** — Daily/weekly memory synthesis.
6. **Reminder Engine (`ReminderEngine.ts` + `ReminderSchedulerService.ts`)** — Smart reminder scheduling, NLP parsing, firing with warm Nova message + completion tracking.
7. **Prompt Builder (`promptBuilder.ts`)** — Identity & anti-robot rules (24 ANTI-ROBOT rules active).

---

## 🛠️ Critical Developer Commands & Locations
```
BACKEND DIR:   c:\Users\Laptop 6\Documents\Human Os\backend
MOBILE DIR:    c:\Users\Laptop 6\Documents\Human Os\mobile
ROOT DIR:      c:\Users\Laptop 6\Documents\Human Os

BUILD CHECK:   cd backend && npm run build (Run before git push — 0 errors required!)
OTA COMMAND:   cd mobile && npx eas update --branch production --environment production --message "..."
GIT PUSH:      git add . && git commit -m "..." && git push origin main
NVIDIA MODEL:  Set NVIDIA_CHAT_MODEL in Render env vars (current: nvidia/llama-3.3-nemotron-super-49b-v1)
NVIDIA TIMEOUT: 55 seconds (nvidia.ts line 49) — needed for 49B model on free tier
TRAIN COMMAND: Type "train agent" or "train" to compress and refresh this RAM snapshot.
INIT COMMAND:  Type "hi agent init" in any new project to auto-generate a RAM snapshot.
```

---

## 🐛 Recent Fixes & Active Status
- ✅ **Aug 22 Session — Phase 1 Latency Optimization (Parallel Fetch):**
  - **`chat.ts` Sequential Block Destroyed:** Replaced 5 sequential blocking asynchronous calls (Profile, Chat History, Memory Contexts, Web Search, External DB Services) with a single unified `Promise.all` parallel fetch block.
  - **Result:** Context assembly dropped from 2.5s down to <0.5s.
- ✅ **Master Production Fix (Aug 1, 2026):** 
  - NACE (Nova Autonomous Consciousness Engine) now gathers all 7 engines' context (Memories, Conversations, Temporal, Agenda) and feeds them into Tier 1 subconscious decision-making.
  - Added `MessageFormatter` for WhatsApp-style multi-bubble output with contextual emojis.
  - Fixed NACE absolute minimum gap bugs (reduced dynamic thresholds based on typing, online, away, offline status).
  - Wired `NovaTriggerEngine` to NACE for human-like proactive delays and push notifications.
  - Implemented proactive DedupeCache to stop redundant repetitive messages.
- ✅ **Hi Agent Header Framing & Mode Lock (Aug 1, 2026):** Codified mandatory `Planner Mode` vs `Execute Mode` headers and persistent mode lock until `bye agent`.
- ✅ **Universal Auto-Detector & Model Auto-Routing (Aug 1, 2026):** `hi agent init` generates RAM from any stack; agent auto-routes execution/planning.
- ✅ **RAM Auto-Compressor & Multi-Machine Sync (Aug 1, 2026):** Implemented `.agents/memory/state.json` sync and >70% token auto-pruning.
- ✅ **Surgical Planning Standard (Aug 1, 2026):** Codified line-level planning protocol in `AGENTS.md` for zero-error execution by Gemini 3.6 Flash High.
- ✅ **Push Notifications (Aug 1, 2026):** FCM V1 key uploaded to Expo + `EXPO_ACCESS_TOKEN` set in Render & `backend/.env`.
- ✅ **Critical Auth Fix (Aug 1, 2026):** Fixed fatal zero-UUID bug in `backend/src/middleware/auth.ts`. Replaced hardcoded `00000000...` dummy user with actual Supabase JWT validation (`supabaseAnon.auth.getUser()`). This fixes 500 crashes on telemetry events and ensures push tokens are mapped to the correct user.
- ✅ **Auto Upgrade Protocol (Aug 1, 2026):** Patched hallucination bug in `promptBuilder.ts` (Rules 18 & 19 added) and fixed the rapid-message race condition (double texts) by adding an in-memory Mutex lock per user in `backend/src/routes/chat.ts`.
- ✅ **Tag Replies & Message Merging (Aug 1, 2026):** Re-architected `chat.ts` to solve cascading timeouts. Rapid messages are now debounced (if a newer user message exists, older generation aborts gracefully), forcing Nova to merge rapid texts into a single response. Assistant inserts also now use `reply_to_id` to enable WhatsApp-style quote tags in the UI.
- ✅ **Token Freshness (Aug 1, 2026):** Fixed FCM `DeviceNotRegistered` stale token bug by forcing `getDevicePushTokenAsync` before `getExpoPushTokenAsync`. Also fixed the `VALIDATION_ERROR: Invalid enum type` bug by passing the **full `deviceToken` object** (not the `.data` string) into Expo's fetcher so FCM types aren't stripped.
- ✅ **WhatsApp Async Response:** 202 Accepted returned instantly; DB write before response.
- ✅ **Database Bug Resolved (Aug 1, 2026):** `reminders.status` column successfully added to Supabase.
- ✅ **Behavioral Patches — Anti-Hallucination & Anti-Amnesia (Aug 5, 2026):** Strengthened 5 existing ANTI-ROBOT rules in `promptBuilder.ts` (FABRICATION, SAME-SESSION CONTEXT, DAY AWARENESS, MEMORY ACCOUNTABILITY, SAME-SESSION AMNESIA) to ZERO-TOLERANCE and added new ANTI-ROBOT RULE (NO CAPABILITY PITCHING). Fixes: memory/context amnesia (forgot 5-month-old son, same-session metro), fabrication of "RNR" → "Ram Nawami", time/day hallucination, and self-narration of internal architecture ("7/8 engines", "long-term memory").
- ✅ **Aug 6 Session — Full Nova Response Restoration (commits 5b77caf, 34343f7, 15b08ac, 889d5f5):**
  - **Trust Proxy Fix** (`app.ts`): Added `app.set('trust proxy', 1)` — was silently blocking ALL POST /api/chat requests on Render (rate-limit middleware rejected them).
  - **Model Switch**: Changed `NVIDIA_CHAT_MODEL` from `meta/llama-3.3-70b-instruct` (30s timeout → always failing) to `nvidia/llama-3.3-nemotron-super-49b-v1` via Render env var. Timeout increased to 55s in `nvidia.ts`.
  - **Table Trigger Fix** (`ResponseIntelligence.ts`): Short messages like "Supp" were incorrectly triggering LONG_CONTEXT table mode because `len < 10` matched any short message. Now requires explicit agreement word + short length.
  - **LLM Label Stripping** (`chat.ts` sanitizeMarkdown): Added stripping of "Follow-up question:", "Topic", "Option" etc. that 8B model outputs verbatim.
  - **Nemotron XML Bleed Fix** (`NovaBrainService.ts`): Nemotron outputs `**Response**` / `**Subconscious Actions**` markdown instead of XML tags. Added fallback parser to extract conversational text from between these headers.
  - **Reminder Engine Overhaul** (`BackgroundActionService.ts`, `ReminderSchedulerService.ts`, `ReminderEngine.ts`, `reminders.ts`, `NovaBrainService.ts`): Fixed 4 bugs: (1) `time_phrase` NLP parser so Nova's natural language schedules real reminders, (2) warm Nova-style fire message instead of robotic `🔔 Reminder: text`, (3) completion tracking via nova_agenda after firing, (4) extended recurrence schema to include minutes/weeks/months.
  - **Nemotron Bold Header Stripping** (`chat.ts`): `sanitizeMarkdown` now strips standalone `**Header**` lines. Added rule #21 NO BOLD HEADERS IN CHAT to prompt.
  - **Options Prose Bleed Fix** (`promptBuilder.ts`): CLOSE-ENDED OPTIONS block now strictly mandates `<OPTIONS>[...]</OPTIONS>` format only. Added sanitize strips for "Awaiting Your Selection", "Default Response if No Option Selected" meta-text.
  - **Pronoun Zero Tolerance** (`promptBuilder.ts`): Added rule #0 PRONOUN ZERO TOLERANCE as FIRST rule in CRITICAL FINAL INSTRUCTIONS (highest model salience). NEVER use Aap/Aapka/Aapko.
  - **Real Reminders Only** (`promptBuilder.ts`): Added rule #20 — NEVER say "imaginary timer". If user asks for reminder, MUST emit ReminderEngine.schedule tool action.
  - **NACE Active-User Guard** (`NovaConsciousnessEngine.ts`): NACE won't fire proactive messages when user is actively chatting (gap < 10 min). Exact-match dedup prevents duplicate outreach.
  - **Stuck Conversation Timing** (`NovaFollowupService.ts`): Detection cutoff 1min→10min; bad fallback message replaced.
- ✅ **Aug 10 Session — Presence Awareness + Read Receipts + Memory Hygiene + NVIDIA Resilience:**
  - **Presence-Aware Brief** (`SituationalAwareness.ts`, `chat.ts`): `buildBrief()` now includes `👁️ USER PRESENCE` (online/away/typing/offline + last-active) and `📬 READ STATE` (how many of Nova's messages the user hasn't opened). Nova adjusts behavior: doesn't assume rejection on away, gives snappy replies when online, self-contained when offline.
  - **Read Receipts** (`chat.ts`, `chatService.ts`, `ChatScreen.tsx`): New `POST /api/chat/read` marks all unread assistant rows `is_read=true, read_at=<now>`. Mobile calls on chat mount and AppState foreground-restore.
  - **Weekly Memory Decay Auto-Scheduled** (`index.ts`): `MemoryDecayService.processWeeklyDecay()` now runs inside nightly maintenance (2–4am) once per week. Previously required a manual admin endpoint call.
  - **Expo SDK 56 Alignment** (`mobile/package.json`): `expo-doctor` 21/21 checks pass; all mismatched SDK 57 packages downgraded to SDK 56.
  - **NVIDIA 3-Tier Fallback** (`nvidia.ts`): primary 49B key1 → secondary 49B key2 → last-resort 8B key1. User always gets a real reply under free-tier rate pressure.
  - **Emergency Save Meta Fix** (`chat.ts`): `situationBrief` hoisted to outer scope so the emergency FALLBACK_REPLY catch also stores presence context in `meta`.
  - **Prod Test (Aug 10):** 5/8 checks ✅ (read-receipts, sleep-lock, reminder-fire, user_moments REMINDER, memory save). 3/8 ❌ were all due to NVIDIA rate-limit on Msg 2 (not code bugs). All test data cleaned up.
- ✅ **Aug 9 Session — Zero-Drop Messaging Guarantee + Reminder Hardening:**
  - **100% Reply Guarantee** (`chat.ts`): Added `FALLBACK_REPLY` = `"Arre yaar, mera network thoda slow chal raha hai. Ek baar phir se bhejega?"`. Now saved + pushed in ALL failure paths (async LLM timeout, async LLM error, outer crash catch, 3 streaming/SSE error events). Deliberately NOT in `REJECT_PREFIXES`/`MOBILE_FALLBACK_FILTER` so it renders as a bubble (clears typing) instead of being silently dropped.
- ✅ **Aug 14 Session — Multi-Key NVIDIA Rotation + Proactive Auto-Timer Architecture + Response Quality Gate:**
  - **Token Bleed Stopped** (`index.ts`): Reduced excessive NACE and Follow-up polling to stop free-tier API starvation.
  - **NVIDIA 4-Key Rotation** (`nvidia.ts`): Implemented a robust `KeyPool` that cycles through all 4 configured NVIDIA API keys on a round-robin basis with automatic rate-limit (429) failover to prevent the "network slow" bug.
  - **Response Quality Gate** (`chat.ts`): Catch hallucinated reminders mid-stream. If Nova says "remind", "timer", or "yaad" but emits no `ReminderEngine` action, the gate appends "Wait, tell me what time though?" so the lie is intercepted.
  - **Auto-Timer Architecture** (`promptBuilder.ts`, `BackgroundActionService.ts`, `NovaBrainService.ts`): Nova now autonomously sets auto-timers when users mention time-sensitive activities via `is_auto: true` in the XML payload.
  - **Reminder Hardening** (`ReminderSchedulerService.ts`): Firing a reminder no longer depends on an LLM call. Generates warm messages via safe templates and retries DB inserts if Supabase flakes.
- ✅ **Aug 18 Session — LLM 404 Model Not Found Fix:**
  - **Dead Model Removal:** NVIDIA deleted the `70b` models (`nvidia/llama-3.1-nemotron-70b-instruct`). This caused the backend to hard-fail with 404 errors, triggering the `Hmm... mujhe thoda sochne de` fallback loop on every single message.
  - **Render Config Fix:** Updated `render.yaml` to deploy with `nvidia/llama-3.3-nemotron-super-49b-v1` instead of forcing the dead 70b model, and updated `backend/.env` and migration files.
- ✅ **Aug 22 Session — Schedule Memory Override + Reply Quality + Weather Spam Fix:**
  - **Weekend Override** (`chat.ts`): `isWeekend` now checks `working_memory` schedule keys before trusting the calendar. User who works Saturday gets `isWeekend=false`. Injects `scheduleOverrideNote` into Situation Brief to correct the LLM's assumption.
  - **Schedule Self-Correction Rule** (`promptBuilder.ts`): New `SCHEDULE SELF-CORRECTION` rule forces Nova to emit `WorkingMemory.set` with `work_schedule` + `weekoff_day` whenever user corrects their schedule. Saves it for all future sessions.
  - **sanitizeReply Fix** (`NovaBrainService.ts`): Tightened colon-stripping regex to only nuke ALL_CAPS/Title Case labels, not sentence openers like "Let's break it down:". Prevents broken half-replies.
  - **Weather Spam Fix** (`WeatherWatcherService.ts`): Removed unreliable in-memory cooldown Map (resets on Render restart). Now 100% DB-backed via `nova_outreach_log`. Added topic-level dedup: checks recent chat history for weather keywords over 6h window.
  - **49B Deep Triggers** (`NovaBrainService.ts`): Added schedule/career keywords (`weekoff`, `target`, `selects`, `hr`, `recruitment`, etc.) to `DEEP_TRIGGERS` so complex career messages go to 49B, not 8B.
- ✅ **Aug 19 Session — NACE Proactive Messaging Restored + Critical Timeout Fix:**
  - **Timeout Fix:** `LLM_TIMEOUT_MS` 12s → 55s in `chat.ts` and `nvidia.ts`. Nova was timing out 100% of LLM calls on Render free tier (49B needs 20-40s). This is why Nova wasn't replying at all.
  - **Dead Model Fix:** `config/index.ts` auto-upgrades dead `70b` model strings at startup.
  - **NACE Proactive Fix — 3 root causes found & patched:**
    1. `effectiveMinGap` for `offline` users: **15min → 5min** (was blocking all outreach between sessions)
    2. Tier1 fallback: Now fires on ANY waking-hours silence ≥ effectiveMinGap (not just online users or agenda items)
    3. Tier1 prompt: Removed hardcoded "45 min" gate — now uses actual computed `effectiveMinGap` from code
  - **⚠️ CRITICAL RULE:** Never set `offline` effectiveMinGap above 5min for a companion app — 15min ensures 100% silence.
  - **⚠️ CRITICAL RULE:** LLM decision prompts must inject ACTUAL computed threshold values, not hardcode them.
  - **Key routing:** 4-key NVIDIA rotation confirmed: frontal gets all 4 keys. `needsDeepModel` threshold tuned: <15 chars or FAST_ONLY words → always 8B (fast). >150 chars or deep triggers → 49B.


---

## 📌 Token Efficiency Rule
When starting any new conversation, switching LLM models, or setting up on a new device after `git pull`, **read this file FIRST**. It contains 100% of the operational knowledge required in under 100 lines.
