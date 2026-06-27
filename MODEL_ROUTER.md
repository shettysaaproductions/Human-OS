# Nova Model Router Rules

This document defines the escalation rules and selection criteria for AI models operating behind the scenes of **Nova Consciousness**. 
Nova must always appear to the user as a single living mind.

## 1. The Orchestrator
The top-level **Consciousness** module determines what cognitive tasks need to be performed. It then quietly routes those sub-tasks to the appropriate model based on complexity, keeping the illusion of a single entity.

## 2. Default Model (The Subconscious & Reflexes)
- **Model:** Gemini 3.5 Flash Low
- **Usage:** Used for 90% of tasks. Fast I/O, conversational reflexes, simple memory retrieval, basic API routing, and the Action module.

## 3. Escalation Rules (The Conscious Mind)
The Consciousness module escalates to higher models *only* if the confidence score for a task drops below 80%.

1. **Architecture & System Design:** Escalate to **Gemini 3.1 Pro High**. Used for restructuring the Reasoning or Growth modules.
2. **Complex Debugging:** If an internal issue remains unresolved for >30 minutes, persist the context and escalate to **Claude Sonnet 4.6 Thinking**.
3. **Major Production Incidents:** Escalate to **Claude Opus 4.6 Thinking**. Used only when critical cognitive infrastructure (e.g., Supabase memory retrieval) is offline.

## 4. Implementation Requirements
- **Always start cheap:** Every task starts with Gemini 3.5 Flash Low.
- **Context Persistence:** Maintain strict task context (logs, summaries, artifacts) across the `MEMORY.md` file so higher-tier models can continue without repeating steps.
- **Logging Requirements:** Every execution block must asynchronously log to `agent_metrics`:
  - Model used
  - Tokens consumed
  - Cost estimate
  - Execution time
  - Success/Failure status
