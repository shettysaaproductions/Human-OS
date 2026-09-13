# CURRENT TASK

## Task ID
BACKEND-LIFESTYLE-COMPANION-IMPACT-BUGS-FIXES-PART2

## Objective
Identify and fix fundamental backend architectural bugs across all sections to support diverse lifestyles (shift workers, students, night owls, couples, pet owners, freelancers, international users) and maximize Nova's autonomy as the smartest living companion:
1. **Situational Awareness (`SituationalAwareness.ts`)**:
   - Fixed raw `.includes('gn')` substring false positive in `detectConversationPhase` using strict word-boundary regex (`/\b(?:gn|bye|goodnight|good\s*night|ttyl|cya|ok\s*bye|alvida|soja|so\s*jao?)\b/i`). Words like `assignment`, `design`, `signal`, and `signature` no longer prematurely shut down conversations into `WINDING_DOWN`.
   - Defaulted `gapMinutes: number = 1` for consistent phase determination.
2. **Reminder Scheduler Reliability (`ReminderSchedulerService.ts`)**:
   - Fixed silent death of one-time reminders on gate suppression: if `finalStatus === 'SUPPRESSED'` and `!reminder.recurrence_type`, `trigger_at` is deferred (+60m for quiet hours, +15m for cooldown) instead of being permanently marked `completed`.
   - Defaulted `is_auto` to `false` in `scheduleReminder(..., isAuto: boolean = false)` and updated `isUserRequested = reminder.is_auto !== true` in `fireReminder`.
3. **User Life Stage & Daytime Flow (`UserLifeStageEngine.ts`)**:
   - Eliminated arbitrary 11am-8pm work focus lock for users without defined job/study schedules (now defaults to open `DAYTIME_FLOW` with `isWorkFocusHours = false` and `proactiveAllowance = 'FULL'`).
   - Added support for overnight shifts for shift workers where `shiftStartHour > shiftEndHour` (`localHour >= sStart || localHour < sEnd`).
   - Inspects `memMap` for `weekoff_day`, `day_off`, `weekly_off` to honor non-traditional off-days (e.g. Wednesday).
4. **Nova Consciousness Engine Awake Night-Owl Support (`NovaConsciousnessEngine.ts`)**:
   - Line 600 sleep window check updated to `if (tContext.isSleepWindow && !userIsActivelyChatting && !isSleepWindowOverridden)` so awake night owls (`isSleepWindowOverridden = true`) are not suppressed.
5. **Nova Brain Service Fallback & Grounding (`NovaBrainService.ts`)**:
   - Replaced hardcoded IST (+5.5) in `validateAndRepairGrounding` with dynamic profile timezone lookup.
   - Added `getNovaEmptyReply(isEnglish?: boolean)` with natural English empty reply fallback (`NOVA_EMPTY_REPLY_EN`).
6. **Reminder Engine & Intent Parsing (`ReminderEngine.ts`, `ReminderIntentDetector.ts`)**:
   - Broadened date parsing in `buildReminderSpecFromIntent` to include `tomorrow`, `tmrw`, `kal`, `parso`, `after N min`, `N minute baad`, `aadhe ghante baad`.
   - Added single day-of-week parsing (`on Monday`, `this Friday`, `Somwar ko`) calculating days ahead and setting `dateIdentified = true`.
   - Added recurring day detection (`every Monday`, `har Somwar`) setting `isRecurring = true`, `recurrenceType = 'weekly'`, and populating `activeDays`.
   - Cleaned weekday and relative time tokens in `cleanTaskTitle`.
7. **Universal Fact Extraction (`TurnAnalyzer.ts`)**:
   - Added relation extraction for `girlfriend_name`, `girlfriend_nickname`, `boyfriend_name`, `boyfriend_nickname`, and `partner_name`.
   - Added extraction for `pet_name` & `pet_type`, `sleep_time`, `wake_time`, and `work_mode`.
   - Guarded `fitness_routine` against future intentions (`start karna hai`) so they are classified as actions rather than factual habits.
8. **Render Restart Starvation Fix (`backend/src/index.ts`)**:
   - Fixed `momentInterval` (runs every 2 hours with initial 2.5 min boot warmup) and `dailyReflectionInterval` / `weeklyReflectionInterval` (checked hourly with date guards and initial 2 min boot warmup) so Render restarts never reset the 24-hour timer and starve background reflections/moments.
9. **Global Timezone Resolution (`BackgroundActionService.ts`)**:
   - Replaced hardcoded 3-country offset dictionary (`{ IN: 5.5, US: -5, UK: 0 }`) with dynamic profile timezone resolution via `resolveUserTzOffsetHours`.
10. **Action Intelligence Tenant Isolation (`ActionIntelligenceService.ts`)**:
    - Added `.eq('user_id', userId)` constraint to `executeConfirmedAction` update statement to guarantee tenant isolation.
11. **Curiosity Engine Lifestyle Inclusivity (`LifeBlueprintCuriosityEngine.ts`)**:
    - Broadened `sleep_time` (0..24h, night owls, shift workers), `wake_time`, `morning_starter` (smoothie, matcha, protein shake, lemon water), and `dinner_time`.
    - Added `pets_or_animals` registry entry to `FOUNDATIONAL_BLUEPRINT_REGISTRY`.

## Scope
- `backend/src/index.ts`
- `backend/src/services/SituationalAwareness.ts`
- `backend/src/services/ReminderSchedulerService.ts`
- `backend/src/services/UserLifeStageEngine.ts`
- `backend/src/services/NovaConsciousnessEngine.ts`
- `backend/src/services/NovaBrainService.ts`
- `backend/src/services/ReminderEngine.ts`
- `backend/src/services/ReminderIntentDetector.ts`
- `backend/src/services/TurnAnalyzer.ts`
- `backend/src/services/BackgroundActionService.ts`
- `backend/src/services/ActionIntelligenceService.ts`
- `backend/src/services/LifeBlueprintCuriosityEngine.ts`
- `backend/src/services/__tests__/BackendLifestyleCompanionImpactFixesPart2.test.ts`

## Verification Gates Passed
- `npm run build` in `backend`: **EXIT 0** (0 errors).
- `npx tsc --noEmit` in `mobile`: **EXIT 0** (0 errors).
- `BackendLifestyleCompanionImpactFixesPart2.test.ts`: **16/16 passed**.
- `TurnAnalyzer.test.ts`: **41/41 passed**.
- `SmartProactiveReminderEngine.test.ts`: **9/9 passed**.
- `SituationalAwareness.test.ts`: **3/3 passed**.
- `UserLifeStageEngine.test.ts`: **2/2 passed**.
- `ReminderEngine.test.ts` & `ReminderEngineBug03Followup.test.ts`: **31/31 passed**.
- `ReminderIntentDetector.test.ts`: **15/15 passed**.
- `BackendLifestyleCompanionImpactFixes.test.ts`: **8/8 passed**.
