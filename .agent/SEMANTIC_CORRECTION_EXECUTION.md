# Semantic Correction Execution — Bounded Worker Task

## Objective
Fix the live correction path so natural-language corrections are interpreted semantically by the existing MEMORY LLM, then deterministically validated and persisted through exactly one writer.

Known failing user turn:
`Ek correction hai mera favourite color green hai ab`

Required semantic result:
- target concept: `favourite_color`
- value: `green`
- never `favourite_color_green`
- never `ab`

## Exact architecture
User turn -> correction intent classification -> existing MEMORY LLM -> semantic target/value -> deterministic validation -> MemorySemanticResolver -> existing MemoryRepository atomic correction persistence.

LLM decides meaning. Deterministic code only validates safety/grounding/canonicalization. Do not add Hinglish vocabulary dictionaries or regexes for `ab`, `abhi`, `filhaal`, `now`, etc.

## Exact files to inspect first
1. `backend/src/agents/ConsolidatedMemoryAgent.ts`
2. `backend/src/agents/DeterministicFactAgent.ts`
3. `backend/src/routes/chat.ts`
4. `backend/src/services/TurnAnalyzer.ts`
5. `backend/src/lib/MemorySemanticResolver.ts`

Do not explore unrelated repository areas.

## Required implementation
1. `TurnAnalyzer` may detect correction intent, but its `correctionTarget` and `correctionValue` are NOT authoritative and must never independently persist a correction.
2. `DeterministicFactAgent` must not persist correction facts. Non-correction deterministic facts must remain unchanged.
3. `ConsolidatedMemoryAgent` must use the existing `complete('MEMORY', ...)` call for correction interpretation. Do not add a second LLM/provider call.
4. Correction prompt must explicitly require semantic target/value extraction from the user's complete sentence and forbid deriving a key from the new value.
5. Validate the LLM result before persistence:
   - exactly one correction fact for a correction turn;
   - non-empty target and value;
   - target passes `MemorySemanticResolver` and is canonicalized;
   - value is grounded in the source user message after case/punctuation/whitespace normalization;
   - malformed/value-derived keys are rejected;
   - ambiguous or ungrounded output fails closed with zero correction mutation.
6. Preserve existing `MemoryRepository` correction/supersession behavior, provenance (`source_message_id` / turn reference), history, and exactly-one-CURRENT semantics.
7. Do not change the NVIDIA provider, add Google/Gemini, change DB schema, modify Supabase data, or deploy.

## Regression coverage
Add focused tests for semantic corrections without language-specific word dictionaries. At minimum cover:
- `Ek correction hai mera favourite color green hai ab` -> `favourite_color` / `green`
- `Actually, my favourite color is blue` -> `favourite_color` / `blue`
- `Correction: favourite colour red` -> `favourite_color` / `red`
- value-derived key such as `favourite_color_green` -> rejected
- missing/ungrounded value -> rejected
- correction writer remains singular

Tests must exercise the validation/persistence boundary, not only assert that helper functions exist.

## Verification
Run only targeted correction tests plus backend TypeScript typecheck. If a test requires live credentials, mark it blocked; do not invent a pass.

## Stop conditions
STOP immediately after the bounded implementation and targeted verification. Do not refactor unrelated code. Do not read broad architecture/docs. Do not deploy. Do not push/merge unless explicitly requested.

## Session handoff
If the worker must stop because of quota/network/runtime failure, update `.agent/CURRENT_HANDOFF.md` with:
- exact files changed
- exact tests run/results
- current blocker
- one concrete NEXT ACTION
- no secrets/PII

A fresh session must continue from that checkpoint and must not repeat repository discovery already recorded here.