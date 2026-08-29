# Known Issues List (Active)

This document tracks identified bugs, limitations, and workarounds.
**Last Updated: Aug 29, 2026**

---

## ✅ Resolved Aug 30, 2026 — BUG-NEGATION: Life Thread Negation Not Applied for Temporary Pauses

- **Root Cause:** `chat.ts` filtered `negatedGoals` to only dispatch `suppress_life_thread` jobs for **permanent** drops (`isCurrent === false`). Temporary pauses (`isCurrent === true`) — e.g., "cloud kitchen abhi start nahi kar raha, usko hold pe rakha hai" — were silently dropped, so the thread stayed `ACTIVE`.
- **Fix 1 — `chat.ts`:** Removed the `permanentNegations` filter. Now **all** negated goals (both temporary and permanent) are dispatched. The `is_current` flag is forwarded in the job payload.
- **Fix 2 — `LifeThreadAgent.processSuppressJob`:** Reads `is_current` from payload to select target state: `true` → `waiting` (paused), `false` → `abandoned` (dropped). Defaults to `waiting` (safe/non-destructive) when flag is absent.
- **Tests:** 7 regression tests added covering: isCurrent=true→waiting, isCurrent=false→abandoned, missing flag default, idempotency, no-match, malformed payload, invalid user_id. All 215 tests passing.

---


- **P0 — Account / Conversation Isolation (Amendment 2):** Server-side ownership validation in `chat.ts` prevents any cross-user conversation_id reuse. If client submits a conversation_id belonging to another user, a fresh UUID is assigned immediately.
- **P0 — Deterministic Reminder "kal shaam 4 baje" Parsing:** Fixed `TurnAnalyzer` regex capture group mapping to extract `rawTime = "4"` and `periodWord = "shaam"`. Updated `buildReminderSpecFromIntent` to convert using periodWord directly.
- **P0 — Negated Project & Goal State Persistence (Amendment 3):** `TurnAnalyzer` extracts structured `negatedGoals`. `chat.ts` dispatches `suppress_life_thread` deterministic state flip to `waiting`. `LifeThreadAgent.buildPrompt` injects `⛔ PAUSED THREADS` block preventing LLM resurrection of negated goals.
- **P1 — Garbage Memory Admission Guard (Amendment 1):** Created `memoryFilters.ts` (`isGarbageMemoryValue`, `filterGarbageWorkingMemories`). Guarded `ConsolidatedMemoryAgent` semantic, working memory, and short-term paths, plus defense-in-depth in `memoryRepository`.
- **P1 — Life Thread Worker Error Serialization & Classification (Amendment 4):** Added UUID validation and structured failure classification (`MALFORMED_PAYLOAD`, `INVALID_USER_ID`, `DB_FETCH_FAILURE`, `EXTRACTION_FAILURE`, `APPLICATION_EXCEPTION`) eliminating `[object Object]` unreadable error logs.
- **P1 — Session-End Idempotent Proactive Evaluation (Amendment 5):** Added `session_end_proactive_check` in `presence.ts` with stable job identity `session_end:{userId}:{sessionStart}` evaluating via `NovaConsciousnessEngine` and `ProactiveGate`.

---

## ✅ Resolved Aug 29, 2026 — Consolidated Reliability Pass (SHA: 4a31c39)

- **BUG-04 — Life Thread Duplicate Rows (P1):** `BackgroundActionService.LifeThread.upsert` used exact `ilike` match only, so the LLM writing "Job interview prep" vs "Interview preparation" for the same goal created two rows. **Fixed:** Added Jaccard similarity helper (`_lifeThreadJaccard`, threshold 0.3) with a 20-row active-thread scan as a semantic candidate search step before any `INSERT`. If a semantically equivalent thread exists, it is updated in-place. Mirrors the same Jaccard approach already used in `LifeThreadAgent.ts`.
- **BUG-05 — Phantom Outreach Entries Inflating ProactiveGate cooldown (P1):** `checkUnansweredConversations()` writes `followup:unanswered:*` entries to `nova_outreach_log` when a conversation is stuck. `ProactiveGate._acquireInternal()` step 4 counted ALL unreplied outreaches including these phantom entries, inflating `ignoredCount` → 720-min escalation gap that silently blocked all proactive outreach. NACE had already fixed this for session_start evaluations; now the same exclusion (`.not('logical_key', 'like', 'followup:unanswered:%')`) is applied in `ProactiveGate` itself.
- **BUG-06 — Correction Concepts Never Reaching LifeThreadAgent (P1):** `TurnAnalyzer.analyze()` correctly extracts negated concepts (e.g. `negativeCorrectionConcepts: ["fashion"]`) but the result was never forwarded to the `extract_life_threads` background job. `NovaBrainService.generateInteraction()` enqueued the job with only `userMessage`/`novaReply` in `turn_context`. **Fixed:** `chat.ts` now includes `negativeCorrectionConcepts: turnAnalysis.negativeCorrectionConcepts || []` in `brainContext`; `NovaBrainService.ts` forwards it into the job's `turn_context`, so `LifeThreadAgent.updateThreadProvenanceForCorrection()` actually fires with real data.
- **BUG-07 — Returning User Proactive Cognition (P2):** Was already fully implemented and wired. `presence.ts` → `session_start_cognition` job → `novaConsciousnessEngine.processUser(userId, { trigger: 'session_start', awayDurationMinutes })` → NACE session_start evaluation with returning-user context. No code changes required; confirmed as working.


---

## ✅ Resolved Aug 28, 2026

- **Memory Schema Fragmentation — Alias Key Proliferation (P0):** `memories` table accepted arbitrary LLM-generated keys, causing semantic duplicates (`mothers_name`, `mom_name`, `mother_name` all coexisting). `BackgroundActionService` bypassed `memoryRepository` entirely via direct `supabaseAdmin.upsert()`, bypassing all authority and canonicalization guards. `CognitiveContextService` grouped by raw key, so alias rows created duplicate facts in the reasoning prompt. **Fixed:** Created `lib/memoryKeySchema.ts` (single canonical key map, 12 concepts, 70+ aliases). `memoryRepository.upsertMemory` now calls `canonicalizeKey()` as Layer 0 before any authority check. `BackgroundActionService` routes through `memoryRepository`. `CognitiveContextService` groups by canonical key. LLM prompt in `ConsolidatedMemoryAgent` now contains the full canonical key schema. Production reconciliation script cleaned 15 alias rows across all users.
- **Authority Guard Not Applied to BackgroundActionService Writes (P0):** The direct Supabase bypass in `BackgroundActionService` also meant `source_authority` was never set, and the generic-entity blocklist and authority hierarchy guard never ran. **Fixed:** Same fix — all writes now route through `memoryRepository`.

---

## ✅ Resolved Aug 26, 2026

- **Proactive Spam / Repeated Messages (P0):** Multiple engines (NACE every 15min + `checkIgnoredNovaMessages` every 30s) operated with completely independent in-memory cooldown state. On every Render free-tier restart, all in-memory Maps (lastProactiveSentAt, ignoreEscalationCount) reset to zero, causing immediate bursts of repeated messages. **Fixed:** Added `ProactiveGate.ts` — a single authoritative DB-backed gate (via `nova_outreach_log`) that all proactive engines must pass. Gate enforces: (1) suppression lock, (2) quiet hours, (3) escalation cooldown from DB ignored-count (restart-safe), (4) logical-key idempotency per message ID, (5) near-duplicate content dedup (75% Jaccard), (6) long-silence suppression (48h+4 ignored). Migration 038 adds `logical_key` and `replied_at` columns to `nova_outreach_log`.
- **Ignored count not resetting on user reply (P1):** The in-memory `ignoreEscalationCount` was never persisted, so after a server restart the counter reset even if the user had been ignoring Nova for hours. **Fixed:** `cancelFollowups` now calls `proactiveGate.markReplied()` which updates `replied_at` on all unreplied outreach log rows, making the ignored-count DB-authoritative.

---

## ✅ Resolved Aug 22, 2026

- **Weekend/Weekoff Schedule Bug (P0):** `isWeekend` was calendar-only, ignored user's actual schedule from memory. Fixed: `chat.ts` now checks `working_memory` schedule keys and overrides `isWeekend` + injects `scheduleOverrideNote` into the Situation Brief.
- **Broken Replies (P1):** `sanitizeReply` colon-strip regex `^[^\n]{3,60}:\s*\n` was eating sentence openers like "Let's break it down:\n...". Fixed: tightened to only strip ALL_CAPS or Title Case standalone label lines.
- **Weather Spam (P1):** In-memory cooldown Map reset on every Render restart, making the 12h dedup ineffective. Fixed: removed in-memory Map, now 100% DB-backed via `nova_outreach_log`. Added topic-level dedup checking recent chat history for weather keywords.
- **8B Model Used for Career/Schedule Messages (P2):** "I have target of 10 selects" went to 8B model. Fixed: added `schedule`, `weekoff`, `target`, `selects`, `hr`, `recruitment` etc. to `DEEP_TRIGGERS` in `NovaBrainService.ts`.
- **No Schedule Memory Saving (P0):** Nova had no rule to save user-corrected schedule to working_memory. Fixed: added `SCHEDULE SELF-CORRECTION` rule to `promptBuilder.ts` that forces WorkingMemory.set emission.

---

## P1 (CRITICAL — Fix Immediately)

(No active P1 issues at this time.)

---

## P2 (Moderate)

### 1. Vision requires GEMINI_API_KEY on Render
- **Symptom:** User shares image, Nova responds with confusion or ignores it.
- **Root Cause:** `GEMINI_API_KEY` not set in Render environment variables.
- **Fix:** Get key from https://aistudio.google.com/app/apikey → add to Render → Environment → `GEMINI_API_KEY`.
- **Current behaviour (mitigation):** Without the key, Nova at least knows an image was shared and asks the user to describe it.

### 2. NACE Proactive Messages May Arrive as "Ghost Duplicates"
- **Symptom:** Occasionally a Nova proactive message appears twice in the chat.
- **Root Cause:** `checkProactiveMessages()` triggered simultaneously by AppState + notification tap.
- **Workaround:** Idempotency check exists in outreach log. If still occurs, add client-side dedup using `nova_outreach_log` ID.

### 3. OTA Updates Not Received by Test APK
- **Root Cause:** APK targets the `production` EAS channel. Previous OTA pushes used `preview` branch.
- **Fix Applied:** All OTA updates must use `--branch production`.
- **Correct Command:** `npx eas update --branch production --message "..."`

---

## P3 (Minor / Cosmetic)

### 4. Mock Authentication in Development
- **Symptom:** Signup/Login fail locally with `Invalid API key`.
- **Workaround:** Use mock UUIDs in test drivers.

### 5. PostgREST Schema Cache Desync After Migrations
- **Symptom:** API calls fail with `PGRST205` after a new SQL migration.
- **Workaround:** Supabase Dashboard → API → "Reload schema cache".

---

## Resolved Issues

| Issue | Resolution | Date |
|---|---|---|
| Messages stuck (yellow dot forever) | Fixed Android `keepalive: true` infinite fetch loop | July 2026 |
| Fallback "technical issue" message | Added NVIDIA rate-limit fallback + 70B→8B timeout fallback | July 2026 |
| Nova using "Aap" (formal) | STRICT PRONOUN RULE added to `promptBuilder.ts` | July 2026 |
| Nova echoing user's words | ANTI-ROBOT ECHO rule added | July 2026 |
| Nova interrogating with questions | INTERROGATION rule added | July 2026 |
| OTA popup never appearing | Fixed OTA branch from production → preview | July 2026 |
| `reminders.status` missing causing log spam | Migration `20260720000000_add_reminders_status.sql` | July 2026 |
| Time Hallucination near midnight | Better context awareness in auto upgrade | July 2026 |
| Repetition of exact phrases | ANTI-ROBOT REPETITION rule added | July 2026 |
| Race Condition (Double text) on rapid messages | Mutex lock per user in `chat.ts` | Aug 2026 |
| Robotic Excuse Hallucination | NO HALLUCINATING ACTIONS rule added | Aug 2026 |
| **Infinite Follow-Up Spam (P0)** | `NovaFollowupService` writes persistent `followup_suppressed_until` (4h) to DB after Level 3 | Aug 2026 |
| `fetch_recent_chats.ts` wrong table | Fixed `messages` → `chat_history` | Aug 2026 |
| `nova_behavioral_patches` missing column | Migration `023_add_source_log_to_patches.sql` | Aug 2026 |
| Missing `axios` and `@google/generative-ai` | Ran `npm install --prefer-offline` | Aug 2026 |
| **Working memory invisible to Nova** | Fixed: all WM keys now injected. Previously only `current_focus`+`active_goals` shown | Aug 2026 |
| **Sleep signal ignored → 71-msg spam** | Sleep detection in `queueFollowup()`: sleep=8h, busy/bye=2h DB suppression | Aug 2026 |
| **Web search broken for Hinglish queries** | Fast-path keyword matching added to `evaluateSearchNeed()` | Aug 2026 |
| **Vision confused when no GEMINI key** | Fallback description returned so Nova asks user to describe image | Aug 2026 |
| **Image ACKNOWLEDGEMENT rule missing** | 3 new ANTI-ROBOT rules: IMAGE ACKNOWLEDGEMENT, SLEEP RESPECT, WORKING MEMORY IS GROUND TRUTH | Aug 2026 |
| **Fabrication of abbreviation meaning (RNR → "Ram Nawami")** | Strengthened ANTI-ROBOT FABRICATION rule — must ASK what an unknown term means, never guess | Aug 2026 |
| **Memory Amnesia (forgot 5-month-old son; forgot same-session metro context)** | Strengthened ANTI-ROBOT MEMORY ACCOUNTABILITY + SAME-SESSION AMNESIA / CONTEXT rules (zero tolerance) | Aug 2026 |
| **Event-triggered reminders invisible to Nova** | `getUpcomingReminders` + chat.ts awareness block now include `trigger_at IS NULL` (event reminders) | Aug 2026 |
| **JARVIS reminder mode read nonexistent `scheduled_at` column** | Fixed `SituationalAwareness` → `trigger_at`; event reminders excluded from 2h preview | Aug 2026 |
| **Image messages got no reply (self-debounce)** | `chat.ts` debounce now excludes `[HIDDEN_CONTEXT]` rows + never writes a 2nd response after async 202 | Aug 9 2026 |
| **Async content-policy reply dropped** | Content-policy reply released from `REJECT_PREFIXES` → saved+pushed (zero-drop) | Aug 9 2026 |
| **>24h gap split user msg + reply across conversations** | Gap-rotation now backpatches the user message into the new conversation_id | Aug 9 2026 |
| **Duplicate-detection amnesia (85% word-set Jaccard)** | `isDuplicateAssistantMessage` → exact-match after trailing-emoji strip (no more swallowed follow-ups) | Aug 9 2026 |
| **Superseded double-reply (TOCTOU)** | `chat.ts` re-checks for a newer user message before saving the reply | Aug 9 2026 |
| **Deadline timer leak / spurious logs** | `asyncDeadlineTimer` cleared on debounce, blank-reply, error-catch + finally | Aug 9 2026 |
| **Unhandled Supabase rejections crash server** | `.catch`/then(success, failure) on presence upsert, STM count, queue startProcessing | Aug 9 2026 |
| **Mobile: 4xx messages retried forever** | `sendMessageAsync` attaches status → `processQueue` marks 4xx as error (no infinite retry); 401 → refresh+retry once | Aug 9 2026 |
| **Mobile: pending message lost on kill mid-send** | In-flight batch kept durable until ack; `keepalive: true` actually set | Aug 9 2026 |
| **Mobile: 401-refresh never updated auth store** | `api.ts` now sets `useAuthStore` token after refresh (kills endless 401 loop) | Aug 9 2026 |
| **Mobile: `[HIDDEN_CONTEXT]` leaked into UI** | `isInternalContextRow` filter added to hydrate + loadOlderMessages | Aug 9 2026 |
| **Mobile: user's own presence shown as Nova's** | Chat header shows static Nova "online"; away→online restore in `onUserActivity` | Aug 9 2026 |
| **Mobile: banners suppressed on pushed screens** | `setChatScreenActive` now driven by screen focus | Aug 9 2026 |
| **Cross-queue job theft (reflection dropped)** | `QueueService` claims by `job_type`; stale `running` jobs reclaimed; unhandled rejection fixed | Aug 9 2026 |
| **Follow-up double-fire (optimistic lock ignored rowcount)** | `NovaFollowupService` claim verifies `.select('id')` returned a row | Aug 9 2026 |
| **Reminder double-fire from overlapping polls** | `checkAndFireReminders` self-overlap guard | Aug 9 2026 |
| **NVIDIA stream call could hang forever** | `chatCompletionStream` now has AbortSignal + timeout | Aug 9 2026 |
| **`working_memory` upsert threw (no unique key)** | Migration `025_working_memory_unique.sql` adds `UNIQUE(user_id,key)` | Aug 9 2026 |
| **Streaming fallback reply shown but never saved** | `chat.ts` persists `FALLBACK_REPLY` to `chat_history` on all streaming error paths (STREAM_TIMEOUT, iteration error, LLM API error) | Aug 9 2026 |
| **NACE outreach_log insert always failed** | Insert used `type`/`sent_at`; schema has `outreach_type`/`created_at` → anti-spam ledger now fills so MIN_GAP can throttle | Aug 9 2026 |
| **NACE double-outreach from overlapping pulses** | `pulse()` re-entrancy guard | Aug 9 2026 |
| **Mobile: message sent during history fetch dropped** | Hydrate Step-2 merges local `sending`/`sent` messages instead of wholesale-replacing | Aug 9 2026 |
| **Mobile: proactive replies duplicated on fetch** | Assistant dedup now matches any non-UUID (local) id, not just `msg_` | Aug 9 2026 |
| **Mobile: reply poller torn down by newer message's reply** | Poller stops only when the last user message has an assistant reply after it | Aug 9 2026 |
| **KG Explorer d3 sim leaked after unmount** | Simulation stored in a ref, stopped on unmount / re-fetch | Aug 9 2026 |
| **Migration 020 aborted fresh applies** | `RENAME COLUMN` now guarded (idempotent) in `020_sync_reminders_schema.sql` | Aug 9 2026 |
| **Nova couldn't "see" user presence** | Presence row (`user_presence`) now fetched + rendered in situation brief as `👁️ USER PRESENCE: ONLINE/AWAY/OFFLINE/TYPING (last active X min ago)` with per-state behavior guidance | Aug 10 2026 |
| **Read receipts (`is_read`) never written or read** | New `POST /api/chat/read` marks assistant messages read; `📬 READ STATE` block in brief shows unread count; mobile `markMessagesRead()` on screen open / foreground | Aug 10 2026 |
| **Long-term memory decay not scheduled** | `MemoryDecayService.processWeeklyDecay()` now auto-runs in the nightly maintenance window (was manual admin endpoint only). Free-tier hygiene: short-term cleanup daily + chat pruning nightly + decay weekly | Aug 10 2026 |

## Known Limitations

| Issue | Note |
|---|---|
| Recurring reminder day-drift (29–31st) | `calculateNextTrigger` uses `setMonth` → Jan 31 + 1 month = Mar 3. "Every 28th" is safe; 29th–31st drift. Fix: preserve day-of-month clamp |
| NVIDIA free-tier recall failure under load | On free-tier, the 49B model may be rate-limited mid-test. The 3-tier fallback (49B key1 → 49B key2 → 8B key1) greatly reduces this but doesn't eliminate it. Upgrade API plan or space calls >60s apart to avoid. |
| Nova may send blank bubble for sleep/bye | If Nova processes sleep intent purely subconsciously (no text reply), `reply: ''` is returned. Sleep lock IS written correctly. Non-breaking — client shows nothing, not a crash. |
| Supabase `deleteUser` returns empty `{}` error | Occasionally `auth.admin.deleteUser` returns `{}` instead of an error message. The user's table data is deleted successfully; only the auth record deletion is affected. Manual cleanup via Supabase Dashboard if needed. |

## Recently Resolved (Aug 10, 2026)

| Issue | Resolution |
|---|---|
| Nova didn't see user's online/offline/typing status | Fix 1: `SituationalAwareness.buildBrief()` now includes `👁️ USER PRESENCE` block with behavior guidance |
| Nova couldn't tell if user had seen her messages | Fix 2: `POST /api/chat/read` marks assistant rows `is_read=true`; mobile calls on mount + foreground |
| Long-term memory decay never ran automatically | Fix 3: `MemoryDecayService.processWeeklyDecay()` now runs in nightly maintenance 2–4am weekly |
| Expo SDK 57 packages broken against SDK 56 runtime | Fix 4: All packages realigned to SDK 56; `expo-doctor` 21/21 |
| NVIDIA fallback only tried 2 keys, then crashed | Fix 5: 3-tier fallback: primary 49B key1 → secondary 49B key2 → 8B key1 last-resort |
| Emergency FALLBACK_REPLY save had no `situationBrief` in meta | `situationBrief` hoisted to outer scope; outer catch now attaches it to emergency save's meta |
| **Claude/OmniRoute RLHF bias — robotic lists, AI disclaimers, menus** | Added ANTI-ROBOT (CLAUDE/OMNI): NO AI DISCLAIMERS, NO MENUS OR AGENDAS, NO ROBOT CONFIRMATIONS; ReminderEngine tool prompt tells model backend sends pushes | Aug 13 2026 |
| "Network slow" fallback spam from free-tier rate limits | Implemented 4-key round-robin rotation in `nvidia.ts` to multiply rate limit bounds by 4x; background polling throttled to stop token bleed | Aug 14 2026 |
| Verbose robotic replies ignoring formatting rules | Enhanced Response Quality Gate in `chat.ts` to enforce XML boundaries and catch hallucinations mid-stream | Aug 14 2026 |
| Reminders failing silently (Fake reminders) | Response Quality Gate added to chat.ts; ReminderEngine prompt synced; generateReminderMessage moved to templates | Aug 14 2026 |
