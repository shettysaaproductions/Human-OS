# Skill Observation Log

Observations captured during task-oriented work.

**Status key:** OPEN = not yet actioned | ACTIONED (YYYY-MM-DD) = skill updated/created | DECLINED (YYYY-MM-DD) = user decided not to pursue — resolved statuses always carry their resolution date

---


## 2026-08-20

### Observation 1: Prevent System Prompt / Subconscious Leak in LLM Response

**Status:** OPEN
**Date:** 2026-08-20
**Session context:** User uploaded screenshots showing Nova leaking '$' into the chat UI when trying to correct a mistake.
**Skill:** promptBuilder.ts / LLM Core Logic
**Type:** internal
**Phase/Area:** Extraction and Formatting

**Issue:** Nova outputted 'Corrected Response for Barfi Movie Reminder $ ...' directly into the user chat bubble. This happens when the model apologizes for a mistake and tries to provide a 'corrected response' rather than just outputting the raw JSON format expected by the parser.

**Suggested improvement:** Add a strict rule in promptBuilder.ts: NEVER acknowledge mistakes with 'Mistake acknowledged! Here is the corrected response...'. Always strictly adhere to the subconscious_actions block format and output the JSON without meta-commentary.

**Principle:** When an LLM is tasked with outputting a strict machine-readable format alongside human text, it must be forbidden from breaking the fourth wall or narrating its internal correction process, as this breaks parsing and exposes the system prompt.


### Observation 2: Reminder Engine Formatting

**Status:** OPEN
**Date:** 2026-08-20
**Session context:** Reminders outputted raw 'Time for:' text instead of conversational strings.
**Skill:** ReminderSchedulerService / promptBuilder
**Type:** internal
**Phase/Area:** Core Engine

**Issue:** The user uploaded a screenshot showing Nova saying 'Time for: Play Movie Barfi. Let me know once you''re done!'. This is hardcoded in ReminderSchedulerService.ts line 316, violating the anti-robot rules which mandate conversational, fluid LLM generation.

**Suggested improvement:** Remove hardcoded text. Generate a contextual, warm ping using NovaBrainService.evaluateConsciousnessTier2 for reminders so that the text isn't robotic.

**Principle:** Hardcoded string interpolation for user-facing outputs breaks the conversational illusion in a high-fidelity persona agent.

