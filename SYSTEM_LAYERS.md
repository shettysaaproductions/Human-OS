# System Layers Architecture

This document defines Nova's complete architecture stack, facilitating decoupling and independent layer evolution.

**Last Updated: July 2026 — All layers are LIVE in production.**

---

## 1. The Operational Stack

Nova's architecture is structured into six independent layers:

### Layer 1: User Experience
- **Purpose:** Interaction entrypoints for human communication.
- **Components:**
  - Mobile App (React Native / Expo) — Production APK deployed on `preview` EAS channel
  - OTA Update System — Popup on app launch when update is available
  - Swipe-to-Reply — WhatsApp-style reply with context injection
  - Human-like message staggering — 5-10s delays between multi-bubble Nova replies

### Layer 2: Consciousness (Orchestrator)
- **Purpose:** Core identity, routing, and traffic control.
- **Components:**
  - `NovaConsciousnessEngine.ts` — NACE: autonomous proactive outreach (every 15 mins) with internal agenda
  - `ModelRouterService.ts` — Dual NVIDIA key routing (Key 1: chat, Key 2: background)
  - `promptBuilder.ts` — Full system prompt assembly + dynamic behavioral patches from `nova_behavioral_patches` table
  - Anti-robot personality rules — No echoing, no "Aap", no interrogation

### Layer 3: Cognitive Modules (The 7 Engines)
- **Purpose:** Modular internal functions that all participate in every conversation turn.
- **Components:**
  - `NovaBrainService.ts` — Core LLM reply pipeline + subconscious actions
  - `SituationalAwareness.ts` — Time, gap, conversation phase, reply intent, emotional momentum
  - `MomentEngineService.ts` — Magical moments, goal follow-ups, Time Capsule memories
  - `ReflectionSchedulerService.ts` — Daily/weekly life summaries
  - `NovaSelfImprovementService.ts` *(Planned)* — Autonomous behavioral self-repair
  - `NovaCognitionOrchestrator.ts` *(Planned)* — Coordinates all engines on every message

### Layer 4: Runtime Services
- **Purpose:** Backend automation pipelines.
- **Components:**
  - `ReminderSchedulerService.ts` — Fires due reminders every 10s
  - `NovaFollowupService.ts` — Queued follow-up questions
  - `ChatHistoryPruningService.ts` — Nightly chat DB cleanup
  - `ShortTermMemoryCleanupService.ts` — Working memory expiry
  - `BackgroundActionService.ts` — Async job processor
  - `QueueService.ts` — Background jobs queue manager

### Layer 5: Storage
- **Purpose:** State and asset persistence.
- **Components:**
  - **Supabase (PostgreSQL)** — All user data, memories, messages, behavioral patches
  - **pgvector** — Vector embeddings for semantic memory search
  - **GIN indexes** — Full-text search over memories and chat history
  - **Git (GitHub)** — All architecture documentation and code
  - **EAS (Expo)** — OTA update hosting and APK builds

### Layer 6: Infrastructure
- **Purpose:** Deployment and environment operations.
- **Components:**
  - **Render** — Backend Express server hosting (free tier, 512MB RAM)
  - **GitHub** — Repository at `github.com/shettysaaproductions/Human-OS`
  - **EAS (Expo)** — Mobile build and OTA update pipeline
  - **NVIDIA NIM API** — Dual-key LLM routing (llama-3.1-70b + 8b instruct)

---

## 2. Decoupling Principles

- **Independent Evolution:** Each layer can be refactored, upgraded, or optimized independently.
- **Loose Coupling:** High-level consciousness flows communicate with downstream storage/cognitive layers purely through standardized TypeScript service interfaces.
- **Hot-Swappable Dependencies:** Nova is designed to swap LLM providers (via model router), databases (via pg client abstractions), or cloud hosts without rewriting UX or consciousness modules.
- **Async-First:** All deep cognition is non-blocking. User-facing chat replies must be delivered within 2 seconds.

---

## 3. Free-Tier Survival Strategy

| Resource | Limit | Strategy |
|---|---|---|
| **NVIDIA Key 1** | Free rate limit | User-facing chat only |
| **NVIDIA Key 2** | Free rate limit | Background engines only |
| **Supabase** | 500MB DB, 1GB bandwidth | Memory decay + nightly pruning |
| **Render** | 512MB RAM, sleeps after 15 mins inactive | NACE pulse every 15 mins keeps alive |
| **EAS** | Free tier OTA | All updates to `preview` branch |
