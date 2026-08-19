# HumanOS Update Diary

Chronological log of all agent-executed changes. Maintained by `update agent` command.

---

## [2026-08-13] Claude/OmniRoute Behavioral Patches (Auto Upgrade)

### Trigger
Nova sent robotic, structured replies under the Claude/OmniRoute model: numbered lists + bold headers for a casual "Hi", an explicit AI self-narration disclaimer ("Since I'm a text-based AI and don't have the capability to send push notifications..."), a "Medicine Reminder Set! 🎉 ⏰ WARNING: TEXT-BASED REMINDER ONLY" confirmation banner, and a generated menu of options (A/B/C, 1/2/3) for the user to pick from. This stems from RLHF biases in the routed model — acting like a helpful subservient assistant instead of an equal friend.

### Changes Made
- **Anti-Robot Rules** (`backend/src/services/promptBuilder.ts`): Added three Claude/Omni-specific rules — `NO AI DISCLAIMERS` (ban "Since I'm a text-based AI", "I don't have the capability", any AI/bot limitation talk; if unable, say "Ye mere bas ka nahi hai yaar"), `NO MENUS OR AGENDAS` (ban A/B/C or 1/2/3 topic menus; pick ONE topic naturally), and `NO ROBOT CONFIRMATIONS` (ban "Reminder Set!", "WARNING", "Immediate Response Required"; confirm as a friend: "Set kar diya, yaad dila dunga").
- **ReminderEngine Tool Prompt** (`backend/src/services/NovaBrainService.ts`): Both `ReminderEngine -> schedule` blocks (evaluateConsciousness + streaming variant) now carry a `CRITICAL FOR CLAUDE/OMNI MODELS` note — the backend sends the actual push notification, so the model MUST emit the tool instead of outputting a text-based-AI disclaimer. This addresses the root cause of reminder hallucinations under Claude models.

### Status
- Build passed (exit 0).
- Docs updated (MEMORY.md, LEARNING_LOOP.md, KNOWN_ISSUES.md, UPDATE_DIARY.md).
- Pending: commit + push to `main`, Render redeploy (manual), optional `eas update`.

---


### Trigger
User requested fix for 4 production bugs found in the last 20 chat messages: FALLBACK_REPLY firing on NVIDIA rate-limit, robotic list format in Nova's responses, reminder GET endpoint missing active filter, and reminder scheduler crashing on NULL trigger_at.

### Changes Made
- **NVIDIA Fallback Hardening** (`backend/src/lib/nvidia.ts`): Added a 2s backoff and final retry on the secondary key (key2) with the 8B model when all tiers fail (rate limit). This prevents `FALLBACK_REPLY` from killing the conversation on transient spikes.
- **Anti-Robot Rules** (`backend/src/services/promptBuilder.ts`): Added rules to strictly forbid numbered lists, bullet points, bold section headers, and KPI-style progress updates. Required conversational `<NOVA_MSG>` bubbles in HUMAN_CHAT mode.
- **Reminder GET Hardening** (`backend/src/routes/reminders.ts`): GET endpoint now filters `.eq('status', 'active')` to prevent completed/cancelled reminders from polluting Nova's context. Sorted with `nullsFirst: false` so event reminders appear last.
- **Event Reminder Fix** (`backend/src/services/ReminderSchedulerService.ts`): `fireReminder()` now skips the epoch-date future check for event reminders (`trigger_at = NULL`).
- **Typo Fixes** (`backend/src/routes/reminders.ts`): Fixed 'canceled' to 'cancelled' to align with Supabase CHECK constraint.
- **Build Fixes**: Fixed pre-existing build breaks in `memoryDebug.ts` and `health.ts`. Removed broken stub `test_nvidia.ts`.

### Status
- Build passed (exit 0).
- Committed and pushed to `main`.
- OTA update deployed to mobile.

---

## [2026-08-10] Presence Awareness + Read Receipts + Memory Auto-Decay + Expo SDK Alignment + NVIDIA 3-Tier Fallback

### Trigger
User requested Nova to "actually deliver as designed" — specifically: see user's online/offline status, track which messages were read, not message back-to-back unnecessarily, understand sleep schedule, and remember important conversations. Free-tier constraints were hardened throughout.

### Changes Made

**Fix 1 — Presence-Aware Situation Brief** (`backend/src/services/SituationalAwareness.ts`, `backend/src/routes/chat.ts`):
- Extended `SituationContext` interface with `userPresence` (status/last_active/last_typing) and `unreadNovaMessages`.
- `buildBrief()` now emits `👁️ USER PRESENCE: ONLINE/AWAY/TYPING/OFFLINE (last active X min ago)` block with per-state behavior guidance, and `📬 READ STATE: user has NOT yet seen N message(s)` when applicable.
- Two extra parallel Supabase queries added to the chat context fetch (presence + unread count).
- `situationBrief` variable hoisted to outer scope so the emergency FALLBACK_REPLY catch also attaches it to `meta`.

**Fix 2 — Read Receipts** (`backend/src/routes/chat.ts`, `mobile/src/services/chatService.ts`, `mobile/src/screens/ChatScreen.tsx`):
- New `POST /api/chat/read` endpoint marks all unread assistant messages as `is_read=true, read_at=<now>`.
- Mobile calls `chatService.markMessagesRead()` on chat screen mount and on AppState foreground restore.

**Fix 3 — Weekly Memory Auto-Decay Scheduled** (`backend/src/index.ts`):
- `MemoryDecayService.processWeeklyDecay()` now runs automatically inside the nightly maintenance window (2–4am) once per week (`lastMemoryDecayDate` guard). Previously only ran via manual admin endpoint.

**Fix 4 — Expo SDK 56 Alignment** (`mobile/package.json`):
- Installed yarn globally, ran `npx expo install --fix`. All packages aligned to SDK 56. `expo-doctor` 21/21 checks pass.

**Fix 5 — NVIDIA 3-Tier Fallback** (`backend/src/lib/nvidia.ts`):
- Fallback chain: primary 49B key1 → secondary 49B key2 → last-resort 8B key1. Ensures user always gets a real reply under free-tier rate pressure instead of the zero-drop fallback text.

### Production Test Results (Aug 10 — temp user, 3 messages, cleaned up)
| Check | Result | Notes |
|---|---|---|
| allRead (read receipts) | ✅ | POST /chat/read HTTP 200, all assistant rows marked is_read=true |
| lockFuture (sleep lock) | ✅ | followup_suppressed_until written to working_memory |
| reminderFired | ✅ | "call mom" status=completed within 3.5 min |
| hasReminderMoment | ✅ | user_moments REMINDER entry created |
| hasInterview (memory) | ✅ | upcoming_job_interview saved with importance 90 |
| recalled (Msg 2) | ❌ | NVIDIA rate-limited → fallback reply; memory extraction & recall correct in DB |
| hasPresence/hasReadState | ❌ | Checked Msg 2 meta which was a fallback; brief present in Msg 1 meta |

### Status
Backend + mobile typechecks pass. All changes committed and pushed to `main`. Render auto-deploys on push. Mobile read receipts require OTA update (`npx eas update --branch production`).

---

## [2026-08-09] Zero-Drop Messaging Guarantee + Reminder Engine Hardening

### Trigger
User reported Nova's replies being generated but not displayed until app restart. Plan approved to guarantee every user message receives a visible response.

### Changes Made
- **Backend 100% reply guarantee** (`backend/src/routes/chat.ts`): Added `FALLBACK_REPLY` constant ("Arre yaar, mera network thoda slow chal raha hai. Ek baar phir se bhejega?") now saved + pushed in ALL failure paths — async LLM timeout, async LLM error, outer crash catch, and 3 streaming/SSE error events. Message deliberately NOT in `REJECT_PREFIXES`/`MOBILE_FALLBACK_FILTER` so it renders as a chat bubble (clears typing) instead of being silently dropped. Fixed the previously-misleading "skipping DB save" deadline log.
- **Resume-safe polling** (`mobile/src/store/useChatStore.ts`): Poll timeout now performs ONE final `checkProactiveMessages()` fetch before clearing typing (fixes reply-not-visible-until-restart when app was backgrounded); `MAX_REPLY_WAIT_MS` 90s→120s; proactive fetch limit 10→20. Guard added so multi-bubble typing rhythm is preserved.
- **Push re-hydration** (`mobile/src/screens/ChatScreen.tsx`): 500ms delay before fetching history on notification tap.
- **Reminder Engine upgrade** (migration `024_upgrade_reminders.sql` + `ReminderEngine.ts` + `SituationalAwareness.ts`): added `purpose`/`urgency`/`event_trigger`/`end_condition` columns; event-triggered reminders (`trigger_at IS NULL`) now visible to Nova; fixed JARVIS reading non-existent `scheduled_at` → `trigger_at`; added `ReminderEngine.test.ts`.

### Status
Backend + mobile typechecks pass (`tsc --noEmit`). Changes committed and pushed to `main` via `update agent`. Deploy: backend auto-deploys on Render; mobile JS requires manual OTA (`npx eas update --branch production`).

---

## [2026-07-30] Push Notification Bug Fix & Root Cause

### Trigger
User reported push notifications were not being delivered on their newly installed APK (v1.2.33-stable).

### Changes Made
- **Fixed backend crash**: Removed `push_token_updated_at` column reference in `backend/src/routes/auth.ts` which was causing a fatal DB crash and preventing token registration.
- **Mobile OTA Fixes**: Updated `mobile/src/services/notificationService.ts` to include `ensureTokenFresh()` for seamless token regeneration across APK upgrades.
- **OTA Strategy**: Changed `checkAutomatically` in `mobile/app.json` to `ON_LOAD` to guarantee users receive JS fixes.
- **Behavioral Patches**: Added 3 new patches to `promptBuilder.ts` to improve Nova's context awareness.
- **Docs**: Regenerated `FILE_TREE.md` via `update agent`.

### Status
Backend changes pushed to `main` and manually deployed to Render. Mobile JS changes committed to `main` — User instructed to trigger GitHub Actions to build a fresh APK since the old `v1.2.33-stable` APK ignores OTA updates.

---

## [2026-07-30 03:30 IST] Auto Upgrade V2 (Cont.) — 100-Message Context & MVP Docs

### Trigger
User requested completion of the "Power Up Auto-Upgrade" Mode while waiting for the fresh APK to build.

### Changes Made
- **Deep Context History**: Increased the `get_chat_history` query limit in `backend/src/routes/chat.ts` from 20 to 100 messages. This ensures Nova has massive context when identifying conversational flaws.
- **Architecture MVP Update**: Updated `NOVA_ARCHITECTURE.md` to formally document the **Quad NVIDIA Key Pool Strategy** (Keys 1-4) handling chat, NACE, learning, and extraction.

### Status
Changes committed and pushed to `main`. APK is currently building via GitHub Actions.

---

## [2026-07-30 00:45 IST] Auto Upgrade V2 — Real-Time Self-Correction & Architecture Overhaul

### Trigger
User requested a major auto upgrade after analyzing 100 chat messages that revealed 10 critical behavioral failures in Nova.

### Critical Failures Found in Chat Analysis
1. **Memory Amnesia** — Nova forgot user's son (5 months), marriage, and schedule
2. **Zero Proactive Outreach** — 5-day silence; Nova never reached out
3. **Fabrication** — "RNR" was hallucinated as "Ram Nawami hain! Shubhkamnaayein!"
4. **Time Hallucination** — At 9:41 PM asked "office pahunchne me aur kitna time hai?"
5. **Context Amnesia** — Forgot "metro me hoon" from same session minutes later
6. **Greeting Repetition** — "Arey yaar, kahan tha tu itni der?" 3 times verbatim
7. **Long-term memory polluted** — 30+ test_memory_* entries, zero real user facts
8. **Day Hallucination** — Said "Wednesday hai" on a Tuesday
9. **Formality Regression** — Used "Aapke liye", "Dhanyavad" despite strict rules
10. **Romantic Hallucination** — Made up romantic relationship in a story

### Files Created (NEW)
| File | Purpose |
|------|---------|
| `backend/src/services/NovaRealtimeLearningService.ts` | Detects user corrections in replies, auto-generates behavioral patches (Key 3) |
| `backend/src/services/FreeTierGuardService.ts` | Enforces zero-cost across NVIDIA/Supabase/Render |
| `backend/scripts/cleanupTestMemories.ts` | One-time memory cleanup + re-seeding with real user facts |
| `backend/supabase/migrations/021_nova_corrections_log.sql` | Corrections audit + scan checkpoints tables |
| `TASKS.md` | Active task tracker |
| `UPDATE_DIARY.md` | This file |
| `NOTES.md` | Agent notes |
| `FILE_TREE.md` | Project structure overview |

### Files Modified
| File | Change |
|------|--------|
| `backend/src/services/NovaSelfImprovementService.ts` | 5→12 flaw types, weekly→daily, incremental scan, Key 3 |
| `backend/src/services/NovaConsciousnessEngine.ts` | Intelligent dynamic gap, coma awareness, habit triggers |
| `backend/src/services/promptBuilder.ts` | 4 new anti-robot rules, dynamic patch reload every 50 msgs |
| `backend/src/routes/chat.ts` | Correction detection hook for reply_to_content |
| `backend/src/lib/nvidia.ts` | Multi-key pool: Key 3 (learning), Key 4 (extraction) |
| `backend/src/config/index.ts` | NVIDIA_API_KEY_3 + NVIDIA_API_KEY_4 env vars |
| `backend/src/index.ts` | Server boot/shutdown uptime tracking, habit trigger scheduler |
| `.agents/AGENTS.md` | 12 failure modes, incremental scan, hi agent, update agent |

### New Anti-Robot Rules Added to PromptBuilder
1. `ANTI-ROBOT RULE (FABRICATION)` — Never guess unknown abbreviations
2. `ANTI-ROBOT RULE (SAME-SESSION CONTEXT)` — Never forget current-session facts
3. `ANTI-ROBOT RULE (DAY AWARENESS)` — Trust Situation Brief for day/time, never hallucinate
4. `ANTI-ROBOT RULE (MEMORY ACCOUNTABILITY)` — Must use known life facts when relevant

### User Feedback Integrated
- Multiple NVIDIA API keys in parallel (Key 1: chat, Key 2: NACE, Key 3: learning, Key 4: extraction)
- NACE gap is now situation-aware (not fixed timer)
- Incremental scan checkpoints (auto-upgrade doesn't re-scan fixed bugs)
- Zero-cost enforcement via FreeTierGuardService
- Nova logout/coma awareness (5-min boot cooldown, shutdown timestamp recorded)
- "hi agent" and "update agent" commands added to AGENTS.md
- Paths fixed to `d:\\Software\\Human Os\\Human-OS`

### Action Required by User
1. Add `NVIDIA_API_KEY_3` and `NVIDIA_API_KEY_4` to Render environment variables
2. Run migration `021_nova_corrections_log.sql` in Supabase SQL editor
3. Run `npx tsx scripts/cleanupTestMemories.ts` once to clean memory
4. Manually redeploy Render after git push
5. Do OTA update after Render is live

---

## 2026-08-19
- Fixed a parsing bug where Nova would fall back to "Mujhe thoda sochne de" when generating lists (like reminders). The prompt rule forbidding lists was overridden for direct requests, and XML parsing was made robust against truncation.
