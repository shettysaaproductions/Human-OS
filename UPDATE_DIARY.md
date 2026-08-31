
## [2026-08-31] Pre-Heartbeat Hardening: Stale Working-Memory Correction Invalidation

### Trigger
Pre-heartbeat hardening following deep architectural red-team: when an explicit/authoritative memory correction occurs for canonical key K, stale working-memory candidates for the same user and semantic key must be immediately invalidated rather than lingering until normal rotation.

### Changes Made
1. **MemoryRepository Invalidation Hook (`backend/src/services/memoryRepository.ts`)**
   - Implemented `invalidateStaleWorkingMemory(userId, canonicalKey, activeValue)`.
   - Invoked on authoritative supersession, authoritative memory reinforcement, and authoritative fresh inserts.
   - Deterministically matches working memory rows using `canonicalizeKey()`.
   - Transitions matching conflicting working memory candidates to `promotion_status = 'SUPERSEDED'`.
   - Invariants guaranteed: 0 physical DELETEs, 0 LLM calls, strictly isolated to `userId`, preserves unrelated working memory & episodic history.

2. **CognitiveContextService Filter (`backend/src/services/CognitiveContextService.ts`)**
   - In `get_working_memory` query, filters out `promotion_status === 'SUPERSEDED'` and `'INVALIDATED'` rows and orders by `created_at` descending.
   - In the intra-turn context assembly loop, checks `corrections` on the active turn and immediately filters out any working memory row conflicting with the new value on the same turn.

3. **CandidateSynthesisService Filter (`backend/src/services/CandidateSynthesisService.ts`)**
   - Excludes working memory records with `promotion_status === 'SUPERSEDED'` or `'INVALIDATED'` from evidence packets during nightly candidate synthesis.

### Verification
- `npm run build`: exit 0 (0 errors).
- `npx jest src/services/__tests__/WorkingMemoryInvalidationHardening.test.ts`: 8/8 unit tests passed (100%).
- `npm test -- --coverage=false`: 38/38 test suites, 509/509 tests passed (100%).
- `npx tsx scripts/prod_smoke_test_wm_invalidation.ts`: Ephemeral production smoke test verified with 100% pass (exact key superseded, alias key superseded, unrelated keys preserved, 0 physical DELETEs, ephemeral account 100% eradicated).

---

## [2026-08-31] Phase 2F-E Account Lifecycle & User Data Integrity Hardening

### Trigger
Phase 2F-E account lifecycle hardening: fix confirmed account lifecycle defects discovered during Phase 2F-E-A forensic audit (zombie profiles, broken `profiles` deletion using `user_id` instead of `id`, missing database FK cascades, Founder Dashboard counting zombie profiles, and newer cognitive tables omitted from deletion).

### Changes Made
1. **Canonical Account Lifecycle Service (`backend/src/services/AccountLifecycleService.ts`)**
   - Implemented single authoritative service for complete, deterministic, irreversible account eradication ("Mark Dead").
   - Built 32-table inventory executed in strict topological dependency order (child and foreign key dependent tables first).
   - Fixed confirmed bug in `profiles` deletion: properly uses `.eq('id', userId)` (NOT `user_id`).
   - Implemented defensive failure handling (never falsely reports success if cleanup or auth deletion encounters fatal errors).
   - Implemented `SET NULL` anonymization for `telemetry_events`.

2. **Mark Dead Endpoint Refactoring (`backend/src/routes/auth.ts`)**
   - Replaced brittle 19-table loop with authoritative delegation to `accountLifecycleService.deleteAccount(userId)`.
   - Guaranteed atomic execution and cache eviction.

3. **Database Migration (`backend/supabase/migrations/050_p2fe_account_lifecycle_fks.sql`)**
   - Added `ON DELETE CASCADE` foreign keys from `auth.users(id)` across all user-owned cognitive and operational tables (`profiles`, `memories`, `working_memory`, `episodic_memories`, `chat_history`, `nova_cognitive_doubts`, `kg_nodes`, `kg_edges`, `emotional_states`, `reflections`, `conversation_sessions`, `memory_events`, `memory_access_log`).
   - Upgraded legacy `NO ACTION` foreign keys (`nova_agenda`, `nova_outreach_log`, `user_routines`, `nova_corrections_log`, `user_presence`) to `ON DELETE CASCADE`.

4. **Controlled Production Zombie Purge (`backend/scripts/cleanup_zombie_accounts.ts`)**
   - Scanned and confirmed 14 zombie profile identities whose `auth.users` records had been deleted.
   - Cleaned all orphan application records and zombie profiles in production.
   - Reduced `ZOMBIE_PROFILES_COUNT` from **14 to 0**.
   - Verified that all 3 remaining profiles are 100% active, authenticated users (`In Auth: true`).

5. **Founder Dashboard Count Rectification**
   - With all 14 zombie profiles cleanly eradicated and DB cascades established, `supabaseAdmin.from('profiles').select('*', { count: 'exact', head: true })` in `founder.ts` and `betaAnalytics.ts` now reports exactly **3 live users**.

### Verification
- `npm run build`: exit 0.
- `npx jest src/services/__tests__/AccountLifecyclePhase2fe.test.ts`: 24/24 unit tests passed (100%).
- `npm test -- --coverage=false`: 37/37 test suites, 501/501 tests passed (100%).
- `npx tsx scripts/prod_smoke_test_phase2fe.ts`: Ephemeral production smoke test passed with 100% eradication verified.
- Production Render deployment verified live on commit `b51eb35`.

---

## [2026-08-31] Phase 2F-D Temporal Memory Lifecycle Hardening

### Trigger
Phase 2F-D temporal memory lifecycle hardening: strengthen Human-OS temporal memory semantics so the system distinguishes CURRENT, HISTORICAL, SUPERSEDED, and UNKNOWN facts while preserving chronology and zero date fabrication.

### Changes Made
1. **Deterministic Temporal Extraction (`backend/src/utils/temporalParser.ts`)**
   - Implemented `TemporalParser` for deterministic parsing of exact dates (`exact_date`), month + year (`month_year`), year only (`year_only`), and relative clauses (`relative`).
   - Zero date fabrication invariant: "2023" -> `valid_from: '2023'` (strictly NO `-01-01`), "June 2025" -> `valid_from: '2025-06'` (strictly NO `-01`).
   - Future Intent Invariant (`is_future_intent: true`): Statements about future intentions are blocked from active CURRENT state.

2. **Temporal Memory Gateway (`backend/src/services/memoryRepository.ts`)**
   - Canonical persistence consuming structured `TemporalMetadata`.
   - Historical facts (`lifecycle_state: 'HISTORICAL'`) are preserved alongside active CURRENT facts without supersession collision.
   - Incoming CURRENT facts supersede only conflicting active CURRENT facts while preserving historical milestones.
   - Forward-compatible schema execution with automatic fallback for pending migrations.

3. **Retention and Retrieval Hardening (`MemoryRetentionEngine.ts` & `CognitiveContextService.ts`)**
   - Protected historical milestones from age-based decay (`decision = 'KEEP'`).
   - Segregated `durableFacts` (active CURRENT) from `historicalFacts` in cognitive context assembly while excluding `SUPERSEDED`, `INVALIDATED`, and `PROPOSED` rows.

### Verification
- `npm run build`: exit 0.
- `npx jest src/services/__tests__/TemporalLifecyclePhase2fd.test.ts`: 22/22 unit tests + Adversarial Cases A–F passed (100%).
- `npm test -- --coverage=false`: 36/36 test suites, 477/477 tests passed (100%).
- `npx tsx scripts/prod_smoke_test_phase2fd.ts`: 5/5 production smoke scenarios passed with 100% ephemeral baseline restoration.

---

## [2026-08-30] Phase 2A Watchtower Read-Only Deterministic Guardian & Live Anomaly Classification

### Trigger
Phase 2A architecture deployment: build a zero-LLM deterministic Watchtower to observe cognitive state consistency and classify internal anomalies in production with zero core-state mutation.

### Changes Made
1. **Deterministic Watchtower Engine (`DeterministicGuardianService.ts` & `guardianFingerprint.ts`)**
   - Implemented 22 deterministic anomaly detectors (W-001..W-022) with stable SHA-256 fingerprinting.
   - Non-blocking asynchronous observation hooks attached to `chat.ts`, `lifeThreadRepository.ts`, `memoryRepository.ts`, and `ProactiveGate.ts`.
   - Migration `043_p2a_guardian_schema.sql` created for `nova_guardian_runs` and `nova_guardian_anomalies`.
2. **Production Baseline Scan & Forensic Classification**
   - Full baseline scan executed: 0 LLM calls, 0 core-state mutations.
   - W-001 (Question / Meta Memory): 4 detected (2 real historical extraction defects e.g. `"kaunsa hold pe hai"`, 2 legacy meta-descriptions; 0 false positives).
   - W-002 (Authority Inversion): 2 detected (legacy relational nouns `"wife"`, `"son"` in `*_name` keys stored prior to family name validation rules; 0 false positives).
   - W-014 (Missing Turn Attribution): 47 detected in baseline scan (all 47 confirmed pre-Phase-0 historical messages created prior to Phase 0 deployment boundary `2026-08-30T11:43:30Z`; 0 post-Phase-0 attribution bugs observed).
   - Core data integrity preserved: All flagged historical records left untouched (no automatic cleanup).

---

## [2026-08-29] Production Reliability Repair Pass v2 — P0 Isolation, Reminders, Negation, Garbage Filter, Idempotent Proactive

### Trigger
Forensic audit and five architectural amendments to eliminate cross-user conversation leakage, deterministic reminder parsing failures, un-suppressed negated goal revival, garbage memory pollution, life thread worker failure serialization, and proactive dead windows.

### Changes Made

1. **P0 Conversation Isolation (`chat.ts` — Amendment 2)**
   - Server-side global single-owner validation: If client passes `conversation_id` already containing rows belonging to another `user_id`, silently generates a fresh `conversation_id` for the authenticated user.
   - Zero cross-user conversation context leakage across any read or write paths.

2. **P0 Deterministic Reminders (`TurnAnalyzer.ts` + `ReminderEngine.ts`)**
   - Fixed regex capture group bug where `"kal shaam 4 baje"` captured `"shaam"` as `rawTime` instead of `"4"`.
   - Pattern now extracts `rawTime = "4"` and `periodWord = "shaam"` separately.
   - `buildReminderSpecFromIntent` consumes `periodWord` to reliably compute 24h `time_of_day = "16:00"` and target date.

3. **P0 Negated Project & Goal State (`TurnAnalyzer.ts`, `LifeThreadAgent.ts`, `chat.ts` — Amendment 3)**
   - TurnAnalyzer detects structured `negatedGoals` (concept + targetFactKey + isCurrent).
   - `chat.ts` synchronously dispatches `suppress_life_thread` job on turn detection before LLM call.
   - `LifeThreadAgent.processSuppressJob` deterministically transitions matching thread state to `waiting` with user reason.
   - `LifeThreadAgent.buildPrompt` injects `⛔ PAUSED THREADS` block forbidding the LLM from recreating paused goals.

4. **P1 Garbage Memory Admission Guard (`lib/memoryFilters.ts`, `ConsolidatedMemoryAgent.ts`, `memoryRepository.ts` — Amendment 1)**
   - Created centralized `isGarbageMemoryValue()` and `filterGarbageWorkingMemories()`.
   - Blocks meta-labels (`User's active goals`), questions (`Kya karna chahiye?`), phatic utterances (`Main wapas aa gaya`, `theek hai`), and raw transcripts across semantic, working memory, and short-term memory paths in `ConsolidatedMemoryAgent` and `memoryRepository`.

5. **P1 Life Thread Worker Failure Classification (`LifeThreadAgent.ts` — Amendment 4)**
   - Strict UUID regex validation at entry.
   - Distinguishes failure classes: `MALFORMED_PAYLOAD`, `INVALID_USER_ID`, `DB_FETCH_FAILURE`, `DB_UPDATE_FAILURE`, `EXTRACTION_FAILURE`, `APPLICATION_EXCEPTION`.
   - Sanitized, readable error strings prevent `[object Object]` error log masking.

6. **P1 Session-End Idempotent Proactive Evaluation (`routes/presence.ts`, `QueueService.ts`, `workers/queueWorker.ts` — Amendment 5)**
   - When a user goes offline/away after an active session (>8 min inactivity), queues `session_end_proactive_check` with idempotent key `session_end:{userId}:{sessionStart}`.
   - Routes through `NovaConsciousnessEngine.processUser(userId, { trigger: 'session_end' })` and passes through `ProactiveGate` without modifying gate rules.

7. **Observability (`lib/cognitiveEventBus.ts`)**
   - Lightweight structured `[COGNITIVE_EVENT]` logger tracking memory proposals, blocks, reminder scheduling, thread suppressions, and session transitions.

### Verification
- `npm run typecheck`: exit 0.
- `npm run build`: exit 0.
- `npm test -- --coverage=false`: 19 suites, 208/208 unit tests passing (100%).

---

### Trigger
Full codebase inspection to fix confirmed cognitive/memory/life-thread/follow-up/returning-user reliability issues in one implementation pass.

### Changes Made

**BUG-04 — LifeThread Semantic Dedup (`BackgroundActionService.ts`)**
- Added `_lifeThreadJaccard()` similarity helper and `LIFE_THREAD_STOP_WORDS` set at file scope.
- `LifeThread.upsert` handler now does a two-step match: (1) exact `ilike` match, (2) if no exact match, Jaccard semantic scan of all 20 active threads with threshold 0.3.
- Prevents duplicate `life_threads` rows when the SubconsciousAgent LLM describes the same goal with different wording across turns.

**BUG-05 — ProactiveGate Phantom Entry Exclusion (`ProactiveGate.ts`)**
- Step 4 of `_acquireInternal()` (ignoredCount computation) now adds `.not('logical_key', 'like', 'followup:unanswered:%')` to filter out phantom entries written by `checkUnansweredConversations()`.
- These entries represent conversations where Nova FAILED to reply (not where the user ignored Nova). Counting them as ignored was inflating escalation gaps to 720 min, silently blocking all real proactive outreach.
- Mirrors the same exclusion NACE already applied for session_start evaluations (lines 305-309 in NACE).

**BUG-06 — Correction Propagation Wire (`chat.ts` + `NovaBrainService.ts`)**
- Root cause: `TurnAnalyzer.analyze()` correctly produces `negativeCorrectionConcepts` but the array was never forwarded to the `extract_life_threads` background job.
- Fix 1 (`chat.ts`): Added `negativeCorrectionConcepts: turnAnalysis.negativeCorrectionConcepts || []` to `brainContext`.
- Fix 2 (`NovaBrainService.ts`): Forwards `context.negativeCorrectionConcepts` into `extract_life_threads` job's `turn_context`.
- `LifeThreadAgent.updateThreadProvenanceForCorrection()` now actually fires with real negated concepts.

**BUG-07 — Returning User Proactive Cognition**
- Full code inspection confirmed this is already completely wired end-to-end. No code changes needed.

### Verification
- `npm run build` exit 0, 0 TypeScript errors.
- `npm test -- --coverage=false`: 18 suites, 199/199 tests passing.
- Git pushed: `df69643..4a31c39` → main.
- OTA published to `--branch production`.

---

## [2026-08-25] Phase 10 — Unified Cognitive Context Fabric & Recall Quality

### Trigger
Phase 10 objective: Eliminate context fragmentation across chat, proactive cognition (NACE), life-thread reasoning, and action intelligence through a canonical, bounded, provenance-aware cognitive context layer.

### Changes Made
- **Canonical Cognitive Context Service (`CognitiveContextService.ts`)**:
  - Implemented `CognitiveContextService` assembling unified `CognitiveContext` object (User profile, Temporal intelligence with schedule override, Realtime presence & decay, Recent conversation & conversational antecedents, Turn analysis & facts, Memories with deterministic ranking & conflict resolution, Short-term & Working memory, Life threads, Action intelligence, and Upcoming reminders).
- **Deterministic Ranking & Conflict Resolution**:
  - Multi-tier ranking based on turn keyword relevance (+40), protection status (+30), and recency.
  - Distinct separation of CURRENT vs HISTORICAL facts for conflicting keys (e.g. wife: Sakshi -> Priya). Only the current value is surfaced as active truth while historical records are cleanly isolated with provenance.
- **Pronoun & Conversational Antecedent Continuity**:
  - Extracted conversational antecedents from recent turns (`extractConversationalAntecedents`) so pronouns ("she", "he", "they") bind to immediate conversation referents rather than unrelated distant long-term memories.
- **Degraded Mode & Resiliency**:
  - Safe parallel queries with isolated error boundaries. Non-critical table failures are logged, tracked in `metadata.degraded_sources`, and fallback defaults are supplied without crashing the conversation.
- **Observability & Health Monitoring**:
  - Exposed safe aggregate counters (`context_assemblies`, `items_considered`, `items_selected`, `conflicts_detected`, `conflicts_resolved`, `retrieval_failures`) on `/health/context-fabric`.
- **Unit & E2E Testing**:
  - Added comprehensive test suite `CognitiveContextService.test.ts` (6 tests passing).
  - Verified full test suite (14 suites, 143 tests passing).
  - Executed live production E2E test verifying 4-fact multi-turn capture, wife correction, pronoun continuity, life thread + action integration, and degraded mode resilience.

### Status
- TypeScript build passed (`npm run build` exit 0).
- All 14 unit test suites passed (143/143 tests).
- Production live verification passed.

---

## [2026-08-24] Phase 8.1 — Nova Reliability Pass: Multi-Message Fact Capture + Presence-Aware Proactive Return

### Trigger
Phase 8.1 reliability pass over multi-message fact ingestion, presence-aware proactive return greeting, and test suite hardening.

### Changes Made
- **Multi-Message Fact Extraction & Atomicity (`TurnAnalyzer.ts`)**:
  - Expanded regex patterns in `TurnAnalyzer.extractFacts` for multi-word capture (`[a-zA-Z0-9\s]+?`), added explicit `son_name` / `daughter_name` matching, and expanded location patterns (e.g., "Mai Dahisar me rehta hu", "Mera pura name Sagar shetty hai", "Mere bete ka naam Shresht hai").
  - Fixed rapid-turn fact normalization in `chat.ts` ensuring all semantic units in multi-message rapid turns are extracted into durable facts without dropping.
- **Presence-Aware Returning User Cognition (`QueueService.ts`, `queueWorker.ts`, `presence.ts`, `NovaConsciousnessEngine.ts`)**:
  - Added `session_start_cognition` job type to `subconsciousQueue`.
  - Registered `session_start_cognition` processor in `queueWorker.ts` invoking `novaConsciousnessEngine.processUser(userId)` with backoff and error safety.
  - Made `processUser` public on `NovaConsciousnessEngine` and updated `presence.ts` to enqueue `session_start_cognition` directly through `subconsciousQueue.add()`.
- **Test Suite & Integration Hardening**:
  - Updated `TurnAnalyzer.test.ts` with 4-message rapid succession regression test validating wife, son, user name, and city extraction.
  - Hardened `LifeThreadAgent.test.ts` supabase mock for multi-table queries (`life_threads` + `nova_actions`).
  - Full test suite passed (13 suites, 137 tests passing, 0 errors).

### Status
- Build passed cleanly (`npm run build` exit 0).
- All 13 unit test suites passed (137 tests).

---


## [2026-08-22] Auto Upgrade: Nova Deep Audit & Production Upgrade Plan - 8 Phase Implementation

### Trigger
User requested full production-level upgrade to fix character identity denial, memory noise, emotional/goal disconnection, and working memory expiry. 

### Changes Made
- **Phase 1**: `sanitizeReply()` in `NovaBrainService.ts` now strictly filters out AI-admission phrases to enforce identity lock at the output level.
- **Phase 2**: Added `EMOTIONAL_ALWAYS_DEEP` keywords and lowered character threshold to force 49B model for short emotional states.
- **Phase 3**: Removed dual-prompt conflict by passing `BASE_SYSTEM_PROMPT` directly from `chat.ts` to `brainContext`.
- **Phase 4**: Added 3 new `ANTI-ROBOT` rules in `promptBuilder.ts`: LIFE-STATE COHERENCE, ONBOARDING ANCHOR, and GOAL-EMOTION BRIDGE.
- **Phase 5**: Implemented a memory quality gate in `BackgroundActionService.ts` with a `FLUFF_WORDS` filter to prevent saving junk short-term memories.
- **Phase 6**: Hardened `BackgroundActionService.ts` to set permanent 10-year expiry for schedule keys (`work_schedule`, `weekoff_day`, etc.), fixing amnesia.
- **Phase 7**: Upgraded `onboardingService.ts` to save passions and goals as individual atomic memories instead of large blobs.
- **Phase 8**: Added `buildLifeStateContext()` in `SituationalAwareness.ts` to dynamically bridge the user's latest emotion, current goal, and recent life event.
- **Phase 9**: Verified build locally (`npm run build`).
- **Phase 10**: Synced to git and triggered OTA update to mobile production channel.

### Status
- Build passed (exit 0).
- Committed and pushed to `main`.
- OTA update deployed to mobile (production branch).

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
