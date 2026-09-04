# Human-OS Session Continuity System

**Purpose:** Make this repository the durable source of truth for AI
engineering continuity. A fresh AI session (new account, new context, token
quota exhausted) must be able to open this repository and continue exactly
where the previous session stopped WITHOUT the old conversation.

This system stores durable engineering state only. It never stores a
conversation transcript.

**Boot document:** `SESSION_BOOT.md` at the repository root remains the
mandatory first-read boot document. It now points here for the live
continuity state. Do not create a competing boot system.

---

## 1. File Roles

| File | Role | Mutated by |
|---|---|---|
| `SESSION_BOOT.md` (repo root) | Mandatory first-read boot document; describes the system and points to `.agent/` | On architectural change only |
| `.agent/README.md` | This file. Explains the continuity system and protocols | Rarely |
| `.agent/CURRENT_TASK.md` | Stable description of the current task (objective, scope, non-goals, acceptance criteria, constraints, subsystem) | When a task starts or is re-scoped |
| `.agent/CURRENT_HANDOFF.md` | LIVE session state. The single authoritative handoff. All required sections below | At every handoff / checkpoint |
| `.agent/DECISIONS.md` | Durable engineering/architecture decisions with rationale | When a decision is made |
| `.agent/FINDINGS.md` | Durable technical discoveries that would otherwise be rediscovered | When a finding is confirmed |
| `.agent/scripts/check_continuity.sh` | Read-only validator: compares handoff record vs live git state | Never (read-only) |

`CURRENT_HANDOFF.md` is the live file. Everything else is append-only or
task-scoped reference.

## 2. Status Vocabulary

`CURRENT_HANDOFF.md` `## Status` must use exactly one of:

```
NOT_STARTED
INVESTIGATING
IMPLEMENTING
TESTING
BLOCKED
CHECKPOINTED
READY_FOR_REVIEW
COMPLETE
```

`## Safe To Continue?` is `YES` or `NO`. `NO` means a new session MUST STOP
and report the mismatch rather than coding.

`## NEXT ACTION` must always be a concrete action (file + command), never
"continue working".

## 3. Required Sections in CURRENT_HANDOFF.md

A handoff is not valid unless every section below is present:

```
# CURRENT HANDOFF
## Last Updated
## Session / Agent
## Current Task
## Objective
## Status
## Repository State
## Confirmed Findings
## Root Cause
## Decisions
## Implementation Completed
## Tests Added
## Test Results
## Known Failures
## Unresolved Questions
## Important Invariants
## DO NOT REDO
## NEXT ACTION
## Safe To Continue?
## Checkpoint Information
```

## 4. Command Triggers

| Command | Meaning |
|---|---|
| `CONTINUE HUMAN-OS` | Resume: boot, verify handoff vs repository, continue from NEXT ACTION |
| `HANDOFF SESSION NOW` | Full manual checkpoint (token-quota workflow, session switch) |
| `CHECKPOINT SESSION` | Same as HANDOFF SESSION NOW |
| `EMERGENCY HANDOFF` | Fast safety checkpoint: preserve WIP + minimal state, minimal prose |

### Boot / Resume Protocol (CONTINUE HUMAN-OS)

A new session MUST:

1. Read `SESSION_BOOT.md`.
2. Read `.agent/CURRENT_HANDOFF.md`.
3. Read `.agent/CURRENT_TASK.md`.
4. Read relevant entries in `.agent/DECISIONS.md` and `.agent/FINDINGS.md`.
5. Inspect Git status / branch / HEAD: `git status --short`, `git branch
   --show-current`, `git rev-parse HEAD`.
6. Verify the recorded checkpoint (run `.agent/scripts/check_continuity.sh`).
7. Detect stale / mismatched state (see Stale-State Detection below).
8. Continue only from `## NEXT ACTION`. Do NOT start coding first.

If the handoff matches repository state, report:

```
CONTINUITY VERIFIED
```

then continue from `## NEXT ACTION`.

If the handoff and repository disagree materially, STOP. Set `Safe To
Continue?` to `NO` in the report and describe the exact mismatch. Do not
code.

### Manual Checkpoint Protocol (HANDOFF SESSION NOW / CHECKPOINT SESSION)

1. Stop normal implementation.
2. Determine: current task, completed work, incomplete work, modified /
   untracked files, findings, decisions, test state, known failures, exact
   NEXT ACTION.
3. Update `.agent/CURRENT_HANDOFF.md` (all required sections).
4. Update `.agent/CURRENT_TASK.md` if the task changed.
5. Append durable findings / decisions.
6. Commit continuity state, then create/update a predictable WIP branch:

```
agent-checkpoint/<task-name>
```

   NEVER use `main` as the WIP checkpoint branch.
7. Record in `## Checkpoint Information`: branch, base commit, checkpoint
   commit, relevant files, working-tree state.
8. If credentials/access permit, push the checkpoint branch only.
9. Never force-push. Never reset or delete user work.

A checkpoint means "work is safely preserved and another session can
continue." It does NOT mean "production ready."

### Emergency Handoff (EMERGENCY HANDOFF)

Priorities, in order:

1. Preserve Git WIP (stash-free: commit on `agent-checkpoint/...`).
2. Record current task.
3. Record modified files.
4. Record confirmed findings.
5. Record exact NEXT ACTION.
6. Record test state.

Do not spend excessive context generating prose.

## 5. Stale-State Detection

A resume is STALE / MISMATCHED when any of the following is true:

- Current branch differs from `CHECKPOINT_BRANCH` in the handoff.
- `HEAD` does not equal or descend from `CHECKPOINT_COMMIT`.
- `git status --short` shows modified tracked files that the handoff does
  not account for (unexpected uncommitted work).
- Required handoff sections are missing.
- The task described in `CURRENT_TASK.md` disagrees with the handoff's
  current task.

`.agent/scripts/check_continuity.sh` automates detection. On any mismatch a
session MUST STOP and report, never code.

## 6. Checkpoint Branch Strategy

- Checkpoint branches: `agent-checkpoint/<task-name>`.
- The WIP checkpoint for a session switch is committed there and (if
  permitted) pushed, so a fresh session can fetch it.
- Only `main` receives production code, and only via an explicit, deliberate
  action. Render auto-deploys the backend on push to `main`, so pushing
  `main` is a production event.
- Never force-push. Never delete or reset user work.

## 7. Security Rules

NEVER write into handoff/continuity files:

- API keys
- Passwords
- Access / refresh tokens
- GitHub credentials
- EAS credentials
- Supabase service-role keys
- Environment secrets
- Raw production records
- Unnecessary PII

If sensitive information is encountered, record exactly:

```
Sensitive value observed; intentionally omitted.
```

Never log tokens in code or docs. Preserve Human-OS memory/auth/privacy
invariants (see `NOVA_PRINCIPLE.md`, `DATA_BOUNDARIES.md`,
`docs/AI_GUARDRAILS.md`).

## 8. Helper Script

`.agent/scripts/check_continuity.sh` is strictly read-only and
non-destructive. It never force-pushes, never resets, never deletes, never
modifies files, and never writes to `main`. Run it to verify a resume:

```bash
bash .agent/scripts/check_continuity.sh
```

Exit codes: 0 = verified, 1 = mismatch detected, 2 = usage/environment
error.

## 9. Relationship to Existing Documents

- `SESSION_BOOT.md` (root): boot + system state. Extended to reference this
  system; not replaced.
- `MEMORY.md` (root): long-term project memory (epochs, constraints).
- `docs/AI_HANDOFF.md`: historical, dated handoff log; not the live state.
- `docs/DECISIONS.md`: product/architecture decision log; product scope.
  `.agent/DECISIONS.md` records engineering-continuity decisions.
- `.agents/` (plural): platform agent-convention directory (AGENTS.md,
  HI_AGENT_RAM.md, rules). Untouched by this system. Do not confuse the two.
