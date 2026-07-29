# HumanOS Project File Tree

Last updated: 2026-07-30 by Update Agent

---

## Backend (`backend/src/`)

```
src/
├── app.ts                          # Express app factory
├── index.ts                        # Server entry point, schedulers, boot/shutdown logging
├── test.ts                         # Manual test harness
│
├── agents/                         # Background memory extraction agents
│   ├── BaseAgent.ts
│   ├── EmotionalAgent.ts
│   ├── EpisodicAgent.ts
│   ├── KgAgent.ts
│   ├── MilestoneAgent.ts
│   ├── ReflectionAgent.ts
│   ├── SemanticAgent.ts
│   ├── ShortTermMemoryAgent.ts
│   └── WorkingMemoryAgent.ts
│
├── config/
│   └── index.ts                    # Env vars (NVIDIA keys x4, Supabase, etc.)
│
├── lib/
│   ├── cache.ts
│   ├── encryption.ts
│   ├── logger.ts
│   ├── nvidia.ts                   # Multi-key pool: Key1=chat, Key2=NACE, Key3=learning, Key4=extraction
│   ├── pushNotifications.ts
│   ├── queryTracker.ts
│   └── supabase.ts
│
├── middleware/
│   ├── auth.ts
│   ├── errorHandler.ts
│   └── requestLogger.ts
│
├── routes/
│   ├── chat.ts                     # Main message handler + correction detection hook
│   └── ... (other routes)
│
├── services/                       # Nova's 9 Engines
│   ├── BackgroundActionService.ts  # Executes subconscious actions from NovaBrain
│   ├── ChatHistoryPruningService.ts
│   ├── FreeTierGuardService.ts     # [NEW V2] Zero-cost enforcement
│   ├── NovaBrainService.ts         # Engine 1: Core cognition (reply + subconscious)
│   ├── NovaConsciousnessEngine.ts  # Engine 2: Proactive outreach (NACE) — intelligent gap
│   ├── NovaFollowupService.ts      # Engine 3: Follow-up scheduling
│   ├── NovaRealtimeLearningService.ts # [NEW V2] Engine 8: Real-time correction learning
│   ├── NovaSelfImprovementService.ts  # Engine 6: Daily self-repair (12 flaws, incremental)
│   ├── promptBuilder.ts            # Engine 7: Prompt/patch injection
│   ├── ReflectionSchedulerService.ts  # Engine 4: Daily/weekly reflections
│   ├── ReminderEngine.ts           # Engine 5: Reminder parsing & scheduling
│   └── ...
│
└── workers/
    └── queueWorker.ts              # BullMQ queue processor

backend/scripts/
├── cleanupTestMemories.ts          # [NEW V2] One-time memory cleanup + re-seeding
└── ...

backend/supabase/migrations/
├── 021_nova_corrections_log.sql    # [NEW V2] Corrections log + scan checkpoints
└── ...
```

---

## Mobile (`mobile/src/`)

```
src/
├── navigation/
│   └── AppNavigator.tsx
├── services/
│   └── proactiveReplyService.ts
└── ...
```

---

## Root Project Files

| File | Purpose |
|------|---------|
| `NOVA_ARCHITECTURE.md` | 9-engine diagram, cognition pipeline |
| `LEARNING_LOOP.md` | Self-improvement loops A, B, C |
| `HumanOS_MVP_Scope.md` | Feature roadmap and status |
| `SESSION_BOOT.md` | Current production status, active bugs |
| `MEMORY.md` | Project epochs and constraints |
| `KNOWN_ISSUES.md` | Active bugs |
| `IMPLEMENTATION_QUEUE.md` | Planned vs completed features |
| `TASKS.md` | [NEW] Active task tracker |
| `UPDATE_DIARY.md` | [NEW] Agent change log |
| `NOTES.md` | [NEW] Agent observations |
| `FILE_TREE.md` | [NEW] This file |

---

## Key Supabase Tables

| Table | Purpose |
|-------|---------|
| `chat_history` | All messages (role, content, reply_to_content) |
| `memories` | Long-term semantic/core/episodic memories |
| `working_memory` | Short-term context (expires in 1–24h) |
| `nova_behavioral_patches` | Learned anti-robot rules |
| `nova_corrections_log` | [NEW V2] User correction audit trail |
| `nova_scan_checkpoints` | [NEW V2] Incremental scan position |
| `nova_agenda` | Scheduled follow-up events |
| `nova_outreach_log` | NACE outreach history |
| `nova_followups` | Queued follow-up messages |

---

## Render Environment Variables Required

| Variable | Used By |
|----------|---------|
| `NVIDIA_API_KEY` | Key 1 — user-facing chat |
| `NVIDIA_API_KEY_2` | Key 2 — NACE + Reflection |
| `NVIDIA_API_KEY_3` | Key 3 — Self-Improvement + Learning **[ADD]** |
| `NVIDIA_API_KEY_4` | Key 4 — Memory extraction **[ADD]** |
| `SUPABASE_URL` | Supabase connection |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase admin access |
