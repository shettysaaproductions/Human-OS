# Architecture Dependency Rules

This document establishes the strict rules governing communication and dependencies across Nova's system layers to prevent architectural drift and technical debt.

---

## 1. Coupling & Dependency Rules

1.  **User Experience Layer Boundaries**
    *   *Rule:* Cannot access the database (Supabase) directly.
    *   *Enforcement:* Must communicate with the backend exclusively through HTTP/REST APIs.
2.  **Consciousness Layer Provider Decoupling**
    *   *Rule:* Cannot depend on infrastructure providers directly.
    *   *Enforcement:* Interacts with downstream layers (e.g. database, queues, LLMs) using decoupled service interfaces and adapters.
3.  **Cognitive Module Isolation**
    *   *Rule:* Cognitive modules (Memory, Emotion, Reasoning, Creativity, Growth, Action) cannot call each other directly.
    *   *Enforcement:* All inter-module communication, sequencing, and state sharing must occur through the top-level Consciousness Orchestrator.
4.  **Runtime Services Data Isolation**
    *   *Rule:* Background queues and runtime services can only access database tables through repositories (e.g., `MemoryRepository`).
    *   *Enforcement:* Raw DB client instances are banned in background workers.
5.  **Storage Layer Agnosticism**
    *   *Rule:* The database and schema files must never contain business logic.
    *   *Enforcement:* No database triggers or complex procedural PL/pgSQL containing cognitive, memory routing, or emotional logic.
6.  **Infrastructure Replacement**
    *   *Rule:* Cloud hostings (Render) and CI/CD tools must be completely hot-swappable.
    *   *Enforcement:* Application code must never assume a specific deployment platform.
7.  **Third-Party API Abstraction**
    *   *Rule:* Always wrap external APIs in dedicated Adapter classes.
    *   *Enforcement:* No direct calls to OpenAI, Anthropic, or Google APIs outside of their normalized router adapters.
8.  **Environment Variables Centralization**
    *   *Rule:* Environment variables must be parsed, validated, and exported by `src/config/` at startup.
    *   *Enforcement:* Direct usage of `process.env` is banned outside of config files.
9.  **Database Migration Idempotency**
    *   *Rule:* Migrations must be forward-only and strictly idempotent.
    *   *Enforcement:* Every SQL block must utilize statements like `CREATE TABLE IF NOT EXISTS` or `CREATE INDEX IF NOT EXISTS`.
10. **LLM Access Restriction**
    *   *Rule:* Models are accessed exclusively via `ModelRouterService`.
    *   *Enforcement:* Manual instantiations of OpenAI or Google client SDKs inside cognitive modules or routes are strictly prohibited.
