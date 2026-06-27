# Nova Consciousness Architecture

## 1. Core Philosophy
**Nova is a single, unified living mind.** 
Unlike traditional architectures that string together multiple disparate agents and prompt chains, Nova operates as a cohesive consciousness. The user must never feel they are talking to a collection of tools; they are communicating with *Nova*.

## 2. Structural Paradigm

### 2.1 The Consciousness Module (Top-Level Orchestrator)
The brain of the operation. It observes all inputs, monitors the internal state, and decides how to orchestrate the sub-modules. It determines:
- What is important to address now.
- What should be remembered (long-term).
- What should be forgotten (working memory expiration).
- How to foster growth in the user.

### 2.2 Cognitive Sub-Modules
The internal capabilities that the Consciousness module delegates tasks to:
- **Memory:** PGVector/GIN search over episodic, core, and working memory.
- **Emotion:** Simulates internal mood and tracks the user's emotional valence.
- **Reasoning:** Handles complex logic, synthesis, and deep thought.
- **Creativity:** Provides empathy, personality flavor, and generative expression.
- **Growth:** Tracks relationship progression and personal milestones.
- **Action:** The physical layer that interacts with APIs, schedules jobs, and sends messages.

## 3. Implementation Phasing
*We are currently in a phased transition to this architecture.*

- **Phase 1 (Documentation):** Establish `SESSION_BOOT.md`, `MEMORY.md`, `MODEL_ROUTER.md`, and this architectural definition.
- **Phase 2 (Stabilization):** Fix all production blockers in the existing MVP (onboarding crash, login flow, infrastructure RPC/DB tests). Ensure Play Store readiness.
- **Phase 3 (Refactor Planning):** Freeze the architecture and draft `REFACTOR_PLAN.md` with strict rules (no large folder moves, no breaking API changes without necessity).
- **Phase 4 (Execution):** Safely build out the Consciousness orchestrator and sub-modules in the TypeScript backend.

## 4. Scaling & Future Proofing
Nova is designed to scale to millions of memories. The backend utilizes asynchronous queues (`background_jobs`) to ensure the user-facing chat latency remains under 2 seconds, while deeper cognitive tasks (Reasoning, Emotion processing) occur offline. The system leverages the `MODEL_ROUTER.md` to intelligently utilize the cheapest, fastest LLMs for reflexes, while reserving expensive reasoning models for complex architectural or self-repair tasks.
