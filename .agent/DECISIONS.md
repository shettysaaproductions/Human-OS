# DECISIONS

Engineering-continuity decisions. One entry per decision. Durable and
append-only. Do not delete historical entries.

Format:
| Date | Decision | Reason | Alternatives considered | Consequence |

## 2026-09-04

### D-001: Adopt `.agent/` as the continuity store location
- **Decision:** Place the live handoff system under `.agent/` (singular) at
  the repository root.
- **Reason:** The mission spec requires `.agent/`. The pre-existing
  `.agents/` (plural) directory is the platform agent-convention store
  (AGENTS.md, HI_AGENT_RAM.md) and is not a handoff system; mixing concerns
  there would couple platform rules with engineering state. Root-level keeps
  continuity visible to any session that opens the repository.
- **Alternatives considered:** (a) reuse `.agents/`; (b) put state under
  `docs/`; (c) single mega-file at root.
- **Consequence:** A dedicated, greppable store exists at `.agent/`.
  `.agents/` and `docs/` remain untouched. SESSION_BOOT.md bridges to it.

### D-002: Extend SESSION_BOOT.md; do not create a competing boot doc
- **Decision:** SESSION_BOOT.md remains the mandatory boot document and is
  extended with the continuity boot/resume protocol.
- **Reason:** SESSION_BOOT.md is already the established first-read doc.
  A second boot file would create ambiguity about which is authoritative.
- **Alternatives considered:** new root BOOT.md; embedding protocol only in
  `.agent/README.md`.
- **Consequence:** One boot path. Sessions read SESSION_BOOT.md first, then
  follow pointers into `.agent/`.

### D-003: CURRENT_HANDOFF.md is the single live handoff
- **Decision:** One live file, `.agent/CURRENT_HANDOFF.md`, with the fixed
  required-section schema (19 sections), updated at every checkpoint. All
  other files are reference/append-only.
- **Reason:** A single authoritative current-state file prevents split-brain
  between competing summaries (e.g. MEMORY.md vs docs/AI_HANDOFF.md vs
  SESSION_UPDATES.md). The fixed schema forces completeness and makes state
  machine-checkable.
- **Alternatives considered:** per-task handoff files; timestamped handoff
  history files as the live record.
- **Consequence:** Resumes are deterministic: read the one file, verify
  against git, follow NEXT ACTION. Older handoffs are replaced, not kept, in
  this file; durable knowledge moves to DECISIONS/FINDINGS.

### D-004: Git state is the source of truth for "what changed"
- **Decision:** Continuity records capture only durable knowledge; file-level
  truth (modified files, branch, HEAD, clean/dirty) is read from git at
  resume time and cross-checked against the handoff's recorded metadata.
- **Reason:** Handoff prose goes stale; git does not. Cross-checking the
  recorded CHECKPOINT_BRANCH / BASE_COMMIT / CHECKPOINT_COMMIT against live
  git is the stale-state detector.
- **Alternatives considered:** duplicating full file inventories in prose.
- **Consequence:** Stale/mismatched state is detectable mechanically
  (`.agent/scripts/check_continuity.sh`).

### D-005: Checkpoint branches named `agent-checkpoint/<task-name>`; never main
- **Decision:** WIP checkpoints are committed on branches named
  `agent-checkpoint/<task-name>`. `main` is never a WIP target.
- **Reason:** Pushing `main` triggers an automatic Render backend deploy and
  is a production event. Checkpoint branches are also the durable vehicle a
  fresh session fetches to continue.
- **Alternatives considered:** committing WIP directly on `main`;
  stash-based preservation.
- **Consequence:** WIP is preserved without any production side effect.
  Pushes are branch-only and never force-pushed.

### D-006: Helper tooling is strictly read-only
- **Decision:** The only helper script,
  `.agent/scripts/check_continuity.sh`, reads git and handoff state and never
  modifies, deletes, resets, force-pushes, or writes to main.
- **Reason:** A validator must be safe to run in any session without risk to
  user work.
- **Alternatives considered:** a script that auto-commits or auto-updates the
  handoff.
- **Consequence:** Verification is a single safe command; all state mutation
  remains a deliberate AI action following the protocols in README.md.

### D-007: Never write secrets or PII into continuity files
- **Decision:** Continuity files never contain API keys, tokens, passwords,
  credentials, or unnecessary PII. If sensitive material is encountered, the
  file records only: "Sensitive value observed; intentionally omitted."
- **Reason:** These files are committed to a repository and read by fresh
  sessions; a leaked credential would be a permanent, widespread exposure.
- **Alternatives considered:** encrypted vault file in-repo.
- **Consequence:** Handoff is safe to commit and share; credential rotation
  is never forced by a continuity leak.

### D-008: Runtime tests are out of scope for continuity changes
- **Decision:** Continuity infrastructure changes (docs + read-only script)
  do not require running Human-OS runtime test suites; they require
  continuity validations (section presence, state-match, stale detection,
  secret scan, git hygiene).
- **Reason:** No production code path is modified, so backend/mobile test
  results would be unchanged noise.
- **Alternatives considered:** forcing full backend/mobile suites on every
  doc change.
- **Consequence:** Validation is fast and meaningful. When a task touches
  runtime code, that task's cycle runs the runtime suites instead.
