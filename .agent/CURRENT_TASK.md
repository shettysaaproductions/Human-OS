# CURRENT TASK

## Task ID
NOVA-360-INTELLIGENCE-ENTITY-RESOLUTION-WATCHTOWER-RELIABILITY-UPGRADE

## Objective
Implement complete 360° Intelligence, Memory, Conversation & Companion Reliability Upgrade for Human-OS / Nova across all 53 mandate sections:
1. Abolish flat canonical key destruction of semantic context; preserve explicit subject ownership and multi-hop entity graphs (e.g. `Ijaz -> Father -> Navy` NOT `User -> Father -> Navy`).
2. Build dedicated Semantic Entity Resolution Layer (`EntityResolutionService`) resolving speaker, entities, pronouns, multi-hop kinship, and temporal states.
3. Establish first-class Correction & Repair Ledger (`nova_correction_ledger`), schema migration 067, and entity-scoped key support (`^entity:[a-z0-9_]+:[a-z0-9_]+$`).
4. Upgrade Dynamic Knowledge Graph (`buildDynamicKnowledgeGraph`) and Wardrobe Hierarchy (`clusterMemoriesIntoWardrobes`) to preserve multi-hop entity trees without collapsing into user root attributes.
5. Create Adaptive Watchtower Risk Scorer (`AdaptiveRiskScorer`) and Compounding Multi-Model Semantic Verification Service (`SemanticVerificationService`).
6. Wire verification loop into post-reply chat pipeline (`chat.ts`), invalidate analytics cache on memory mutations (`memoryRepository.ts`), and format entity-scoped nodes on mobile UI (`KgExplorerScreen.tsx`).

## Scope
- `backend/src/services/EntityResolutionService.ts` (NEW)
- `backend/src/services/AdaptiveRiskScorer.ts` (NEW)
- `backend/src/services/SemanticVerificationService.ts` (NEW)
- `backend/supabase/migrations/067_entity_scoped_memories_and_correction_ledger.sql` (NEW)
- `backend/src/lib/memoryKeySchema.ts` (Canonical key expansions & entity scoping)
- `backend/src/lib/memoryDomains.ts` (Dynamic KG multi-hop branch preservation)
- `backend/src/lib/SemanticInterpreter.ts` (Third-party entity ownership prompt)
- `backend/src/lib/SemanticValidator.ts` (Entity-scoped tokenizing & validation)
- `backend/src/services/TurnAnalyzer.ts` (Entity resolution integration & third-party suppression)
- `backend/src/services/memoryRepository.ts` (Analytics cache invalidation on memory mutations)
- `backend/src/routes/chat.ts` (Non-blocking adaptive verification loop in setImmediate)
- `mobile/src/screens/analytics/KgExplorerScreen.tsx` (Clean display for entity-scoped nodes)
- Unit & regression test suites:
  - `backend/src/services/__tests__/EntityResolutionService.test.ts` (NEW)
  - `backend/src/services/__tests__/SemanticVerificationService.test.ts` (NEW)
  - `backend/src/services/__tests__/TurnAnalyzer.test.ts`
  - `backend/src/services/__tests__/memoryDomains.test.ts`
  - `backend/src/__tests__/MemoryIntegration.test.ts`

## Verification Gates Passed
- `npm run build` in `backend`: EXIT 0 (0 errors).
- `npx tsc --noEmit` in `mobile`: EXIT 0 (0 errors).
- Test Suites: 5 passed, 5 total (74/74 unit tests passed, 100%).

## Deployment
Pushed commit `8e968f5` to `origin main`.
Automated GitHub Actions triggered Render backend deployment and production mobile OTA update.
