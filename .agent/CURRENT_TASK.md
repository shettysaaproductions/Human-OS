# CURRENT TASK

## Task ID
OPEN-CUPBOARD-DYNAMIC-MEMORY-ARCHITECTURE-DRAWERS-AND-STEMS-PHASE6

## Objective
1. Transform Human-OS / Nova memory management system into an open-ended Cupboard Architecture:
   - 5 Life Domain Compartments (`family`, `work`, `goals`, `lifestyle`, `identity`).
   - Dynamically synthesize 100s of Entity Drawers (Level 2 Branches) for arbitrary topics (pets, friends, mentors, tech ventures, instruments, vehicles, sports, health, travel).
   - Dynamically attach Sub-drawers / Stems (Level 3 Attributes) to owning entity branches (`ATTRIBUTE_STEM` edges).
2. Parallel Worker & Consumer Alignment:
   - `SemanticInterpreter`, `FactAssertionConsumer`, and `DeterministicFactAgent` route arbitrary multi-segment keys dynamically to life domain compartments via `classifyDomain`.
   - `memoryManagement.ts` routes and formats dynamic keys for frontend views.
3. Frontend Bug Fixes & UX Stability:
   - `ChatScreen.tsx`: Reset search, selection, and quote-reply states on New Chat.
   - `KgExplorerScreen.tsx`: Dynamically format and group arbitrary entity branches and attribute stems.

## Scope
- `backend/src/lib/memoryDomains.ts` (Dynamic Drawer Synthesizer Section G, word boundary emoji regex, Level 2 Entity Branches & Level 3 Stems).
- `backend/src/routes/memoryManagement.ts` (Dynamic domain categorization and title formatting).
- `backend/src/consumers/FactAssertionConsumer.ts` (Dynamic domain routing).
- `backend/src/agents/DeterministicFactAgent.ts` (Dynamic domain routing).
- `backend/src/lib/SemanticInterpreter.ts` (Open cupboard extraction prompt instructions).
- `mobile/src/screens/analytics/KgExplorerScreen.tsx` (Dynamic branch & stem hierarchy rendering).
- `mobile/src/screens/ChatScreen.tsx` (New Chat state reset).
- `backend/src/services/__tests__/DynamicCupboardMemory.test.ts` (4 unit tests).

## Verification Gates Passed
- `npm run build` in `backend`: EXIT 0 (0 errors).
- `npx tsc --noEmit` in `mobile`: EXIT 0 (0 errors).
- `DynamicCupboardMemory.test.ts`: 4/4 PASSED (100%).
- `wardrobeClustering.test.ts`: 13/13 PASSED (100%).
- `memoryDomains.test.ts`: 2/2 PASSED (100%).
- `SonNicknameAndDobAlignment.test.ts`: 11/11 PASSED (100%).
- Total Memory Suite: 30/30 PASSED (100%).

## Autonomous Deployment
Standing user directive: automatically commit, merge, and push to `origin main`.
Push to `main` triggers Render backend deployment and GitHub Actions Mobile EAS OTA update.
