# CURRENT TASK

## Task ID
WATCHTOWER-AUTONOMOUS-MEMORY-WARDROBE-TRUTH-AUDITOR-PHASE9

## Objective
Implement an autonomous Watchtower background worker system that continuously audits memory wardrobes against ground-truth chat history to:
1. Detect and autonomously resolve logical, biological, and temporal contradictions (e.g. 6-month-old infant assigned 1992 adult birth year).
2. Rectify entity cross-attributions (e.g. user answering "15/04/1992" to "tumhara birthday kab hai", which got mistakenly saved as `son_birth_date` instead of `birth_date`).
3. Correct inverted or colliding names and nicknames (`son_nickname: shreshth` -> `Tiku` confirmed from chat `Hum shreshth ko pyar se ghr pe tiku bulate hai`).
4. Separate core employment (`Conviction HR`) from side entrepreneurial ventures (`Shetty's Dhaba`).
5. Protect core memory invariants against LLM semantic downgrade or case-churn overwrites.
6. Guard frontend wardrobe synthesis against rendering biologically impossible infant DOBs.
7. Autonomously queue genuine ambiguities into `nova_followups` as friendly clarification questions for Nova to ask the user.

## Scope
- `backend/src/services/WatchtowerMemoryAuditor.ts` (NEW)
- `backend/src/services/__tests__/WatchtowerMemoryAuditor.test.ts` (NEW)
- `backend/src/lib/memoryDomains.ts` (Defensive biological guard & nickname fallback)
- `backend/src/services/WatchtowerReflectionService.ts` (Wired into `harmonizeAndAuditMemories`)
- `backend/src/workers/queueWorker.ts` (Wired into `reconcile_facts` maintenance job)

## Verification Gates Passed
- `npm run build` in `backend`: EXIT 0 (0 errors).
- `npx tsc --noEmit` in `mobile`: EXIT 0 (0 errors).
- `WatchtowerMemoryAuditor` Unit Test Suite: 3/3 PASSED (100%).
- Regression Test Suites (`WatchtowerInspector.test.ts`, `SonNicknameAndDobAlignment.test.ts`, `DynamicCupboardMemory.test.ts`): 25/25 PASSED (100%).
- Live database memory reconciliation executed cleanly on production user:
  - `son_birth_date`: Reconciled to `17/02/2026`.
  - `birth_date` / `user_birth_date`: Reconciled to `15/04/1992`.
  - `son_nickname`: Reconciled to `Tiku`.
  - `company_name`: Reconciled to `Conviction HR`.
  - `venture_name`: Reconciled to `Shetty's Dhaba`.
  - `work_schedule`: Restored to `Monday to Saturday, 11 AM to 8 PM at Conviction HR`.
  - `goals`: Restored to `Scaling Conviction HR and hiring top talent (target: 8 selections)`.

## Autonomous Deployment
Standing user directive: automatically commit, merge, and push to `origin main`.
Commit `7259754` pushed to `origin main`, triggering automated Render deploy.
