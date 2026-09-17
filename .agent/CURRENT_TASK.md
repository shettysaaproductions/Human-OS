# CURRENT TASK

## Task ID
NOVA-OS-PHASE-1-UNIFIED-EVENT-PIPELINE-v0.3.35

## Objective
Implement Phase 1 — Unified Event / Pipeline Foundation across Nova OS:
1. **Unified Event Ingress (`NovaEvent.ts`)**:
   - Establish typed events (`INPUT_TEXT`, `INPUT_VOICE_NOTE`, `INPUT_LIVE_VOICE_TURN`, `INPUT_VISION`, `SIGNAL_PRESENCE`, `TRIGGER_PROACTIVE`).
   - Discriminated ontological typing: `ENTITY`, `ATTRIBUTE`, `RELATIONSHIP`, `EVENT`, `OBSERVATION`, `INFERENCE`, `UNKNOWN`.
   - Strict provenance and confidence retention (`source`, `sourceMessageId`, `timestamp`, `confidence`, `acquisitionMode`, `evidenceText`).
2. **Contextual Entity & Anaphora Resolution (`NovaContext.ts`, `ContextualEntityResolver.ts`)**:
   - Conversational subject preservation (`activeEntity`, `activeDomain`, `recentEntities`).
   - Resolves pronouns ("he", "his", "she", "her", "that place", "there") and aliases ("Tiku", "my son") against active dialog context.
   - Enforces strict Entity Ownership (facts belong to entities, not domains).
   - Bounded indexed candidate retrieval from `memory_bubbles` (no full-table scans).
3. **Pipeline Module Contract & Registry (`NovaPipelineModule.ts`)**:
   - Predictable module interface:
     `INPUT → PROCESSOR → OUTPUT → EVENTS EMITTED → MEMORY EFFECT → DEPENDENCIES → PERMISSIONS`.
   - Topological dependency ordering and dynamic handler selection.
4. **Continuous Memory Reconciliation (`MemoryReconciliationModule.ts`)**:
   - Authoritative synchronization into `memory_bubbles` (entities) and `memories` (attributes with `bubble_id`).
   - Keeps `kg_nodes` in lockstep as a read projection to eliminate split brain.
   - Linguistic quality validation preventing rogue verbs or postpositions.
5. **Master Orchestration (`NovaPipelineOrchestrator.ts`)**:
   - 10-stage execution cycle connecting Chat, Voice, Memory, Goals, Reminders, and Proactive Pulses.

## Verification Gates Passed
- `NovaPipelineFoundation.test.ts`: **100% Passed (12/12 tests)**.
- `MemoryEntityQualityGate.test.ts`: **100% Passed (14/14 tests)**.
- `EntityResolutionService.test.ts`: **100% Passed (10/10 tests)**.
- `cd backend && npm run build`: **EXIT 0** (0 errors).
- `cd mobile && npx tsc --noEmit`: **EXIT 0** (0 errors).
- EAS Production OTA Published: Update Group `bee63f3d-5918-474b-b8cc-eb64f3e1a850` (Android `01a0b05d-8e6c-781c-ba99-b1f00be1db6b`, iOS `01a0b05d-8e6c-7297-ab0f-c24b857493f3`).
- Push broadcast dispatched to all registered user devices via `broadcast_update_push.ts`.
