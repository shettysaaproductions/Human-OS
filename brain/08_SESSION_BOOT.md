# 08_SESSION_BOOT: Task and Boot Instructions

**CRITICAL INSTRUCTION:** Read this file at the start of every session to establish current milestones, goals, and coding standards.

---

## 1. Project Health & Status
*   **Database:** Configured with direct `DATABASE_URL` PostgreSQL connection.
*   **Safety Mode:** Interactive prompt protection for database drops.
*   **Doctor Diagnostics Command:** `npm run doctor`

---

## 2. Current Milestone
**Milestone 3: Cognitive Subsystems (Nova Refactor)**
*   **Goal:** Reorganize the existing `backend/src/services` structure into clean, decoupled cognitive modules: Consciousness, Memory, Emotion, Reasoning, Creativity, Growth, and Action.
*   **Rule:** Maintain application stability. Do not make breaking API changes or rename root folders unless documented in the [Refactor Plan](file:///e:/project%20software/Human%20OS/REFACTOR_PLAN.md).

---

## 3. Pending Tasks Checklist
- [ ] Build out the Consciousness Orchestrator in `backend/src/services/consciousness.ts`.
- [ ] Group cognitive subsystems under `backend/src/services/nova/` (MemoryModule, EmotionModule, ReasoningModule, CreativityModule, GrowthModule, ActionModule).
- [ ] Transition Express router `/chat` requests to the Consciousness orchestrator.
- [ ] Set up unit testing for cognitive modules.

---

## 4. Coding & Architecture Standards
- **Unified Mind:** Under no circumstances should the user see mentions of sub-models or internal tools. The response comes purely from *Nova*.
- **Async Execution:** Heavy cognitive tasks (e.g. episodic summarization, Knowledge Graph changes) must occur offline in `background_jobs` to keep HTTP response times under 2 seconds.
- **Strict Types:** Code must maintain type definitions for cognitive states (e.g. `EmotionalState`, `ReflectiveThought`).
