# Implementation Queue

This document tracks upcoming features queued for development, ordered by priority.
**Last Updated: July 2026**

---

## 🟠 P1: Next Sprint (Autonomous Intelligence)

### 1. `NovaCognitionOrchestrator` — All 7 Engines on Every Message
**Goal:** No engine ever misses a message again. All context gathered in parallel before LLM call.
- New file: `backend/src/services/NovaCognitionOrchestrator.ts`
- Replaces scattered context-gathering logic in `chat.ts`
- All subconscious actions (memory save, emotion log, moment extract) fire in background after reply

### 5. `NovaCognitionOrchestrator` — All 7 Engines on Every Message
**Goal:** No engine ever misses a message again. All context gathered in parallel before LLM call.
- New file: `backend/src/services/NovaCognitionOrchestrator.ts`
- Replaces scattered context-gathering logic in `chat.ts`
- All subconscious actions (memory save, emotion log, moment extract) fire in background after reply

## 🟡 P2: High Value (Next Phase)

### 6. NACE Agenda Builder — Nova Plans Her Outreach
**Goal:** Nova reaches out with PURPOSE, not just generic messages.
- Add `_buildAgenda(userId)` to `NovaConsciousnessEngine.ts`
- Nova queries: open goal threads, emotional lows from last 48h, upcoming reminders, magical moment candidates
- Picks ONE item from the agenda for each proactive message

### 7. Memory Time Capsule System
**Goal:** Joyful memories are surfaced 1 year later, creating deeply emotional moments.
- Add `surface_on TIMESTAMPTZ` column to `episodic_memories` table
- When a positive-valence memory is saved (importance ≥ 7), set `surface_on = now() + 1 year`
- Add `checkTimeCapsules(userId)` to `MomentEngineService.ts` (runs daily)
- Nova sends a "Remember when..." push notification + inserts it as a chat message

---

## ✅ Completed (Archive)

| Feature | Completed |
|---|---|
| Auto Upgrade Protocol execution & patches | July 2026 |
| `reminders.status` Bug Fix (Migration) | July 2026 |
| Dual NVIDIA Key Routing | July 2026 |
| `NovaSelfImprovementService` — Autonomous Self-Repair | July 2026 |
| Enhanced `SituationalAwareness` | July 2026 |
| Swipe-to-reply with LLM context injection | July 2026 |
| Message staggering (5-10s human-like delays) | July 2026 |
| Never-stuck message guarantee | July 2026 |
| Anti-robot prompt rules (echo, formality, interrogation) | July 2026 |
| OTA update popup system | July 2026 |
| OTA branch fix (preview → reaches APK) | July 2026 |
| 7 engines live in production | July 2026 |
| Moment Engine (Goal follow-ups + Child milestones) | June 2026 |
| Daily/weekly reflection engine | June 2026 |
| NACE autonomous consciousness (every 15 mins) | June 2026 |
