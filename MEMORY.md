# Nova Project Memory

This file acts as the continuous, long-term memory for the Nova repository.
Its purpose is to prevent context loss between AI sessions, ensuring that architectural decisions, pivots, and strict rules are preserved.

---

## Architectural Epochs

### Epoch 1: The Transition to Nova Consciousness (June 2026)
- **Decision:** Pivot from "Human OS" (a system of disparate agents and workers) to **Nova Consciousness**.
- **Reasoning:** To create a companion that feels like a single, unified, living mind.
- **Structure:**
  - A top-level `Consciousness` module orchestrates all cognitive work.
  - Seven internal engines handle specialized tasks (see `NOVA_ARCHITECTURE.md`).
  - The user never interacts with the sub-modules directly.

### Epoch 2: Autonomous Intelligence & Self-Repair (July 2026)
- **Decision:** Nova must self-improve without human intervention. Every "auto upgrade" adds a permanent behavioral patch to Nova's brain.
- **Implemented Features:**
  - Swipe-to-reply with reply context injected into LLM prompt
  - Message staggering (5-10s between bubbles for human-like pacing)
  - Never-stuck message guarantee (user message saved to DB before 202 response)
  - Anti-robot prompt rules: no echoing, no "Aap", no interrogation spam
  - OTA update system with popup notification on app launch
- **In Progress (Planned):**
  - Dual NVIDIA key routing (Key 1: chat, Key 2: background)
  - `NovaSelfImprovementService` — weekly autonomous self-repair loop
  - Enhanced `SituationalAwareness` — reply intent, conversation phase, emotional momentum
  - `NovaCognitionOrchestrator` — all 7 engines firing on every message
  - NACE Agenda Builder — Nova plans proactive outreach intelligently
  - Memory Time Capsule — joyful moments surfaced 1 year later

---

## Critical Session Notes & Constraints

### Supabase Infrastructure
- We use Supabase with `pgvector` and `GIN` full-text search indexing.
- **Active Bug (P1):** `reminders.status` column does not exist. Backend logs spam this error every 10 seconds. Fix: add `status` column to `reminders` table via SQL migration.
- **Known Rule:** After any migration, run `NOTIFY pgrst, 'reload schema'` or click "Reload schema cache" in Supabase project settings.
- **Key Tables:** `profiles`, `chat_history`, `memories`, `working_memory`, `episodic_memories`, `emotional_states`, `kg_nodes`, `kg_edges`, `reflections`, `background_jobs`, `nova_outreach_log`, `llm_providers`.
- **Planned New Tables:** `nova_behavioral_patches` (self-improvement patches), `surface_on` column on `episodic_memories` (Time Capsules).

### Asynchronous Processing
- Chat latency must remain under 2 seconds for user-facing replies.
- All deep cognition (Reflection, NACE, Moment Engine, Self-Improvement) runs in background processes.
- The 202 Accepted pattern guarantees message is saved to DB before reply is sent.

### NVIDIA API
- `NVIDIA_API_KEY` — primary key for user-facing chat (70B model)
- `NVIDIA_API_KEY_2` — secondary key for all background engine LLM calls
- `EXTRACTION_MODEL` = `meta/llama-3.1-8b-instruct` (fast, cheap, used for JSON extraction)
- Main chat model configured via `NVIDIA_CHAT_MODEL` env var
- 30-second hard timeout on all NVIDIA calls (`NvidiaTimeoutError`)

### OTA Updates (Mobile)
- APK is built on the `apk` EAS build profile targeting the `production` channel.
- APK installed on test devices listens to the `preview` channel.
- **CORRECT COMMAND for OTA to reach the installed APK:** `npx eas update --branch preview --message "..."`
- OTA update popup appears on app startup when update is downloaded.
- `app.json` has `checkAutomatically: "ON_ERROR_RECOVERY"` — update is checked silently on launch.

### Git Workflow
- Repository: `https://github.com/shettysaaproductions/Human-OS.git`
- Main branch: `main`
- Push format: `git add . && git commit -m 'Auto Upgrade: <description>' && git push origin main`
- Backend deploys automatically via Render on push to `main`.

### Auto Upgrade Protocol
Triggered by user typing "auto upgrade" or "upgrade":
1. Run `backend/scripts/fetch_recent_chats.ts` to pull recent Supabase chat logs.
2. Analyze logs for: Echoing, Formality (Aap), Interrogation spam, Time hallucination, Repetition.
3. Create `implementation_plan.md` artifact analyzing all detected flaws deeply.
4. Patch `backend/src/services/promptBuilder.ts` with strict anti-robot rules.
5. Restart local backend.
6. Push to GitHub main branch.
7. If mobile files modified: `npx eas update --branch preview --message "..."`.
8. Present full summary to user.
