# CURRENT HANDOFF

## Last Updated
2026-09-09 — Enable proactive curiosity follow-ups and fix presence schema bottlenecks

## Session / Agent
Agent: MonkeyCode
Task: Burst multi-message comprehension, durable family memory persistence, and proactive presence/curiosity follow-ups

## Current Task
PROACTIVE-PRESENCE-CURIOSITY & BURST-KINSHIP-MEMORY-PERSISTENCE: 
1. Enable Nova to proactively greet the user upon returning online / after idle gaps, exploring missing memory dimensions (e.g. asking about son Shreshth's age or wife Sakshi's work).
2. Fix presence and outreach schema bottlenecks in PostgreSQL that silently aborted NACE evaluations.
3. Ensure multi-message bursts comprehend all kinship inflections and persist durably in `memories`.

## Status
IMPLEMENTED, COMMITTED & LIVE-VERIFIED on `agent-checkpoint/burst-memory-persistence`.
Backend build `npm run build` exits 0. All 46 Jest tests pass. Live end-to-end NACE session_start test dispatched and persisted:
`[assistant] 2026-09-09T07:22:06.937607+00:00: Shreshth kitne saal ka hai?`

## Repository State
- Current branch: `agent-checkpoint/burst-memory-persistence`
- Commit: `1bfa4a6` (*feat(nace): enable proactive curiosity follow-ups and fix presence schema bottlenecks*)
- Base commit: `9358babb37ae967a57a1e05e55e8869b3ee9cf6d`
- Production changed: NO (checkpoint branch only; live DB updated via authenticated schema migrations and verified)

## Confirmed Findings & Root Cause
1. **Schema Mismatch Aborting NACE**:
   `NovaConsciousnessEngine.ts` queried `select('push_token, preferred_name, timezone_offset')` on `profiles`. Because `push_token` and `timezone_offset` columns didn't exist in PostgreSQL, PostgREST returned error `42703` (`data: null`). `if (!profile) return;` aborted immediately in 0ms on every NACE pulse and session start.
2. **Missing `user_presence_history` Table**:
   `presence.ts` errored with `PGRST205: Could not find the table 'public.user_presence_history'`, causing `latestHistory` and `awayDurationMinutes` to always be `null` and preventing `session_end_proactive_check` from ever firing.
3. **UTC Defaulting Causing False Sleep-Window Suppression**:
   Because `timezone_offset` was not set on `profiles`, `(profile.timezone_offset || 0) / 60` defaulted to UTC 0. Between 11:02 AM and 12:22 PM IST, UTC was 05:32 to 06:52 AM. Both `NovaFollowupService` (`hour < 7` -> quiet hours) and `NovaConsciousnessEngine` (`isSleepWindow: true`) classified the user as asleep in the middle of the Indian day and suppressed all proactive messages.
4. **Check Constraint on `nova_outreach_log.outreach_type`**:
   `nova_outreach_log_outreach_type_check` restricted `outreach_type` to a narrow list that excluded `'session_start'`, `'curiosity'`, and `'followup'`. When NACE attempted to reserve an outreach slot, PostgreSQL rejected the insert with check constraint violation, causing `ProactiveGate` to report `reservation_race` and suppress the intent.
5. **Prompt Over-Restraint on Missing Memories**:
   Tier 1 previously declared `"User came online" alone is NEVER a sufficient reason to reach out` and lacked any missing-memory context, forcing the model to choose `NO` even when fresh family facts had natural unresolved questions.

## Implementation Completed
1. **Database Migration 064 Applied & Active**:
   - `backend/supabase/migrations/064_add_profile_columns_and_presence_history.sql`:
     - Added `push_token`, `timezone_offset`, `country` to `public.profiles`.
     - Created `public.user_presence_history` with RLS and indexing.
     - Widened `nova_outreach_log_outreach_type_check` constraint to include `'session_start'`, `'curiosity'`, `'followup'`, `'reminder'`, `'nace'`.
     - Executed `NOTIFY pgrst, 'reload schema'`.
2. **Backend Route & Services Updated**:
   - `backend/src/routes/presence.ts`: Automatically computes and saves `timezone_offset` (minutes) from client timezone string on presence pings.
   - `backend/src/services/NovaFollowupService.ts`: Replaced hardcoded UTC 0 fallback with `resolveUserTzOffsetHours(profile)`.
   - `backend/src/services/NovaConsciousnessEngine.ts`:
     - Added `deriveMissingMemoryCuriosities(memories)` detecting unasked natural questions (e.g. Shreshth's age/school, Sakshi's work, user's occupation/city).
     - Integrated `missingMemoryCuriosities` into `hasGroundedReason`, Tier 1 context, and Tier 2 prompt.
     - Replaced UTC timezone fallback with `resolveUserTzOffsetHours(profile || undefined)`.
     - Updated Tier 1 rules to recommend YES with `triggerType: 'curiosity'` when user has unasked family details.
     - Updated Tier 2 prompt to generate a warm, concise Hinglish curiosity question.
3. **Burst Memory Persistence & Kinship**:
   - `SemanticValidator.ts`, `SemanticInterpreter.ts`, `SemanticTurnAgent.ts`, `ConsolidatedMemoryAgent.ts`, `chat.ts` updated and tested.

## Test & Live Validation Results
- `npm run build`: PASS (exit code 0).
- Automated test suites: PASS
  - `BurstMessageComprehension.test.ts`: 9/9 passed.
  - `NovaConsciousnessEngine.test.ts`: passed.
  - `NovaFollowupService.test.ts`: passed.
- Live Simulation on User `62f9190b-1e1d-48d5-9667-12cd0bc3114b`:
  - Profile loaded with `timezone_offset: 330` -> resolved hour: 12 (afternoon), `isSleepWindow: false`.
  - Memories loaded: son `shreshth`, wife `sakshi`, father `suresh`, mother `rajeshree`.
  - Curiosities derived: son's age/schooling unknown, wife's profession unknown.
  - Tier 1: YES (`session_start` / curiosity).
  - Tier 2 generated: *"Shreshth kitne saal ka hai?"*
  - ProactiveGate: ALLOW (`outreachId: 82e527f6-2169-4497-b7b2-f0ab75f6f081`).
  - Saved to `chat_history`: `chat_message_id: 'a6c27d66-762a-4b0d-a999-edc9a792a9b8'`.

## Important Invariants Preserved
- No tight polling loops added.
- In-flight memory and authority invariants preserved.
- No secrets or credentials committed.
- Production safety rules followed (work committed on checkpoint branch).

## NEXT ACTION
Request user authorization to merge `agent-checkpoint/burst-memory-persistence` to `main` and trigger production Render deployment.
