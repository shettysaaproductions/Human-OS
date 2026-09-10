# CURRENT HANDOFF

## Last Updated
2026-09-11 — Watchtower Reflection Grounding, Prompt Leak Elimination & Feminine Grammar Hardening

## Session / Agent
Agent: MonkeyCode
Branch: `agent-checkpoint/watchtower-quality-grounding-fix`
Task: Fix prompt instruction leaks (`*No Formalities: Use "tu/tum/"*`), ground Watchtower post-reply reflections with exact calendar dates, prevent premature birthday celebration hallucinations, protect infant birth year 2026 from inversion to 2006, and sanitize Hinglish grammar/typos (female Nova).

## Confirmed Findings & Root Cause Analysis
1. **Smoking Gun for Leak:** In `backend/src/routes/chat.ts`, the `TIMEOUT_FALLBACK` route called a fast 8B model at `temperature: 0.9` with prompt text containing `- ONLY "Tu/Tera/Tujhe" or "Tum/Tumhara/Tumko"` and no conversation history. The small model parroted `*No Formalities: Use "tu/tum/"*`.
2. **Watchtower Temporal Blindspot:** In `WatchtowerReflectionService.ts`, reflections only received `localTimeStr: 1:22 AM` with no calendar date. Seeing `17/02/2026` at `1:22 AM`, Watchtower hallucinated that the user wanted to celebrate tomorrow morning and rewrote the bubble to: *"Arey, tu subah uthke Tiku ka bday mana sakte hai..."*.
3. **Compound Confusion & Age Inversion:** When user expressed confusion (*"I didn't understood"*), Nova lacked graceful error recovery and hallucinated *"Tiku ka bday 17/02/2006 hai, nahin 2026!"* flipping a 6-month-old infant into a 20-year-old.
4. **Hinglish Grammar Typos & Gender Inversion:** Typo `rata` instead of `raat`, literal masculine grammar `main samajh mein aata hoon` instead of `main samajh gayi`, and broken pronoun agreement `tu ... sakte hai` instead of `tu ... sakta hai`.

## Implemented Fixes
1. **Prompt Leak Defense (`backend/src/services/NovaBrainService.ts`):**
   - Upgraded `isPromptLeak`: Intercepts leaked rule headers, `no formalities`, `tu/tum`, `tu/tera/tujhe`, `anti-robot`, and bracketed rule blocks.
   - Upgraded `sanitizeReply`: Strips rule headers/fragments, fixes `rata` -> `raat`, fixes masculine literal translations to female first-person (`main samajh mein aata hoon` -> `main samajh gayi`), and repairs pronoun agreements (`tu ... sakte hai` -> `tu ... sakta hai`).
2. **Grounded Temporal Reflection (`backend/src/services/WatchtowerReflectionService.ts`):**
   - Injected full calendar ground truth (`localDateStr`, `localTomorrowDateStr`, month, year).
   - Injected explicit invariants against premature birthday celebrations, infant birth year 2026 protection, prompt rule echoes, and female voice.
   - Applied `validateAndRepairGrounding` and `sanitizeReply` as an absolute quality gate on Watchtower's own `corrected_content`.
3. **Grounding Validator & Recovery (`backend/src/services/NovaBrainService.ts`):**
   - `validateAndRepairGrounding`: Enforces infant birth year 2026 (never 2006), intercepts premature birthday party assumptions upon DOB statements, and ensures graceful humble recovery when user calls out mistakes.
4. **Chat Fallback Hardening (`backend/src/routes/chat.ts`):**
   - Replaced fragile `TIMEOUT_FALLBACK` prompt with in-voice female friend persona, lowered temperature from 0.9 to 0.65, passed recent conversation history.
   - Applied `validateAndRepairGrounding` and `sanitizeReply` across all fallback paths.
5. **Memory Canonical Keys (`backend/src/lib/memoryKeySchema.ts` & `SemanticInterpreter.ts`):**
   - Added canonical keys `wife_birth_date` and `son_birth_date` with comprehensive Hindi/Hinglish aliases.
6. **Lowered Conversational Temperature (`backend/src/services/ResponseIntelligence.ts`):**
   - Tuned temperature from 0.9/0.85 to 0.7 for stable, grounded output.

## Verification Status
- `npm run build` in `backend`: EXIT 0 (Passed clean).
- `npx jest src/services/__tests__/NovaBrainService.test.ts --no-coverage`: 33/33 tests PASSED (100%).
- `npx jest src/services/__tests__/watchtowerReflection.test.ts --no-coverage`: 4/4 tests PASSED (100%).

## NEXT ACTION
Request user authorization to merge `agent-checkpoint/watchtower-quality-grounding-fix` into `main` and push to production to trigger the Render deployment and GitHub Actions Mobile EAS OTA.


