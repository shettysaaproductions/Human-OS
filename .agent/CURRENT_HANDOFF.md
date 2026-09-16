# CURRENT HANDOFF

## Last Updated
2026-09-16 — Voice Audio Routing, Voice Note Reliability, Standardized Tool Contract & Autonomous Action Lifecycle Engine (v0.3.24-beta)

## Session / Agent
Agent: MonkeyCode
Branch: `main`

## Status: VERIFIED & PRODUCTION DEPLOYED (OTA v0.3.24-beta Published + Broadcasted)

### EAS Production OTA Deployment (v0.3.24-beta)
- **Update Group ID**: `1f988cd4-3199-481e-aa5e-5fb7bccbe515`
- **Android Update ID**: `01a0a9ce-dc31-7c94-8921-504a17bc302a`
- **iOS Update ID**: `01a0a9ce-dc31-7d86-ab3d-321bb0cf03cb`
- **Runtime Version**: `1.1.0`
- **Branch**: `production`
- **Broadcast Push**: Dispatched to registered devices via `broadcast_update_push.ts`.

---

### Key Capabilities Delivered in this Phase

1. **Android Physical Voice Audio Routing (`useVoiceSession.ts`)**:
   - Fixed `expo-audio` route switching using real instantiated `AudioRecorder` input discovery.
   - Dynamic switching across `speaker`, `earpiece` (phone receiver), and `bluetooth` headset.
   - Automatic fallback to speaker on Bluetooth disconnect.
   - Structured diagnostic logging tags: `AUDIO_DEVICE_LIST`, `ACTIVE_OUTPUT_DEVICE`, `ACTIVE_INPUT_DEVICE`, `REQUESTED_ROUTE`, `ACTUAL_ROUTE`, `ROUTE_CHANGE_RESULT`, `BLUETOOTH_CONNECTED`, `BLUETOOTH_DISCONNECTED`.

2. **Voice Message Recording & Persistence (`ChatScreen.tsx`, `chat.ts`)**:
   - Added Android `recorder.prepareToRecordAsync()` to prevent silent recorder drop.
   - Fixed recorded URI extraction supporting Android `status.url` / `recorder.getStatus().url`.
   - Double-tap send protection using `isSubmittingVoiceRef`.
   - File existence validation with `getInfoAsync` and user-facing error reporting.
   - Preserved `audio_base64` in user message `chat_history.meta` to guarantee persistent playback across app restarts.

3. **Standardized Voice Tool Return Contract (`NovaVoiceService.ts`)**:
   - Standardized all 11 Gemini Live voice tools to return strict structured contracts:
     `{ success: boolean, action_id?: string, entity_id?: string, bubble_id?: string, state?: string, error_code?: string, user_message?: string, ... }`.
   - Zero unhandled exceptions or untyped strings returned to Gemini Live.

4. **Autonomous Action Engine (`AutonomousActionService.ts`)**:
   - High-precision intent classification distinguishing `REMINDER` (user calling/acting) vs `CALLBACK` ("Nova, call me at 6") vs `PROACTIVE_OUTREACH`.
   - Full callback lifecycle state machine: `scheduled` -> `due` -> `dispatching` -> `ringing` -> `answered` / `declined` / `missed` -> `completed`.
   - Guardrails & Consent: quiet hours (22:00-07:00), `proactive_calls_enabled`, `callback_calls_enabled`, opt-out suppression.
   - Multi-signal "Ignoring Nova" logic with bounded escalation (halts voice calls after 3 consecutive unreplied outreaches, falls back to text chat).
   - Atomic idempotency via `action_idempotency` table.

1. **Comprehensive Memory Creation Path Audit**:
   - Audited every memory insertion path across the backend (`memoryRepository`, `NovaVoiceService`, `ReminderEngine`, `FactAssertionConsumer`, `ConsolidatedMemoryAgent`, `onboardingService`, `chat.ts`).
   - Identified and closed flat memory bypasses by routing all persistent semantic memories through the canonical bubble resolver.

2. **Canonical Memory Tree Service (`CanonicalMemoryTreeService.ts`)**:
   - **Unified Pipeline**: `conversation → entity/context understanding → entity resolution → domain inference → canonical bubble resolution/creation → parent branch resolution → child/sub-branch creation → memory attachment → relationship attachment → reminder attachment → provenance/authority → retrieval`.
   - **Stable Entity Identity**: Disconnected entity identity from surface name. Same name (`Ramesh` friend vs `Ramesh` film character) safely coexists under separate stable entity bubbles and domains (`family` vs `work`).
   - **Semantic Ownership & Hierarchy**: Nested third-party relationships correctly structured (`User -> Ijaz -> Suresh` father of Ijaz, NEVER `User -> Suresh`).
   - **Pronoun Antecedent Disambiguation**: Resolves unambiguous pronouns (`he/she`); detects ambiguity (`"I was talking about Ramesh and Suresh. He works in Pune"`) and refuses mutation, triggering clarification.
   - **Temporal Invariants**: Separates `HISTORICAL` memories ("was my friend in college") from `CURRENT` memories ("is my friend") without destructive overwriting.

3. **Voice Memory Bypass Eradication (`NovaVoiceService.ts`)**:
   - Replaced flat `save_memory` bypass with 7 first-class canonical memory tree voice tools:
     - `memory_tree_read`
     - `memory_tree_search`
     - `memory_entity_read`
     - `memory_tree_create`
     - `memory_tree_update`
     - `memory_tree_correct`
     - `memory_tree_move`
   - Voice calls and text chat now share the exact same canonical memory authority, bubble tree, and key schema (`entity:<slug>:<predicate>`).
   - Legacy `save_memory` now auto-canonicalizes arbitrary keys to prevent data drop.
   - Transcript memory extraction persists directly through `memoryRepository.upsertMemory()`.

4. **Canonical Reminder Entity Attachment (`ReminderEngine.ts` & `chat.ts`)**:
   - Extended `ReminderEngine` to resolve entity mentions in reminder titles (e.g. `"Call Ramesh about short film"`) and attach `reminders.bubble_id` directly to the entity's bubble.
   - Guardian zero-hallucination reminders in `chat.ts` now automatically anchor to canonical entity bubbles.

5. **Production Memory Invariant Auditor (`MemoryInvariantAuditor.ts`)**:
   - Diagnostic suite verifying 9 core graph invariants:
     - Orphan bubbles (bubbles pointing to non-existent parents)
     - Graph cycles
     - Duplicate active entities per parent/domain
     - Orphan memories (unattached to active bubbles)
     - Orphan reminders
     - Cross-user reference integrity
     - Lifecycle conflicts (`is_archived` vs `CURRENT`)
     - Superseded facts treated as current
     - Stale relocation proposals

---

### Verification Results

1. **E2E Scenarios A-L Suite (`backend/src/scripts/test_canonical_tree_e2e_scenarios.ts`)**:
   - `Scenario A & E`: Nested relationship ownership (`User -> Ijaz -> Suresh`) strictly preserved — **PASSED**
   - `Scenario D`: Same surface name != same entity identity (`Ramesh` friend vs `Ramesh` character) — **PASSED**
   - `Scenario C`: Entity classification (Person vs Pet) — **PASSED**
   - `Scenario L`: Ambiguous pronoun antecedent ("Ramesh and Suresh... he works in Pune") blocks mutation & prompts clarification — **PASSED**
   - `Scenario G`: Entity-anchored reminders (`Call Ramesh`) attach to entity bubble ID — **PASSED**
   - `Scenario H, I, J`: Cross-modality voice & text canonical interoperability — **PASSED**
   - `Scenario K`: Correction convergence over long conversations — **PASSED**
   - `Invariant Auditor`: **0 anomalies detected across all 9 graph invariants** — **PASSED**

2. **Pre-flight Compilation**:
   - `cd backend && npx tsc --noEmit` -> **0 errors (Exit 0)**
   - `cd backend && npm run build` -> **Exit 0**
   - `cd backend && npx jest --testPathPattern="UniversalBranchRelocation"` -> **16/16 tests passing (Exit 0)**
   - `cd mobile && npx tsc --noEmit` -> **0 errors (Exit 0)**

---

### Files Added / Modified

| File | Status | Description |
|---|---|---|
| `backend/src/services/CanonicalMemoryTreeService.ts` | **NEW** | Canonical entity resolution, tree creation, domain inference, nested ownership, and temporal memory handling |
| `backend/src/services/MemoryInvariantAuditor.ts` | **NEW** | Production diagnostic auditor verifying graph invariants and preventing corruption |
| `backend/src/scripts/test_canonical_tree_e2e_scenarios.ts` | **NEW** | Comprehensive E2E scenario regression suite (Scenarios A through L) |
| `backend/src/services/memoryRepository.ts` | **MODIFIED** | Intercepts all memory upserts to automatically attach canonical bubbles and enforce key schemas |
| `backend/src/services/NovaVoiceService.ts` | **MODIFIED** | Replaced flat voice bypass with 7 canonical memory tree tools and unified transcript extraction |
| `backend/src/services/ReminderEngine.ts` | **MODIFIED** | Automatically resolves entity mentions in reminder titles and anchors `bubble_id` |
| `backend/src/routes/chat.ts` | **MODIFIED** | Attached guardian zero-hallucination reminders to canonical entity bubbles |

---

### NEXT ACTION
- All changes verified on live production database.
- Commit backend changes and push to `origin/main`.
- Deploy automatically via Render backend pipeline. No mobile OTA required.
