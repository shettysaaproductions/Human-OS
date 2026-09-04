# HumanOS Specific Agent Rules

## Canonical Session Boot
Before doing work on this repository:
1. Read `SESSION_BOOT.md`.
2. Read `.agent/CURRENT_HANDOFF.md`.
3. Read `.agent/CURRENT_TASK.md`.
4. Read `.agent/DECISIONS.md` and `.agent/FINDINGS.md` when relevant.
5. Run `bash .agent/scripts/check_continuity.sh` when resuming checkpointed work.

The `.agent/` (singular) directory is the canonical continuity store. `SESSION_BOOT.md` is the canonical project boot document.

## Single Coding-Agent Policy
MonkeyCode is the single active coding agent for this repository. Do not invoke, simulate, or route work through additional coding agents, subagents, planner/execute personas, or agent-to-agent mediators unless the user explicitly requests a separate review workflow.

The retired `hi agent`, `hi agent init`, `bye agent`, `update agent`, and `train agent` command framework is not part of the active repository workflow.

## Git / Production Safety
- WIP work must use `agent-checkpoint/<task-name>` branches, never `main`.
- Never push `main` unless the user explicitly authorizes a production change.
- `main` pushes may trigger the production Render deployment workflow; treat them as production events.
- Before any production-bound backend change: run `cd backend && npm run build` and require exit 0.
- User manually redeploys Render after an authorized `main` push.
- OTA updates, when explicitly authorized for mobile changes, target the configured production EAS branch/environment. Do not run an OTA or EAS build merely because a code change was made.
- Never expose or commit secrets, credentials, tokens, or unnecessary PII.

## Continuity Checkpoint Protocol
For quota/session interruption:
- Preserve WIP on an `agent-checkpoint/<task-name>` branch.
- Update `.agent/CURRENT_HANDOFF.md` with confirmed findings, implementation state, tests, known failures, and one concrete `NEXT ACTION`.
- A checkpoint is not production approval and must not be merged or deployed automatically.
- On a fresh session, verify branch/commit state before continuing; if continuity validation fails, stop and investigate rather than guessing.

## Human-OS Runtime Constraints
- Preserve the existing memory invariants and no-hard-delete policy.
- Do not add tight polling loops or unnecessary LLM calls.
- Respect Supabase, Render, NVIDIA, and EAS free-tier limits documented by the canonical project docs.
- Preserve Human-OS runtime OTA/update functionality and Nova runtime self-improvement/model-routing functionality; these are product behavior, not the retired coding-agent framework.
- After a new database migration, reload the Supabase schema cache as required by the project documentation.

## Scope Discipline
Do not modify production runtime code for a documentation/continuity task. Do not deploy, OTA, or push `main` unless explicitly requested. Prefer small, verifiable commits and independent review before production approval.

## Legacy Documentation
Historical agent-workflow files may remain in `.agents/` as archived documentation unless explicitly retired. They are not active instructions under this file.
