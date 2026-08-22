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
| 6 | **NVIDIA Router** | `lib/nvidia.ts` | Authoritative 15-key brain-region routing and profiles | On every NVIDIA LLM call |
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

## 5. Quad NVIDIA Key Pool Strategy (Multi-LLM Load Balancing)

`lib/nvidia.ts` is the authoritative runtime routing layer. `USER_FAST` uses Frontal Cortex and `USER_DEEP` uses Deep Cortex; both preserve Reserve failover. Streaming and non-streaming first use the same deterministic profile selection. Memory, subconscious extraction, and critical-action extraction remain explicitly on the 8B extraction model.

`ModelRouterService.ts` is not in the runtime request path.

To handle the immense computational load of the Auto-Upgrade background scans and NACE outreach without ever rate-limiting the user-facing chat, Nova employs a Quad-Key Pool Strategy using 4 distinct free-tier NVIDIA API keys in parallel:

| Key | Client Instance | Domain Focus | Rate-Limit Priority |
|---|---|---|---|
| `NVIDIA_API_KEY` (Key 1) | `nvidiaClient` | User-facing chat replies (NovaBrain) | Highest |
| `NVIDIA_API_KEY_2` (Key 2) | `nvidiaClientSecondary` | NACE Consciousness, Reflection Scheduler | Background |
| `NVIDIA_API_KEY_3` (Key 3) | `nvidiaClientLearning` | Self-Improvement Scans, Real-time Learning | Deep Background |
| `NVIDIA_API_KEY_4` (Key 4) | `nvidiaClientExtraction`| Working Memory extraction, DB decay | Background |

If Key 1 rate-limits (HTTP 429), it automatically fails over to Key 2. Each engine is statically bound to its domain key to distribute the request throughput evenly across the free tiers.

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
| Phase 4 | ✅ COMPLETE | Message reliability (zero-drop guarantee — `FALLBACK_REPLY` saved + pushed in every failure path so the user always gets a bubble) |
| Phase 5 | ✅ COMPLETE | Quad NVIDIA key routing (`ModelRouterService.ts` — 4 key pool, 429 failover) |
| Phase 6 | ✅ COMPLETE | NovaSelfImprovementService (autonomous self-repair + Auto Upgrade protocol, `NovaSelfImprovementService.ts`) |
| Phase 7 | ✅ COMPLETE | Enhanced SituationalAwareness (conversation phases + emotional momentum, `SituationalAwareness.ts`) |
| Phase 8 | ✅ COMPLETE | NovaCognitionOrchestrator (all 7 engines fire on every message — see cognition pipeline §4) |
| Phase 9 | ✅ COMPLETE | NACE Agenda Builder (Nova gathers all 7 engines' context + plans outreach, `NovaConsciousnessEngine.ts`) |
| Phase 10 | ✅ COMPLETE | Memory Time Capsule system (`MomentEngineService.checkTimeCapsules()` daily) |

---

## 9. Scaling & Free-Tier Strategy

Nova is designed to live efficiently within free-tier constraints:
- **Supabase Free:** Memory decay + nightly pruning keeps DB under 500MB
- **Render Free:** NACE pulse every 15 mins prevents cold starts during active hours
- **NVIDIA Free:** Background engines use Key 2; user-facing chat uses Key 1
- **Async-first:** Every heavy operation is non-blocking background work
