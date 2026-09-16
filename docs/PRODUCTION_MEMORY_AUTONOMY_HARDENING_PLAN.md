# Human-OS Production Memory & Autonomy Hardening Plan

## Objective
Make Nova resilient to long, messy, multilingual conversations and protect the canonical memory graph from entity mix-ups, stale corrections, partial writes, and reminder drift.

## P0 — Canonical memory-bubble topology
- Introduce `memory_bubbles` as the canonical hierarchy: domain → entity → branch → attribute.
- Allow a bubble to have a parent bubble and arbitrary descendants.
- Attach `memories` and `reminders` to the bubble instead of inferring membership from string prefixes forever.
- Keep domain and relationship metadata on the bubble while preserving individual memory lifecycle state.

## P0 — Safe reclassification / move semantics
- Never infer an entity when the current message does not uniquely identify it.
- Never use hard-coded fallback names.
- Resolve ambiguous pronouns against recent conversation plus persisted memories; if more than one candidate remains, ask a clarification question rather than guessing.
- For high-impact identity/type changes (real person → fictional character, person → pet, relationship/domain change), show the previous belief, the new claim, what will move, and ask for explicit confirmation.
- A negative response is non-mutating.
- A positive response executes one database transaction.

## P0 — True subtree relocation
- Moving a bubble moves its complete descendant subtree.
- All attached memories move with the subtree.
- All attached active reminders move with the subtree.
- A target can be an existing bubble or a newly-created branch under any domain.
- Cycle creation is rejected.
- Ownership is checked server-side.
- Proposal freshness is checked with expected `updated_at` values so stale proposals fail closed.
- Transaction-scoped advisory locking serializes concurrent mutations for a user.
- Every move is auditable through `memory_bubble_moves` and `memory_events`.

## P0 — Unify correction logic
Existing correction, doubt, entity-resolution, and branch-relocation services should converge on the same canonical bubble operations. Regexes may detect high-confidence fast paths, but mutation authority belongs to the canonical transaction layer.

## P1 — Voice parity
Live voice, voice notes, text chat, and proactive sessions must all use the same memory read/write/correction tools. Voice must be able to read the current bubble tree during a session, not only extract memory at session end.

## P1 — Reminder integrity
Reminders should reference a bubble structurally instead of only carrying entity names in text/notes. A branch move therefore moves its reminders without fuzzy text matching.

## P1 — Proactive autonomy safety
Scheduled callbacks and autonomous outreach must have explicit lifecycle state, idempotency keys, cooldowns, quiet hours, attempt caps, and cancellation/opt-out paths. Missed or ignored outreach must never become an unbounded call loop.

## P1 — Data and schema invariants
Run continuous checks for:
- orphaned graph edges
- orphaned bubble references
- duplicate active canonical memory keys
- stale pending actions
- reminders whose lifecycle state conflicts with trigger data
- stale working-memory proposals
- missing ownership relationships
- writes to columns/functions that are absent from the live schema

## P0 security finding requiring a separate policy migration
The current Supabase project has many public tables with RLS disabled. RLS must be enabled with explicit owner/service policies before direct client access is allowed. This is intentionally separated from the relocation change so enabling RLS does not accidentally block legitimate application paths.

## Implemented in this pass
- Added canonical bubble tables and `bubble_id` references for memories/reminders.
- Added atomic subtree relocation RPCs with advisory locking, ownership checks, stale-proposal detection, cycle protection, and audit records.
- Replaced unsafe relocation logic that could guess entity names with ambiguity-safe resolution.
- Removed hard-coded `Ramesh` / `Simba` fallbacks.
- Added arbitrary target-branch creation support under a domain.
- Tightened confirmation parsing to short explicit confirmations only.
- Added relocation regression tests.
- Verified current production invariants: zero duplicate active memory-key groups, zero orphan KG edges, and zero orphan bubble references at the time of inspection.

## Next implementation order
1. Attach new extracted memories to canonical bubbles during normal ingestion.
2. Convert existing relationship-correction mutations to the same bubble transaction API.
3. Give live voice first-class `memory_tree_read/write/move/correct` tools.
4. Link reminder creation directly to the active bubble.
5. Repair and physically test Android audio routing and voice-message send path.
6. Add end-to-end production tests for text → memory → correction → move → reminder → voice replay.
7. Remediate RLS table-by-table with explicit policies.
