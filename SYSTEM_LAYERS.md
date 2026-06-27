# System Layers Architecture

This document defines Nova's complete architecture stack, facilitating decoupling and independent layer evolution.

---

## 1. The Operational Stack

Nova's architecture is structured into six independent layers:

### Layer 1: User Experience
*   **Purpose:** Interaction entrypoints for human communication.
*   **Components:** Mobile App (React Native), Web Dashboard (Future), and Voice/Speech Interface.

### Layer 2: Consciousness (Orchestrator)
*   **Purpose:** Core identity, routing, and traffic control.
*   **Components:** Consciousness Orchestrator (`consciousness.ts`), Model Router, Personality DNA rules, and Relationship Engine.

### Layer 3: Cognitive Modules
*   **Purpose:** Modular internal functions.
*   **Components:** Memory (Retrieval/Insert), Emotion (Valence tracking), Reasoning (Escalation logic), Creativity (Expression), Growth (Milestone tracking), and Action (Queues/API output).

### Layer 4: Runtime Services
*   **Purpose:** Backend automation pipelines.
*   **Components:** Queue managers, notifications, diagnostics pipelines, background workers, and reflection engines.

### Layer 5: Storage
*   **Purpose:** State and asset persistence.
*   **Components:** Supabase (relational), Git (knowledge), Local Filesystem (backups/logs), and Object Storage (user media attachments).

### Layer 6: Infrastructure
*   **Purpose:** Deployment and environment operations.
*   **Components:** Render hosting, GitHub repository management, MCP integrations, CI/CD pipelines, and health monitoring.

---

## 2. Decoupling Principles

*   **Independent Evolution:** Each layer can be refactored, upgraded, or optimized independently.
*   **Loose Coupling:** High-level consciousness flows communicate with downstream storage/cognitive layers purely through standardized APIs/methods, avoiding hard bindings.
*   **Hot-Swappable Dependencies:** Nova is built to allow replacing LLM models (via the model router), databases (via the pg client abstractions), or cloud infrastructure without rewriting user experience or consciousness modules.
