# FINDINGS

Durable technical discoveries that a future session would otherwise have to
rediscover. Factual and concise. Append-only; never delete confirmed
entries. If a finding is later disproven, add a correction entry rather than
editing the original.

## 2026-09-04

### F-001: Repository layout and documentation tiers
The Human-OS repo has three documentation tiers that must not be conflated:
- Root-level markdown = canonical project memory and specs (SESSION_BOOT.md,
  MEMORY.md, NOVA_ARCHITECTURE.md, NOVA_PRINCIPLE.md, KNOWN_ISSUES.md,
  MODEL_ROUTER.md, COMPANION_VISION.md, MAGICAL_MOMENTS.md, LEARNING_LOOP.md,
  DATA_BOUNDARIES.md, many release/status docs).
- `docs/` = operational docs (AI_HANDOFF.md, DECISIONS.md, PROJECT_STATE.md,
  SESSION_LOG.md, AI_GUARDRAILS.md, INCIDENTS.md, TECH_DEBT.md, etc.).
- `.agents/` = tracked platform agent-convention directory (AGENTS.md,
  HI_AGENT_RAM.md, ANTIGRAVITY.md, memory/state.json, rules/) and is NOT a
  handoff/continuity store.

### F-002: No continuity system existed before this change
`docs/AI_HANDOFF.md` is a static, dated handoff (last major entry 2026-07-01)
describing an OTA incident and recovery; it is not a live state machine.
No `.agent/` directory and no CURRENT_TASK/CURRENT_HANDOFF convention existed.
MEMORY.md and SESSION_BOOT.md are knowledge documents, not per-session state.

### F-003: `main` push == production event
Render auto-deploys the backend on push to `main` (`.agents/AGENTS.md`,
MEMORY.md). EAS OTA that reaches installed test APKs must target the
`production` branch (`npx eas update --branch production`); `preview` does
not reach installed APKs. Local dev docs in `.agents/AGENTS.md` reference
Windows paths (`d:\Software\Human Os\Human-OS\...`) that do not exist in
this Linux workspace; treat them as the founder's machine layout, not the
current environment.

### F-004: This checkout is shallow (single commit)
`git log` shows exactly one commit (`6494bfb77c9edaeeb6393eb788906063c82b7f23`)
and `.git/shallow` exists. Full history is not available. Commands that
assume deep history (`git log --all`, merges, range diffs across many
commits) will behave unexpectedly. Checkpoint branches created from this
snapshot are still valid and pushable.

### F-005: Backend runtime is a 7-engine Nova architecture
Backend under `backend/src` orchestrates NovaBrainService, NovaConsciousnessEngine
(NACE), SituationalAwareness, MomentEngineService, ReflectionSchedulerService,
the NVIDIA BrainKeyRouter (lib/nvidia.ts), and promptBuilder.ts. ModelRouterService.ts
is NOT in the live request path (see MODEL_ROUTER.md). Supabase is the
datastore; memory writes must route through memoryRepository (canonical-key +
authority guards) and never bypass via direct supabaseAdmin upserts
(KNOWN_ISSUES.md, Aug 28-30 entries).

### F-006: Memory/state invariants that must never be weakened
See NOVA_PRINCIPLE.md and KNOWN_ISSUES.md. Deterministic correctionTarget
authority, user-turn-grounded correction values, semantic filtering,
canonical-key enforcement, atomic supersession, exactly one CURRENT where
required, history/provenance preservation, stale-write protection, no hard
deletion, and no cross-user mutation are the core memory invariants. Auth
must never fabricate authenticated state or treat known-invalid tokens as
valid. The Phase 2A Watchtower scan (Aug 30) confirmed 0 LLM calls and 0
core-state mutations in the read-only guardian.

### F-007: No secrets exist in continuity files by construction
The `.gitignore` blocks `.env*`, token/scratch/dump files, and dist. A scan
of `.agent/` finds no API keys, tokens, passwords, or PII. Any future writer
of `.agent/*` must preserve this invariant.

### F-008: Settings memory-navigation crash root cause (2026-09-04)
`SettingsScreen` navigated to `navigate('Brain', { screen: 'Memories' })` from
BOTH memory-management rows. `BrainNavigator` is a bottom-tab navigator whose
screens are Memory, Emotions, Graph, Goals, Timeline, Browser, Manage, Founder,
Beta — there is NO `Memories` screen. Navigating to a non-existent nested
screen is the crash trigger. Fixed by pointing both rows at the existing
`Manage` tab (MemoryManagementScreen). No other route references to
`'Memories'` remain in `mobile/src`.

### F-009: Backend memory API is already canonical; only the client was stale
`backend/src/routes/memoryManagement.ts` already returns canonical display
fields (`canonicalKey`, `label`, `category`, `value`, `memoryType`,
`importance`, `confidence`, `isArchived`, `createdAt`, `updatedAt`) and
already provides the full lifecycle: DELETE /memories/:id = forget (archive,
not hard delete), PATCH /memories/:id/archive = safe archive/unarchive with
lifecycle/duplicate guards, and PATCH /memories/:id = edit routed through
`memoryRepository.upsertMemory` with atomic supersession, canonical key always
derived from the stored row (client-supplied keys ignored), source authority
`explicit_user`. 35/35 route tests pass. Backend was NOT modified.

### F-010: PATCH /memories/:id supersedes the edited row with a new CURRENT id
An edit that changes a value creates a fresh CURRENT row (old row archived as
history), so the PATCH response returns the authoritative new `id`. The mobile
manager must adopt that `id` after save so subsequent in-session Archive/Delete
actions target the live CURRENT row, not the superseded one. Same-value edits
hit the idempotent reinforcement path and return the same row id.

### F-011: No Android/runtime crash evidence exists in this sandbox
No Android SDK, adb, emulator, or Java is installed; `CRASH_LOGS.md` is empty;
no Logcat/Metro stack trace is available. The crash is verified only at the
code level (invalid route target). Real-device behavior after the fix is NOT
device-verified in this environment.

### F-012: This workspace ships clean on a shallow clone
The environment starts from a single-commit clone of `origin/main`
(`6494bfb`). The fix branch exists on the remote and must be fetched
(`git fetch origin fix/settings-crash-memory-navigation`) before resuming.
Mobile deps install via `yarn install --frozen-lockfile`; backend via
`npm ci`. Backend jest for route tests needs dummy Supabase env placeholders
because `config` validates at import time (mocks still intercept DB access).
