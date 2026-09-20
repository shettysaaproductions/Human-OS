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

## Autonomous Execution & Auto-Proceed Policy
- **Auto Implementation Plan Proceed**: ENABLED by standing user authorization. When an implementation plan (`implementation_plan.md`) is created or updated, set `RequestFeedback: false` and proceed directly to code execution, verification, and deployment in the same flow without pausing or blocking for manual user approval.
- **Autonomous Push & Deployment**: Per standing user directive ("ALWAYS PUSH TO MAIN FOR WHAT EVER CHANGES ARE MADE AND ALSO PUSH OTA WHEN EVER NEEDED WITHOUT ASKING ME AGAIN IN THIS CHAT"), the agent has full standing authorization to test, merge checkpoint branches to `main`, push to `origin main`, and trigger OTA updates autonomously without asking.

## Git / Production Safety
- WIP work can be implemented directly or on `agent-checkpoint/<task-name>` branches, and automatically verified and merged into `main`.
- Production changes must pass `cd backend && npm run build` and `cd mobile && npx tsc --noEmit` before pushing to `origin main`.
- Pushes to `main` automatically deploy to Render backend.
- Never expose or commit secrets, credentials, tokens, or unnecessary PII.

### Mandatory OTA & Update Notification Protocol (NEVER MISS)
Whenever runtime, mobile, intelligence, or prompt updates are completed:
1. **Changelog & In-App Update Notification Modal**:
   - Always insert a new entry at index `0` of `mobile/src/config/updateHistory.json` with the new version (e.g. `v0.x.x-beta`), current date, title, and bullet points.
   - This ensures the in-app update notification modal triggers automatically on user device launch.
2. **Pre-flight Typecheck**:
   - Verify `cd mobile && npx tsc --noEmit` exits with 0.
   - Verify `cd backend && npm run build` exits with 0.
3. **EAS Production OTA Publish**:
   - Must include `--environment production`:
     `cd mobile && npx eas update --branch production --environment production --message "<commit/feature description>"`
4. **Broadcast Push Notification**:
   - Dispatch update notification to all registered user push tokens:
     `cd backend && npx ts-node src/scripts/broadcast_update_push.ts "v0.x.x-beta"`
5. **Continuity Logging**:
   - Record the Update Group ID, Android/iOS Update IDs, and version in `.agent/CURRENT_HANDOFF.md`.
   - Commit and push to `origin main`.

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

## Living Archify Diagram Synchronization
Whenever modifying core services (`backend/src/services/`, `auth.ts`, `DEPLOYMENT.md`, or memory workers), review the corresponding Archify `.json` diagram specification, update any changed relationships or stages, and run `archify deliver` to recompile the HTML artifact per [.agents/rules/archify_sync.md](file:///C:/Users/Laptop%206/Documents/Human%20Os/.agents/rules/archify_sync.md).

## Scope Discipline
Do not modify production runtime code for a documentation/continuity task. Do not deploy, OTA, or push `main` unless explicitly requested. Prefer small, verifiable commits and independent review before production approval.

## Legacy Documentation
Historical agent-workflow files may remain in `.agents/` as archived documentation unless explicitly retired. They are not active instructions under this file.
