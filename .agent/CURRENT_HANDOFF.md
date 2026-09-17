# CURRENT HANDOFF

## Last Updated
2026-09-17 — Canonical Kinship Hierarchy, Suresh/Rajeshree Identity Preservation & Universal Memory Relocation (v0.3.32-beta)

## Session / Agent
Agent: MonkeyCode
Branch: `main`

## Status: VERIFIED & PRODUCTION DEPLOYED (OTA v0.3.32-beta Published + Broadcasted)

### EAS Production OTA Deployment (v0.3.32-beta)
- **Update Group ID**: `5a9f3ea9-f4e2-4511-ac49-dac4585b6d5b`
- **Android Update ID**: `01a0ae19-f73c-7adb-aee6-17a41490a3bc`
- **iOS Update ID**: `01a0ae19-f73c-767f-a96c-70687a6bc925`
- **Runtime Version**: `1.1.0`
- **Branch**: `production`
- **Broadcast Push**: Dispatched to registered devices via `broadcast_update_push.ts`.

---

### Critical Problems Solved & Core Invariants Enforced (v0.3.32-beta)

1. **Biological Kinship Invariant & Suresh / Rajeshree Name Preservation**:
   - **Problem**: When user stated "mere papa bacho kapde bechte hai" and "mere mummy tailor ka shop run karti hai", the system extracted `father_name: "Papa"` and `mother_name: "Mommy"`, overwriting the real entities Suresh & Rajeshree and creating orphan `entity:papa` and `entity:mummy` bubbles that displaced their personal names from the bubble graph.
   - **Root Cause**: `memoryKeySchema.ts` included bare kinship vocatives (`papa`, `father`, `dad`, `mother`, `mom`, `maa`) in `father_name` and `mother_name` alias lists.
   - **Solution**:
     - `backend/src/lib/memoryKeySchema.ts`: Removed kinship vocatives from name aliases. Added canonical aliases for `father_business` (`papa_business`, `papa_store`, etc.) and `mother_occupation` (`mummy_occupation`, `mummy_tailor`, etc.).
     - `backend/src/lib/memoryFilters.ts`: Added admission guard in `isGarbageMemoryValue()` rejecting bare kinship vocatives for any `*_name` key.
     - `backend/src/services/CanonicalMemoryTreeService.ts`: Added Pattern 1.5 in `resolveEntity()`. Relational vocatives (`papa`, `pitaji`, `dad`, `father` vs `mummy`, `mom`, `maa`, `mother`) resolve strictly to the user's single biological father (`Suresh`) and mother (`Rajeshree`) bubbles.

2. **Attribute Stem Attachment under Suresh & Rajeshree**:
   - **Problem**: Parental detail statements created disconnected orphan bubbles rather than attaching as stems.
   - **Solution**:
     - `backend/src/services/CanonicalMemoryTreeService.ts`: `resolveOrCreateBubbleForMemory()` dynamically routes `father_*` (e.g. `father_business`) and `mother_*` (e.g. `mother_occupation`) to the canonical Suresh and Rajeshree entity bubbles.
     - `backend/src/lib/memoryDomains.ts`: `clusterMemoriesIntoWardrobes()` makes `father_business` and `mother_occupation` dynamic (`cleanStr(fatherBizVal)` and `cleanStr(motherOccVal)`).
     - `backend/src/lib/memoryDomains.ts`: `buildDynamicKnowledgeGraph()` dynamically displays `${fatherDisplayName}` (`Suresh (Father)`) and `${motherDisplayName}` (`Rajeshree (Mother)`), grouping all attributes into their respective branches.
     - `mobile/src/screens/analytics/KgExplorerScreen.tsx`: Maps `father_*` / `papa_*` and `mother_*` / `mummy_*` to `[Name] (Father)` and `[Name] (Mother)` with automatic deduplication.

3. **Autonomous Phantom Bubble Eradication**:
   - **Problem**: Conversational Hinglish phrases like `rehta hai`, `mere society mein`, `ka name sushant hai`, `bacho kapde`, `bechte hai` leaked into the bubble graph as standalone entities.
   - **Solution**:
     - `backend/src/services/AutonomousMemoryGraphCuratorService.ts`: Added Layer 3 `curateMemoryBubbles(userId)` pass that automatically merges phantom kinship nodes (`Papa`, `My Father`, `Mummy`) into canonical `entity:suresh` and `entity:rajeshree`, and prunes phantom phrase fragments.
     - Applied live remediation on user `62f9190b-1e1d-48d5-9667-12cd0bc3114b`: merged 3 phantom bubbles into Suresh and Rajeshree, purged 12 phantom phrase nodes, and restored active status for `father_name: Suresh`, `father_business`, `mother_name: Rajeshree`, and `mother_occupation`.

4. **Hard-Proof Memory Grounding for Fresh Replies**:
   - **Problem**: Fresh replies must strictly answer from saved hard-proof memories (`[MEMORIES]`), never confusing roles with names or speculating from conversational chat history.
   - **Solution**:
     - `backend/src/services/promptBuilder.ts`: Added Rule 4 to `ANTI-HALLUCINATION SHIELD` strictly enforcing that kinship roles must never be treated as personal names, and answers must be grounded on saved facts in `[MEMORIES]`.

5. **Dynamic Knowledge Graph Open Cupboard Stems & Pet Entity Fix**:
   - **Problem**: Named pets like `pet_coco_breed` were intercepted by the single-pet singleton block and collapsed into a generic `Pet Dog` node (`mem-entity-pet`) instead of a dedicated Level 2 entity branch (`mem-pet_coco`).
   - **Solution**:
     - `backend/src/lib/memoryDomains.ts`: Guarded single-pet block with `k.split('_').length < 3`. Multi-part entity keys (`pet_<name>_*`) seamlessly route to Level 2 entity branch generator, registering `mem-pet_coco` with emoji 🐶 and connecting Level 3 attribute stems.

6. **Universal Branch Relocation with Doubt Confirmation**:
   - **Problem**: Moving any memory bubble and its subtree across life domains (e.g. friend Ramesh in Family -> short film character in Work).
   - **Solution**:
     - Built `UniversalBranchRelocationService` with smart intent detection, antecedent tracking, doubt-explaining proposal engine, affirmative/negative confirmation detector, and atomic graph relocation.
     - Fully verified with 11 passing test cases.

---

### Verification Results

1. **Automated Unit Tests**:
   - `npx jest src/services/__tests__/UniversalBranchRelocation.test.ts`: **11 passed, 11 total**.
   - `npx jest src/services/__tests__/DynamicCupboardMemory.test.ts`: **4 passed, 4 total**.
   - `npx jest src/services/__tests__/ComprehensiveNova360RegressionCorpus.test.ts`: **17 passed, 17 total**.
   - `npx jest src/services/__tests__/FamilyNameSemanticsBugFix.test.ts`: **Passed**.
   - `npx jest src/services/__tests__/AutonomousMemoryGraphCuratorService.test.ts`: **Passed**.
   - `npx jest src/services/__tests__/wardrobeClustering.test.ts`: **Passed**.
   - `npx jest src/services/__tests__/memoryDomains.test.ts`: **Passed**.

2. **Pre-flight Typechecks**:
   - `cd backend && npm run build`: **Exited 0**.
   - `cd mobile && npx tsc --noEmit`: **Exited 0**.

3. **EAS Production OTA Release**:
   - Published successfully: Group ID `5a9f3ea9-f4e2-4511-ac49-dac4585b6d5b`.
   - In-app update modal registered in `mobile/src/config/updateHistory.json` (`v0.3.32-beta`).
   - Push notification broadcasted to all active devices.
