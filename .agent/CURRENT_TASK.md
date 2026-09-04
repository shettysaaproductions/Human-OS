# CURRENT TASK

## Task ID
MEMORY-SEMANTIC-CORRECTION

## Objective
Make natural-language memory corrections semantically correct while minimizing agent exploration and preserving the existing memory system.

## Known Failing Turn
`Ek correction hai mera favourite color green hai ab`
Expected: `favourite_color = green`.
Observed live pipeline: `favourite_color_green = ab`.

## Scope
- `backend/src/agents/ConsolidatedMemoryAgent.ts`
- `backend/src/agents/DeterministicFactAgent.ts`
- `backend/src/routes/chat.ts`
- `backend/src/services/TurnAnalyzer.ts`
- `backend/src/lib/MemorySemanticResolver.ts`
- focused correction tests only

## Required Architecture
Correction intent detection may be deterministic, but semantic target/value interpretation belongs to the existing `MEMORY` LLM call. Deterministic code validates grounding, canonicalization, and safety before the existing MemoryRepository correction/supersession path.

## Hard Constraints
- Exactly one authoritative correction persistence path.
- No Hinglish vocabulary/regex dictionary for filler words.
- No second LLM/provider call.
- Do not add Google/Gemini or change NVIDIA provider.
- Do not modify Supabase schema/data.
- Do not deploy or publish OTA.
- Do not refactor unrelated code.
- Do not read unrelated repository areas.

## Acceptance
- `favourite_color / green` for the known failing sentence.
- value-derived keys such as `favourite_color_green` rejected.
- ungrounded/missing semantic values fail closed.
- existing correction supersession/history/provenance remains intact.
- targeted tests pass and backend typecheck passes.

## Continuity
Read `SESSION_BOOT.md`, `.agent/CURRENT_HANDOFF.md`, and `.agent/SEMANTIC_CORRECTION_EXECUTION.md`. Continue only from `NEXT ACTION`. If blocked, checkpoint exact state; never repeat broad discovery.
