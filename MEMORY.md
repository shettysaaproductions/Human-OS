# Nova Project Memory

This file acts as the continuous, long-term memory for the Nova repository. 
Its purpose is to prevent context loss between AI sessions, ensuring that architectural decisions, pivots, and strict rules are preserved.

## Architectural Epochs

### Epoch 1: The Transition to Nova Consciousness (June 2026)
- **Decision:** Pivot from "Human OS" (a system of disparate agents and workers) to **Nova Consciousness**.
- **Reasoning:** To create a companion that feels like a single, unified, living mind.
- **Structure:** 
  - A top-level `Consciousness` module orchestrates all cognitive work.
  - Six internal sub-modules handle specialized tasks: `Memory`, `Emotion`, `Reasoning`, `Creativity`, `Growth`, `Action`.
  - The user never interacts with the sub-modules directly.
- **Model Routing:** A strict model router delegates tasks behind the scenes based on confidence scores and complexity, allowing for scaling across multiple LLM providers (Gemini, Claude) seamlessly.

## Critical Session Notes & Constraints

### Supabase Infrastructure
- We utilize Supabase with `pgvector` and `GIN` full-text search indexing.
- **Known Issue:** PostgREST schema cache is stubborn. If a migration is run via the SQL editor, always verify that the API cache has been refreshed (via `NOTIFY pgrst, 'reload schema'`).
- **Base Tables:** `profiles` and `chat_history` must exist for any memory retrieval fallback or chat pipeline tests to function properly.

### Asynchronous Processing
- Chat latency must remain under 2 seconds.
- All deep cognition (Reasoning, Growth analysis, Episodic memory summarization) must be offloaded to `background_jobs` and executed asynchronously.

### Codebase Status (Milestone 3 Pending)
- We are currently staged to begin the physical codebase refactoring to implement the Consciousness module and its sub-modules, pending the finalization of the database infrastructure tests.
