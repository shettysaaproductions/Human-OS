# CURRENT TASK

## Task ID
SON-NICKNAME-DOB-ALIGNMENT-AND-FRONTEND-CHAT-UX-PHASE5

## Objective
1. Eliminate memory and Knowledge Graph misalignment for son Shreshth (Nickname: Tuku, Date of Birth: 17/02/2026):
   - TurnAnalyzer deterministic fact extraction for both `son_name` and `son_nickname` from `"my son shreshth nick name is tuku"`, Hinglish variations, and `<name> ka nickname <nick>`.
   - Deterministic birth date & birthday extraction for son (`son_birth_date`), wife (`wife_birth_date`), and user (`birth_date`).
   - Add all `tuku` and date of birth aliases to `backend/src/lib/memoryKeySchema.ts`.
   - Dedicated `trait-shreshth-birth-date` trait in Shreshth's Memory Wardrobe and dynamic age derivation in `memoryDomains.ts`.
   - Dynamic Knowledge Graph tree alignment (`Tuku (Nickname)` and `17/02/2026 (Birthday)` under Son branch with `BIRTHDAY` relation).
   - Memory Management route: add `son_birth_date`, `wife_birth_date`, `son_age` under `'Family'` category.
   - Mobile Knowledge Graph Explorer: align display names and birthday keys.
2. Frontend Chat Section Basic Bug Fixes & Lifestyle UX:
   - Optimistic message timestamp stability (instant current time instead of blank jitter).
   - Quick action chip safety (preserves & prepends to existing input drafts).
   - Expand lifestyle productivity with Habit (`🧘`) and Finance (`💰`) quick chips.
   - Header selection bar quote-reply (`↩️`) button.

## Scope
- `backend/src/lib/memoryKeySchema.ts` (aliases for `tuku` and son birth date).
- `backend/src/services/TurnAnalyzer.ts` (son name + nick extraction, deterministic birth date extraction, cleanValue word capitalization).
- `backend/src/lib/memoryDomains.ts` (Shreshth wardrobe dedicated birth date, dynamic age, KG labels and tree branches).
- `backend/src/routes/memoryManagement.ts` (KEY_LABELS and KEY_CATEGORIES for family birth dates and age).
- `mobile/src/screens/analytics/KgExplorerScreen.tsx` (tuku nickname and birth date display alignment).
- `mobile/src/screens/ChatScreen.tsx` (optimistic timestamp stability, quick action draft prepending, habit/finance chips, header quote-reply).
- `backend/src/services/__tests__/SonNicknameAndDobAlignment.test.ts` (11 unit tests).

## Verification Gates Passed
- `npm run build` in `backend`: EXIT 0 (0 errors).
- `npx tsc --noEmit` in `mobile`: EXIT 0 (0 errors).
- `SonNicknameAndDobAlignment.test.ts`: 11/11 PASSED (100%).
- `FamilyNameSemanticsBugFix.test.ts`: 12/12 PASSED (100%).
- `BackendChatCompanionHardening.test.ts`: 10/10 PASSED (100%).
- `NovaBrainService.test.ts`: 39/39 PASSED (100%).

## Autonomous Deployment
Standing user directive: automatically commit, merge, and push to `origin main`.
Push to `main` triggers Render backend deployment and GitHub Actions Mobile EAS OTA update.
