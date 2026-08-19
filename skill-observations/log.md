# Skill Observation Log

Observations captured during task-oriented work.

**Status key:** OPEN = not yet actioned | ACTIONED (YYYY-MM-DD) = skill updated/created | DECLINED (YYYY-MM-DD) = user decided not to pursue

---

## 2026-08-19

### Observation 1: Conservative offline gap kills proactive AI messaging

**Status:** OPEN
**Date:** 2026-08-19
**Session context:** Fixing Nova AI proactive outreach not firing despite NACE running every 3 minutes
**Skill:** New skill candidate: proactive-ai-messaging-debug
**Type:** internal

**Issue:** NACE (Nova Autonomous Consciousness Engine) was pulsing every 3 minutes but never sending proactive messages. Root cause: `effectiveMinGap` for `offline` users was set to 15 minutes. Since NACE needs gapMinutes >= effectiveMinGap, and most users are offline between sessions, Nova needed a 15-minute silence window PLUS 5-8 minute dynamic gap PLUS Key 3 (Cerebellum) to not be rate-limited — three conditions that rarely all aligned. Result: 100% silence.

**Suggested improvement:** For proactive AI companions, offline gap should be 5 minutes max. The user expects proactive messages after stepping away briefly. 15 minutes is too conservative for a companion app.

**Principle:** When building proactive AI messaging systems, gap thresholds must be tuned to the app's social contract. A companion app needs 3-5 min offline gap; a business bot needs 15-30 min. The default must reflect the persona promise.

---

### Observation 2: Tier1 LLM prompt can contradict actual code gate values

**Status:** OPEN
**Date:** 2026-08-19
**Session context:** NACE Tier1 was saying shouldReach=false despite code allowing outreach
**Skill:** New skill candidate: llm-prompt-code-contract-sync
**Type:** open-source

**Issue:** The Tier1 decision prompt said "Was the last outreach very recent (under 45 mins)? (NO)" but the actual code gate was `effectiveMinGap = 5 min (offline)`. The LLM was reasoning with hardcoded 45-minute logic while code had already cleared the user for outreach, causing false negatives.

**Suggested improvement:** LLM decision prompts that gate on timing values must inject the ACTUAL computed values from code (e.g. "Min gap allowed right now: 5 min"), not hardcode thresholds. The NACE Tier1 context string already computed `effectiveMinGap` — it just wasn't reflected in the decision rules section of the prompt.

**Principle:** Never hardcode numeric thresholds in LLM decision prompts when those same thresholds are computed dynamically in code. The prompt must reference the computed value, not a stale hardcoded copy.
