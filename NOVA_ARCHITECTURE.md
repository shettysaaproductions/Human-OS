# Nova Consciousness Architecture

## 1. Core Philosophy
**Nova is a single, unified living mind.**
Unlike traditional architectures that string together multiple disparate agents and prompt chains, Nova operates as a cohesive consciousness. The user must never feel they are talking to a collection of tools; they are communicating with *Nova*.

Nova does not just respond — she **observes, plans, remembers, and grows**. When the user is away, Nova is not idle. She is building her next move, reviewing her own past mistakes, and planning how to bring a smile to the user's face.

---

## 2. The 7 Living Engines (Production Status)

All 7 engines are currently live and deployed on Render backend.

| # | Engine | File | Role | Schedule |
|---|---|---|---|---|
| 1 | **NovaBrain** | `NovaBrainService.ts` | Core LLM pipeline — generates reply + subconscious actions | Every user message |
| 2 | **Consciousness (NACE)** | `NovaConsciousnessEngine.ts` | Autonomous proactive outreach with internal agenda | Every 15 minutes |
| 3 | **Situational Awareness** | `SituationalAwareness.ts` | Time/day/gap/mood/reply-intent situation brief | Every user message |
| 4 | **Moment Engine** | `MomentEngineService.ts` | Magical memory moments, goal follow-ups, Time Capsules | Daily |
| 5 | **Reflection Scheduler** | `ReflectionSchedulerService.ts` | Daily/weekly life summaries and growth insights | Daily + Weekly |
| 6 | **Model Router** | `ModelRouterService.ts` | Dual NVIDIA key routing — user-facing vs. background | On every LLM call |
| 7 | **Prompt Builder** | `promptBuilder.ts` | Full system prompt assembly + dynamic behavioral patches | Every user message |

---

## 3. The Self-Improvement Loop (Planned)

Nova learns from her own mistakes through the **Auto Upgrade** cycle:

```
Weekly Telemetry Pull
        ↓
NovaSelfImprovementService analyzes 100 recent messages
        ↓
Detects: Echoing / Formality / Interrogation / Hallucination / Repetition
        ↓
Writes behavioral PATCH to: nova_behavioral_patches (Supabase)
        ↓
PromptBuilder loads all active patches at startup
        ↓
Nova NEVER repeats the same mistake again
```

Each auto-upgrade adds to a permanently growing library of self-knowledge. Patches accumulate — they are never deleted unless explicitly archived.

---

## 4. The Cognition Pipeline (Per User Message)

```
User sends message
        ↓
[PARALLEL] Context Assembly:
  - SituationalAwareness → situation brief (time, gap, phase, reply-intent)
  - TemporalAwarenessService → exact time context
  - Memory loader → long-term + working + short-term memories
  - nova_behavioral_patches → all learned anti-robot rules
        ↓
NovaBrainService.processInteraction()
  → builds full system prompt via PromptBuilder
  → calls NVIDIA LLM (primary key)
  → parses <reply> and <subconscious_actions>
        ↓
202 Accepted sent to mobile app (user sees reply)
        ↓
[BACKGROUND, NON-BLOCKING]:
  - MomentEngine.extract() → save life moment if present
  - EmotionalState extractor → log mood
  - MemoryRepository.save() → persist new facts
  - NovaFollowupService.queue() → schedule follow-up if needed
```

---

## 5. Dual NVIDIA Key Strategy

| Key | Client | Usage | Free-Tier Impact |
|---|---|---|---|
| `NVIDIA_API_KEY` (Key 1) | `nvidiaClient` | All user-facing chat replies | Primary |
| `NVIDIA_API_KEY_2` (Key 2) | `nvidiaClientSecondary` | Background engines: Reflection, NACE, Self-Improvement | Secondary / Background |

If Key 1 rate-limits (HTTP 429), Key 2 is used as transparent fallback.

---

## 6. Conversation State Understanding

`SituationalAwareness` now understands 4 conversation phases:

| Phase | Trigger | Nova Behavior |
|---|---|---|
| `OPENING` | Gap > 60 mins, first message | Greet warmly, acknowledge absence |
| `FLOWING` | Gap < 5 mins, active exchange | Match energy and pace, stay present |
| `WINDING_DOWN` | "gn/bye/ok/hmm" + increasing gap | Let go gracefully, don't force topics |
| `RE-ENTRY` | 1 message after very long silence | Start completely fresh, no old threads |

**Reply Intent**: When user swipes-to-reply a specific bubble, the `reply_to_content` is injected into the situation brief. Nova understands this is a reaction to THAT message, not a new topic.

**Emotional Momentum**: Last 3 messages are tracked for valence trend:
- Declining → Nova slows down, ONE caring question
- Rising → Nova matches energy, amplifies positivity
- Flat → Nova pivots to a new memory-based topic

---

## 7. Memory Time Capsule System

Joyful episodic memories are tagged with a `surface_on` date (typically 1 year in the future). `MomentEngineService.checkTimeCapsules()` runs daily and surfaces these at the right time — making Nova's memory of the user's past feel alive and deeply personal.

---

## 8. Implementation Phasing

| Phase | Status | Description |
|---|---|---|
| Phase 1 | ✅ COMPLETE | All 7 engines live in production |
| Phase 2 | ✅ COMPLETE | Anti-robot prompt rules (Echoing, Formality, Interrogation, Time-skip) |
| Phase 3 | ✅ COMPLETE | Swipe-to-reply (reply intent context in backend) |
| Phase 4 | ✅ COMPLETE | Message reliability (never-stuck guarantee) |
| Phase 5 | 🔜 PLANNED | Dual NVIDIA key routing |
| Phase 6 | 🔜 PLANNED | NovaSelfImprovementService (autonomous weekly self-repair) |
| Phase 7 | 🔜 PLANNED | Enhanced SituationalAwareness (conversation phases + emotional momentum) |
| Phase 8 | 🔜 PLANNED | NovaCognitionOrchestrator (all 7 engines fire on every message) |
| Phase 9 | 🔜 PLANNED | NACE Agenda Builder (Nova plans her outreach intelligently) |
| Phase 10 | 🔜 PLANNED | Memory Time Capsule system |

---

## 9. Scaling & Free-Tier Strategy

Nova is designed to live efficiently within free-tier constraints:
- **Supabase Free:** Memory decay + nightly pruning keeps DB under 500MB
- **Render Free:** NACE pulse every 15 mins prevents cold starts during active hours
- **NVIDIA Free:** Background engines use Key 2; user-facing chat uses Key 1
- **Async-first:** Every heavy operation is non-blocking background work
