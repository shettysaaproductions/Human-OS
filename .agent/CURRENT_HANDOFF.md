# CURRENT HANDOFF

## Last Updated
2026-09-17 — Phase 1: Unified Event / Pipeline Foundation (v0.3.35-beta)

## Session / Agent
Agent: MonkeyCode
Branch: `main`

## Status: VERIFIED & PRODUCTION DEPLOYED (OTA v0.3.35-beta Published + Broadcasted)

### EAS Production OTA Deployment (v0.3.35-beta)
- **Update Group ID**: `bee63f3d-5918-474b-b8cc-eb64f3e1a850`
- **Android Update ID**: `01a0b05d-8e6c-781c-ba99-b1f00be1db6b`
- **iOS Update ID**: `01a0b05d-8e6c-7297-ab0f-c24b857493f3`
- **Runtime Version**: `1.1.0`
- **Branch**: `production`
- **Broadcast Push**: Dispatched to registered devices via `broadcast_update_push.ts`.

---

### Core Architectural Advancements Delivered (Phase 1 Foundation)

1. **ONE BRAIN Event Pipeline (`NovaPipelineOrchestrator`)**:
   - Built a master 10-stage cognitive cycle orchestrator:
     `INPUT → CONTEXT HYDRATION → UNDERSTANDING & REFERENCE → MODULE SELECTION → ACTION/OUTPUT → EVENT EMISSION → MEMORY RECONCILIATION → CONTEXT PERSISTENCE → GUARDIAN SCAN → TELEMETRY`.
   - Normalizes disparate ingress streams (`INPUT_TEXT`, `INPUT_VOICE_NOTE`, `INPUT_LIVE_VOICE_TURN`, `INPUT_VISION`, `SIGNAL_PRESENCE`, `TRIGGER_PROACTIVE`) into typed `NovaEvent` envelopes.

2. **ONE CANONICAL MEMORY MODEL**:
   - Designated `memory_bubbles` as the single authoritative source of truth for semantic entities, hierarchy, and relationships.
   - Designated `memories` as the single authoritative store for semantic attributes/facts, strictly foreign-keyed via `bubble_id`.
   - Reconciled `kg_nodes` in lockstep as a backwards-compatible read projection, eradicating split-brain divergence.

3. **STRICT ENTITY OWNERSHIP**:
   - Every semantic fact belongs to the entity it actually describes (`subjectEntityId: "entity:person_shreshth"`).
   - Domains/categories (`family`, `work`, `lifestyle`, `goals`, `identity`) are strictly organizational namespaces/taxonomies and never owners of entity-specific facts.

4. **CONVERSATIONAL CONTEXT & PRONOUN CONTINUITY**:
   - Preserves conversational subject across turns in `EntityFocusState` (`activeEntity`, `activeDomain`, `recentEntities`).
   - Resolves antecedent references ("he", "his", "she", "her", "that place", "there", "Tiku", "my son") against conversational history before querying the database.

5. **FACT / EVENT / ENTITY DISTINCTION**:
   - Strongly-typed ontological classification:
     - `ENTITY`: Subjects with discrete identity (Person, Pet, Organization, Place, Venture).
     - `ATTRIBUTE`: Key-value state of an entity (e.g. birthdate, job, location).
     - `RELATIONSHIP`: Directed semantic edge between entities (e.g. `son_of`, `works_at`).
     - `EVENT`: Temporal occurrence (meeting, dinner, trip).
     - `OBSERVATION`: Raw sensor or signal data (tone, image, latency).
     - `INFERENCE`: Algorithmic/LLM hypothesis.
     - `UNKNOWN`: Unclassified candidate.

6. **PROVENANCE + CONFIDENCE**:
   - Every event and memory effect retains: `source`, `sourceMessageId`, `timestamp`, `confidence` (0.0–1.0), and `acquisitionMode` (`user_stated`, `observed`, `derived`, `inferred`), plus raw evidence quote.

7. **CONTINUOUS GRAPH RECONCILIATION**:
   - `MemoryReconciliationModule` continuously reconciles declared memory effects into `memory_bubbles` and `memories` with linguistic validation.

8. **BOUNDED INDEXED RETRIEVAL (NO FULL-DATABASE SCANS)**:
   - Queries `memory_bubbles` using bounded indexed lookups (`slug`, `label`, `metadata->aliases`), strictly limited to top candidate matches.

9. **PLATFORM-AWARE AUTONOMY**:
   - Platform constraints (`isAppForeground`, `canSpeak`, `canPush`, `isScreenLocked`) are first-class inputs into decision making.

10. **PREDICTABLE PIPELINE MODULE CONTRACT**:
    - Every capability exposes:
      `INPUT → PROCESSOR → OUTPUT → EVENTS EMITTED → MEMORY EFFECT → DEPENDENCIES → PERMISSIONS`.
    - Implemented `ChatPipelineModule`, `VoicePipelineModule`, and `MemoryReconciliationModule`.

---

### Verification Summary

| Suite / Check | Result |
| :--- | :--- |
| `NovaPipelineFoundation.test.ts` | **100% Passed (12/12 tests)** |
| `MemoryEntityQualityGate.test.ts` | **100% Passed (14/14 tests)** |
| `EntityResolutionService.test.ts` | **100% Passed (10/10 tests)** |
| Backend Production Build (`cd backend && npm run build`) | **Exit Code 0** |
| Mobile Pre-flight Typecheck (`cd mobile && npx tsc --noEmit`) | **Exit Code 0** |
| EAS Production OTA Publish (`v0.3.35-beta`) | **Published** (Group: `bee63f3d-5918-474b-b8cc-eb64f3e1a850`) |
| Broadcast Push Notification (`v0.3.35-beta`) | **Dispatched** to registered devices |

---

### Files Modified / Created

- `backend/src/pipeline/NovaEvent.ts` (NEW)
- `backend/src/pipeline/NovaContext.ts` (NEW)
- `backend/src/pipeline/NovaPipelineModule.ts` (NEW)
- `backend/src/pipeline/ContextualEntityResolver.ts` (NEW)
- `backend/src/pipeline/NovaPipelineOrchestrator.ts` (NEW)
- `backend/src/pipeline/modules/MemoryReconciliationModule.ts` (NEW)
- `backend/src/pipeline/modules/ChatPipelineModule.ts` (NEW)
- `backend/src/pipeline/modules/VoicePipelineModule.ts` (NEW)
- `backend/src/pipeline/__tests__/NovaPipelineFoundation.test.ts` (NEW)
- `mobile/src/config/updateHistory.json`
- `.agent/CURRENT_HANDOFF.md`
- `walkthrough.md`

## NEXT ACTION
Proceed to **PHASE 2 — CANONICAL MEMORY & GRAPH UNIFICATION**:
Migrate `GET /analytics/kg` to read directly from `memory_bubbles` and `memories` with `bubble_id`, eliminating all synthetic regex and name fallbacks in `memoryDomains.ts` and `KgExplorerScreen.tsx`.
