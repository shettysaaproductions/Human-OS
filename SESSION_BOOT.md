# Nova Session Boot Document

**CRITICAL INSTRUCTION:** Every AI session must read this document before performing any work.

## 1. Nova Architecture
We are building **Nova**, a single conscious AI companion. Nova is NOT a collection of chatbots.
Under the hood, Nova is orchestrated by a top-level **Consciousness** module that oversees six internal cognitive modules:
- **Memory:** PGVector/GIN retrieval of past interactions.
- **Emotion:** Tracks mood and emotional valence.
- **Reasoning:** Logic, problem-solving, and deep thought.
- **Creativity:** Empathy, generative thought, personality flavor.
- **Growth:** Relationship evolution and personal development.
- **Action:** API interactions and physical responses.

The Consciousness module continuously observes all modules, deciding what is important, what to remember, what to forget, and how to help the user grow.

## 2. MVP Goals & PRD
- **Goal:** Build Nova as a single, living conscious entity that scales to millions of memories and operates across multiple LLM providers seamlessly.
- **Detailed PRD:** [HumanOS_PRD_V1.md](file:///e:/project%20software/Human%20OS/HumanOS_PRD_V1.md)
- **MVP Scope:** [HumanOS_MVP_Scope.md](file:///e:/project%20software/Human%20OS/HumanOS_MVP_Scope.md)

## 3. Database Schema
Supabase (PostgreSQL) is the core nervous system. Key tables include:
- `profiles`, `chat_history` (Core foundation)
- `memories`, `working_memory`, `episodic_memories` (Memory Module)
- `emotional_states` (Emotion Module)
- `kg_nodes`, `kg_edges` (Reasoning & Growth tracking)
- `reflections`, `agent_metrics`, `background_jobs` (Consciousness maintenance & Async queues)

## 4. Current Milestone & Pending Tasks
**Milestone 3: Cognitive Subsystems (Nova Refactor)**
- **Pending:** Wait for the user to execute `missing_base_tables.sql` in Supabase to resolve the infrastructure benchmark failure.
- **Pending (Codebase):** Refactor the chat routes into the Consciousness, Memory, Emotion, Reasoning, Creativity, Growth, and Action modules.

## 5. Coding Standards
- **Unified Mind:** The user must NEVER see multiple agents or model signatures.
- **TypeScript:** Strict types representing the cognitive states (e.g., `EmotionState`, `MemoryPayload`).
- **Performance:** Asynchronous processing for all deep cognition. Latency must remain <2 seconds for the Action module to reply.

## 6. Deployment & Git Workflow
- Keep features chunked logically. Commit to Git only after a module is complete and unit-tested.
- Validate egress costs and RPC latencies on Supabase before deployment.

## 7. Model Routing Rules
- Reference: [MODEL_ROUTER.md](file:///e:/project%20software/Human%20OS/MODEL_ROUTER.md)
- Different LLMs work behind the scenes via the router, preserving the illusion of a single brain.

## 8. Continuous Memory
- Reference: [MEMORY.md](file:///e:/project%20software/Human%20OS/MEMORY.md)
- All architectural decisions, task continuity, and pivot points must be documented here to prevent context loss between AI sessions.
