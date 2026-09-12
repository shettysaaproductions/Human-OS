# CURRENT TASK

## Task ID
AUTONOMOUS-MEMORY-TREE-AND-GRAPH-CURATION-ENGINE

## Objective
Abolish recurring memory tree and knowledge graph flaws (such as phantom empty nodes like "shreshth date of birth extra with no data", unmerged aliases, and conflicting values) by creating a dedicated continuous autonomous LLM & deterministic curator engine:
1. **Admission & Pruning Guard**: Hardened `GARBAGE_VALUE_PATTERNS` in `memoryFilters.ts` to block non-data placeholders (`not mentioned`, `none`, `null`, `undefined`, `unknown`, `no data`, `extra with no data`, etc.). Added `isPlaceholderValue` to `memoryDomains.ts` and `KgExplorerScreen.tsx` to prevent blank nodes from rendering or clustering.
2. **Canonical Schema Harmonization**: Added full date of birth aliases to `memoryKeySchema.ts` (`shreshth_date_of_birth`, `shresth_date_of_birth`, `son_date_of_birth`, `tiku_date_of_birth`, `child_date_of_birth`, `birth_date` aliases).
3. **AutonomousMemoryGraphCuratorService (NEW)**:
   - **Layer 1 (Deterministic Fast-Path)**: Prunes non-data memories (soft-tombstones with `lifecycle_state: 'INVALIDATED'`), purges working memory placeholders, purges phantom `kg_nodes` with empty attributes, and merges duplicate alias collisions into canonical keys.
   - **Layer 2 (LLM Semantic Curation)**: Prompts `complete('SUBCONSCIOUS', ...)` to cross-check the memory tree and KG nodes against raw user conversation proof from `chat_history`. Generates and applies removals, merges, updates, and additions.
   - **Audit Ledger & Cache Invalidation**: Logs every curation action to `nova_correction_ledger` and invalidates analytics and wardrobe caches (`wardrobes:${userId}`, `kg:${userId}`, `invalidateAnalyticsCache(userId)`).
4. **Continuous Execution & Pipeline Integration**:
   - `chat.ts`: Post-reply background invocation via `setImmediate`.
   - `WatchtowerMemoryAuditor.ts`: Continuous integration into supervisory memory audits.
   - `WatchtowerHeartbeatService.ts`: Bounded 15-minute supervisory pulse integration.
   - `queueWorker.ts`: Dedicated `curate_memory_graph` job handler under `maintenanceQueue`.

## Scope
- `backend/src/services/AutonomousMemoryGraphCuratorService.ts` (NEW)
- `backend/src/services/__tests__/AutonomousMemoryGraphCuratorService.test.ts` (NEW)
- `backend/src/lib/memoryKeySchema.ts`
- `backend/src/lib/memoryFilters.ts`
- `backend/src/lib/memoryDomains.ts`
- `backend/src/services/WatchtowerMemoryAuditor.ts`
- `backend/src/services/WatchtowerHeartbeatService.ts`
- `backend/src/workers/queueWorker.ts`
- `backend/src/routes/chat.ts`
- `mobile/src/screens/analytics/KgExplorerScreen.tsx`

## Verification Gates Passed
- `npm run build` in `backend`: EXIT 0 (0 errors).
- `npx tsc --noEmit` in `mobile`: EXIT 0 (0 errors).
- Test Suites:
  - `AutonomousMemoryGraphCuratorService.test.ts`: 3/3 passed (100%).
  - `WatchtowerMemoryAuditor.test.ts`: 4/4 passed (100%).
