# CURRENT TASK

## Task ID
NOVA-OS-PHASE-2-CANONICAL-MEMORY-ENTITY-ENGINE-v0.3.36

## Objective
Implement Phase 2 — Canonical Memory / Entity Engine across Nova OS:
1. **One Canonical Semantic Graph**:
   - `memory_bubbles` as Source of Truth for Entity Ontology and Hierarchy.
   - `memories` as Source of Truth for Facts/Attributes (strictly foreign-keyed via `bubble_id`).
   - `kg_nodes` / `kg_edges` as synchronized read-projections.
2. **Order-Independent Convergence (`CanonicalEntityEngine.ts`)**:
   - Any sequence of information discovery ("A is my son" -> "B is his nickname" -> "B born on date" vs "B born on date" -> "B is A's nickname" -> "A is my son") converges to the identical canonical entity graph.
3. **Safe Entity Merging & Reversible Audit Trail**:
   - Merges provisional entities into canonical entities with zero data loss.
   - Repoints memories, reminders, and child bubbles.
   - Safe archive with before/after audit snapshots in `memory_bubble_moves`.
4. **Strict Fact Ownership**:
   - Semantic facts belong strictly to the resolved entity bubble, never to domain compartments.
5. **Safe Existing Data Reconciliation (`SafeMemoryReconciler.ts`)**:
   - Reconciles legacy flat keys (`son_name`, `son_nickname`, `wife_name`, etc.) into entity bubbles.
   - Purges/archives corrupted phantom bubbles.
6. **Data-Driven Knowledge Galaxy (`CanonicalGraphService.ts`, `KgExplorerScreen.tsx`)**:
   - Eradicated all hardcoded person names and heuristic regexes.
   - Galaxy operates as a pure presentation view over canonical database truth.

## Verification Gates Passed
- `CanonicalMemoryConvergence.test.ts`: **100% Passed (5/5 tests)**.
- `NovaPipelineFoundation.test.ts`: **100% Passed (12/12 tests)**.
- `MemoryEntityQualityGate.test.ts`: **100% Passed (14/14 tests)**.
- `EntityResolutionService.test.ts`: **100% Passed (10/10 tests)**.
- `cd backend && npm run build`: **EXIT 0** (0 errors).
- `cd mobile && npx tsc --noEmit`: **EXIT 0** (0 errors).
- EAS Production OTA Published: Update Group `fbaa6043-000a-4e6f-b5c3-9c771e3df88b` (Android `01a0b071-2206-774c-be48-4851b744618d`, iOS `01a0b071-2206-7d4f-9a8e-55909f8b1b37`).
- Push broadcast dispatched to all registered user devices via `broadcast_update_push.ts`.
