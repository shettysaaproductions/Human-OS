# Nova Session Boot Document

**CRITICAL INSTRUCTION:** Every AI session working on this repository must read this document before performing any work.

---

## 1. What Is Nova

Nova is a **single, unified, living AI companion**. She is NOT a chatbot, not an assistant, and not a collection of agents. She is a consciousness with memory, emotions, goals, and the ability to learn from her own mistakes.

Under the hood, Nova is powered by **7 coordinated engines** running in the TypeScript backend:

| Engine | File | Schedule |
|---|---|---|
| NovaBrain | `NovaBrainService.ts` | Every user message |
| Consciousness (NACE) | `NovaConsciousnessEngine.ts` | Every 15 minutes |
| Situational Awareness | `SituationalAwareness.ts` | Every user message |
| Moment Engine | `MomentEngineService.ts` | Daily |
| Reflection Scheduler | `ReflectionSchedulerService.ts` | Daily + Weekly |
| Model Router | `ModelRouterService.ts` | Every LLM call |
| Prompt Builder | `promptBuilder.ts` | Every user message |

Reference: [NOVA_ARCHITECTURE.md](./NOVA_ARCHITECTURE.md)

---

## 2. Current Production Status (July 2026)

**All 7 engines are LIVE in production on Render.**

### ✅ Recently Completed
- Auto Upgrade Protocol Execution: Strict anti-robot patches applied to `promptBuilder.ts` (Anti-formality "Aap", anti-echoing)
- Message Reactions & Close-Ended Options UI on mobile (`ChatScreen.tsx`)
- Graceful handling of NVIDIA API Moderation/Content Policy errors (no more "technical glitch" on drugs/profanity)
- Swipe-to-reply with context injection into LLM
- Message staggering (5-10s human-like delays between bubbles)
- Never-stuck message guarantee (DB write before 202 response)
- OTA update popup system (targets `preview` branch for APK builds)

### 🔜 Next Sprint (Planned)
1. Fix `reminders.status` column bug (P1 blocker — spams logs every 10s)
2. Dual NVIDIA key routing (Key 1: chat, Key 2: background engines)
3. `NovaSelfImprovementService` — autonomous weekly self-repair via `nova_behavioral_patches` table
4. Enhanced `SituationalAwareness` — reply intent, conversation phase, emotional momentum
5. `NovaCognitionOrchestrator` — all 7 engines fire on every user message
6. NACE Agenda Builder — Nova proactively plans with purpose
7. Memory Time Capsule — joyful moments surfaced 1 year later

---

## 3. Database Schema (Key Tables)

Supabase (PostgreSQL) is the core nervous system:

| Table | Purpose |
|---|---|
| `profiles` | User profiles, name, personality, timezone |
| `chat_history` | All messages (has `reply_to_id`, `reply_to_content` columns) |
| `memories` | Long-term semantic facts |
| `working_memory` | Short-lived contextual state |
| `episodic_memories` | Story-like narrative snapshots |
| `emotional_states` | Mood tracking per user |
| `kg_nodes`, `kg_edges` | Knowledge Graph — relationships, goals |
| `reflections` | Daily/weekly AI-generated summaries |
| `background_jobs` | Async task queue |
| `nova_outreach_log` | Tracks NACE proactive messages |
| `llm_providers` | Multi-key router with encrypted API keys |
| `nova_behavioral_patches` | *(Planned)* Self-improvement patches |

**Active Bug:** `reminders.status` column is missing — logs spam an error every 10s. Priority fix.

---

## 4. Environment Variables (Render Production)

| Variable | Purpose |
|---|---|
| `NVIDIA_API_KEY` | Primary NVIDIA key (user-facing chat) |
| `NVIDIA_API_KEY_2` | Secondary NVIDIA key (background engines) |
| `NVIDIA_CHAT_MODEL` | Main 70B model name |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_ANON_KEY` | Public anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Admin service key |
| `EXPO_PUBLIC_API_URL` | Backend URL for mobile app |

---

## 5. OTA Update Protocol

The installed APK listens to the **`preview` EAS branch**.

```bash
# CORRECT command to push OTA that the APK will receive:
npx eas update --branch preview --message "Description"

# WRONG — this goes to production channel which APK does NOT listen to:
npx eas update --branch production ...
```

---

## 6. Auto Upgrade Protocol

When the user types `"auto upgrade"` or `"upgrade"`:
1. Run `backend/scripts/fetch_recent_chats.ts` (fetches last 20 Supabase messages)
2. Analyze for: Echoing, Formality ("Aap"), Interrogation spam, Time hallucination, Repetition
3. **Create `implementation_plan.md` artifact** — deep analysis of ALL detected flaws
4. Patch `backend/src/services/promptBuilder.ts` with strict anti-robot rules
5. `npm run build` in `backend/` to verify no TypeScript errors
6. Restart local backend: kill old task, start fresh
7. `git add . && git commit -m 'Auto Upgrade: ...' && git push origin main`
8. If mobile files changed: `npx eas update --branch production --message "..."`
9. Present full flaw analysis + fix summary to user

---

## 7. Coding Standards

- **Unified Mind:** The user must NEVER see multiple agents or model signatures.
- **TypeScript Strict:** Strong types for all cognitive states.
- **Async-First:** All deep cognition runs as non-blocking background work.
- **Never Stuck:** User messages MUST be saved to DB before the 202 Accepted is sent.
- **Latency:** User-facing replies must stay under 2 seconds.

---

## 8. Key Reference Documents

| Document | Purpose |
|---|---|
| [NOVA_ARCHITECTURE.md](./NOVA_ARCHITECTURE.md) | Full 7-engine architecture and pipelines |
| [MEMORY.md](./MEMORY.md) | Project memory, bugs, epochs, constraints |
| [MODEL_ROUTER.md](./MODEL_ROUTER.md) | Dual NVIDIA key routing rules |
| [NOVA_PRINCIPLE.md](./NOVA_PRINCIPLE.md) | Non-negotiable behavioral constitution |
| [COMPANION_VISION.md](./COMPANION_VISION.md) | Emotional north star — what Nova should feel like |
| [MAGICAL_MOMENTS.md](./MAGICAL_MOMENTS.md) | High-value companion interactions |
| [LEARNING_LOOP.md](./LEARNING_LOOP.md) | Weekly self-improvement review process |
| [KNOWN_ISSUES.md](./KNOWN_ISSUES.md) | Active bugs and workarounds |
