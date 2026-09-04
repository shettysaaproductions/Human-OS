# CURRENT TASK

## Task ID
CONT-SESSION-CONTINUITY

## Objective
Establish a durable session-continuity system inside the Human-OS
repository so that a fresh AI session (new account / token-quota switch /
expired session) can read the repository and continue exactly where the
previous session stopped, without the old conversation.

## Scope
- Create the `.agent/` continuity store: README.md, CURRENT_TASK.md,
  CURRENT_HANDOFF.md, DECISIONS.md, FINDINGS.md.
- Add a read-only continuity-state validator script.
- Extend (not replace) `SESSION_BOOT.md` so every AI session is instructed
  to boot through the continuity system.
- Define and document the boot/resume protocol (CONTINUE HUMAN-OS), manual
  checkpoint protocol (HANDOFF SESSION NOW / CHECKPOINT SESSION), and
  emergency handoff (EMERGENCY HANDOFF).
- Establish the `agent-checkpoint/<task-name>` WIP branch strategy.
- Create a durable Git checkpoint of the continuity infrastructure.

## Non-Goals
- NOT fixing the authentication bug.
- NOT fixing reminders, language, rate limits, Nova behavior.
- NOT deploying, OTA, merging, or pushing `main`.
- NOT altering runtime code under `backend/` or `mobile/`.
- NOT duplicating or replacing existing project memory documents.
- NOT building a competing boot system (SESSION_BOOT.md remains the boot
  document).

## Acceptance Criteria
1. `SESSION_BOOT.md` points to the continuity system.
2. `.agent/CURRENT_HANDOFF.md` contains every required section.
3. A checkpoint contains enough Git metadata (branch, base commit,
   checkpoint commit, files, working-tree state).
4. Resume detects matching state.
5. Resume detects stale state.
6. Sensitive values are rejected/omitted (none present).
7. WIP checkpointing does not target `main`.
8. `## NEXT ACTION` is explicit and concrete.
9. Existing Human-OS source is untouched except continuity infrastructure.
10. `git diff --check` is clean; validation commands report actual exit
    codes.

## Constraints
- Preserve Human-OS invariants: memory authority/supersession rules, auth
  non-fabrication, privacy (no tokens/PII in handoff).
- `main` must not be pushed. Render auto-deploys backend on push to `main`.
- Helper scripts must be safe and non-destructive.
- ASCII-only content; no secrets; no unnecessary PII.

## Relevant Subsystem
Repository meta / documentation / engineering-continuity infrastructure.
No runtime engine is touched. Runtime context this task respects:
7-engine Nova backend (`backend/`), Expo mobile app (`mobile/`), Supabase
storage, Render deploy, EAS OTA (`production` channel).

## Status (of THIS task)
COMPLETE once continuity infrastructure is committed on an
`agent-checkpoint/` branch and this handoff is validated.

## Queued Next Task (NOT STARTED)
Authentication bug. Explicitly out of scope for this task. To be opened by a
future session via a fresh task cycle: rewrite CURRENT_TASK.md and
CURRENT_HANDOFF.md (status NOT_STARTED), then begin root-cause investigation
in `backend/src`. Reference material: `docs/AI_HANDOFF.md`, `KNOWN_ISSUES.md`,
and the existing auth code under `backend/`.
