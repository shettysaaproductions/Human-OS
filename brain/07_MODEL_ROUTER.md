# 07_MODEL_ROUTER: Model Escalation and Optimization

This document defines the routing rules and cost optimization strategies for LLM tasks under the **Nova Consciousness** architecture.

---

## 1. Routing Model Roles

| Model Tier | Active Model | Purpose / Role | Cost Strategy |
|---|---|---|---|
| **Subconscious / Reflexes** | `Gemini 3.5 Flash (Low)` | 90% of chats, basic memory fetches, simple API calls, foreground response. | **Default:** Low latency, cheap. |
| **Conscious / Reasoning** | `Gemini 3.1 Pro (High)` | Deep system design, Knowledge Graph updates, Growth milestone analysis. | **Escalated:** Triggered if confidence <80%. |
| **Critical Thinker / Debugger** | `Claude Sonnet 4.6 (Thinking)` | Complex backend debugging, system crashes. | **Escalated:** If bugs last >30 mins. |
| **Ultimate Emergency** | `Claude Opus 4.6 (Thinking)` | Major production/database incidents, core memory recovery. | **Rare:** High cost. |

---

## 2. Escalation Workflow
1. The **Consciousness Module** receives an input task and triggers a reflex process using the cheapest model.
2. If confidence or verification fails (<80% success score), the current context is packaged and sent to the next higher-tier model.
3. Every execution writes metrics (model, execution duration, tokens, cost) to `agent_metrics` for rolling billing audits.
