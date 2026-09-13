# CURRENT TASK

## Task ID
BACKEND-MEMORY-GRAPH-CURATOR-LIFESTYLE-HARDENING

## Objective
Harden HumanOS Backend Memory and Knowledge Graph subsystems for high-impact robustness and diverse lifestyles:
1. **Autonomous Memory Graph Curator (`AutonomousMemoryGraphCuratorService.ts`)**:
   - Eliminated hardcoded fallback birth dates (`17/02/2026` and `15/04/1992`).
   - Generalized infant contradiction reconciliation (Section 5) to dynamically extract birth dates from chat declarations and calculate age in months for any infant without requiring the child to be named `'Shreshth'` or forcing pre-baked dates.
   - Generalized real name vs nickname harmonization (Section 6) to detect explicit Hindi/Hinglish declarations (`[Name] ko pyaar se [Nickname] bulate hai`) or prune duplicates, completely eliminating forced `'Shreshth'` and `'Tiku'` overrides.
   - Generalized employment vs entrepreneurial venture collision (Section 7) to dynamically detect corporate employers and businesses without hardcoded `'Conviction HR'` or `"Shetty's Dhaba"` overrides.
   - Removed `.includes('navi')` check in Section 1c to safely protect Navy veterans' fathers from working memory deletion.
   - Fixed critical tenant isolation vulnerability in Section 2 by adding `.eq('user_id', userId)` to all `kg_edges` deletion queries.
2. **Entity Resolution Service (`EntityResolutionService.ts`)**:
   - Expanded relation patterns and normalization to include modern companions: `partner`, `girlfriend`, `boyfriend`, `fiance`, `dog`, `cat`, `pet`, `roommate`, `flatmate`, `colleague`, `boss`, `manager`, `mentor`.
   - Added named direct relation extraction for phrases like "My dog Bruno is a Golden retriever", "My girlfriend Priya loves photography", and "My flatmate Rohan works at Google", assigning `entityType: 'pet'` and scoped keys (`entity:pet_bruno:breed`, `entity:partner_priya:interest`, `entity:person_rohan:employer`).
   - Added `employer` and `interest` predicates, and guarded `name` assignment from overwriting previous predicates.
3. **Cognitive Context & Prompt Memory Enrichment (`CognitiveContextService.ts`, `chat.ts`)**:
   - Increased `CognitiveContextService` memory query limit from 50 to 150 items to eliminate memory starvation for active users.
   - Expanded conversational antecedents to track pets, girlfriends, boyfriends, and roommates for natural pronoun resolution.
   - In `chat.ts`, merged keyword search memories with CognitiveContext's conflict-resolved durable facts into `enrichedMemories` and passed them to `userLifeStageEngine`, `lifeBlueprintCuriosityEngine`, `situationCtx.goalMemories`, `TurnAnalyzer`, and `brainContext.memories`.
4. **Subconscious Entity Poisoning Prevention (`memoryRepository.ts`)**:
   - Added relational nouns (`dog`, `cat`, `pet`, `puppy`, `kitten`, `roommate`, `flatmate`, `colleague`, `manager`, `boss`, `mentor`) to `GENERIC_ENTITY_VALUES` blocklist.
5. **Memory Domains & Multi-Agent Watchtower Decontamination (`memoryDomains.ts`, `WatchtowerMemoryAuditor.ts`)**:
   - Decontaminated test fixtures (`Tiku`, `Shreshth`, `Conviction HR`) from generic family son wardrobe generation and audits.

## Scope
- `backend/src/services/AutonomousMemoryGraphCuratorService.ts`
- `backend/src/services/EntityResolutionService.ts`
- `backend/src/services/CognitiveContextService.ts`
- `backend/src/routes/chat.ts`
- `backend/src/services/memoryRepository.ts`
- `backend/src/lib/memoryDomains.ts`
- `backend/src/services/WatchtowerMemoryAuditor.ts`
- `backend/src/services/__tests__/MemoryAndGraphCuratorHardening.test.ts`

## Verification Gates Passed
- `npm run build` in `backend`: **EXIT 0** (0 errors).
- `npx tsc --noEmit` in `mobile`: **EXIT 0** (0 errors).
- `MemoryAndGraphCuratorHardening.test.ts`: **7/7 passed**.
- `AutonomousMemoryGraphCuratorService.test.ts`: **3/3 passed**.
- `SonNicknameAndDobAlignment.test.ts`: **11/11 passed**.
- `WatchtowerMemoryAuditor.test.ts`: **4/4 passed**.
- `EntityResolutionService.test.ts`: **10/10 passed**.
- `CognitiveContextService.test.ts`: **7/7 passed**.
- All 6 test suites and 42 tests: **100% PASSED**.
