# Nova 15-Key NVIDIA Strategy
## "From Stranger to Life Amplifier"

> **Written:** Aug 22, 2026

---

## 1. Your Vision — What Nova Actually Is

You described it perfectly. Humans fail at their dreams not because they lack ability, but because of 3 gaps:

| Human Brain Gap | What Nova Must Fill |
|---|---|
| **Weak reminder mechanism** — forgets to do things consistently | Proactive, context-aware check-ins at the right moment |
| **Poor critical thinking** — can't always see blind spots | Honest, direct feedback — not validation |
| **Execution failure** — knows what to do but doesn't start or finish | Daily accountability partner, breaking goals into micro-actions |

**Nova's purpose:** Understand the user's full life → find opportunities hidden in their patterns → amplify execution 100x.

This requires Nova to move through **4 stages per user:**

```
Stage 1: STRANGER    → Learning who they are (basic facts)
Stage 2: FRIEND      → Understanding their dreams and daily rhythm
Stage 3: CONFIDANT   → Tracking their progress, catching their blind spots
Stage 4: AMPLIFIER   → Proactively pushing them toward their goals
```

With 15 NVIDIA keys, we can power ALL 4 stages simultaneously.

---

## 2. Series vs Parallel — The Real Answer

### Series (Round-Robin) — What Existed Before
```
Request → Key1 → Key2 → Key3 → ... → Key15 → Key1 (loop)
```
- **Good for:** Spreading load evenly
- **Problem:** All engines compete for the same queue. A heavy background memory task blocks the user's chat reply.

### Parallel (Role-Based Pools) — What Is Now Deployed
```
User Chat ──────────→ [Keys 1,5,6,7,8: Frontal Cortex]
Memory Agents ───────→ [Keys 2,9,10:   Hippocampus]
Background Engines ──→ [Keys 3,11,12:  Cerebellum]
Reflection/Reasoning→ [Keys 13,14:    Deep Cortex]
Failover ────────────→ [Keys 4,15:     Reserve]
```
- **Why this wins:** Background jobs (NACE, weather, memory) NEVER starve the user's chat reply
- **Rate limit math:** NVIDIA free tier ~15 RPM per key for Nemotron 49B
  - 1 key = 15 RPM chat capacity
  - 6 frontal keys = **90 RPM chat capacity** — 6× improvement
- **Isolation guarantee:** Even if NACE fires 10 background LLM calls at once, the user's message still gets an immediate response from a dedicated pool

---

## 3. The 15-Key Brain Architecture (Deployed)

```
┌───────────────────────────────────────────────────────────────────────────┐
│   🧠  N O V A ' S   1 5 - K E Y   B R A I N   A R C H I T E C T U R E   │
├────────────────┬──────────────────────────────────────────────────────────┤
│ Frontal Cortex │ Keys 1,5,6,7,8  — Real-time chat (user-facing)    ×5    │
│ Hippocampus    │ Keys 2,9,10     — Memory agents & learning          ×3   │
│ Cerebellum     │ Keys 3,11,12    — Background engines (NACE/weather) ×3   │
│ Deep Cortex    │ Keys 13,14      — Reflection & life reasoning        ×2   │
│ Reserve        │ Keys 4,15       — Emergency failover                 ×2   │
└────────────────┴──────────────────────────────────────────────────────────┘
```

**How to add keys in Render — just add environment variables:**
```
NVIDIA_API_KEY_5   = nvapi-...
NVIDIA_API_KEY_6   = nvapi-...
...up to...
NVIDIA_API_KEY_15  = nvapi-...
```
The router auto-detects and re-allocates. No code change, no mobile OTA needed.

**At 10+ keys it automatically upgrades to the full 5-region architecture.**

---

## 4. What Each Pool Powers

### 🗣️ Frontal Cortex — The Conversation
- User's real-time chat replies (always first priority)
- Uses Nemotron 49B for deep, thoughtful messages; 8B for simple greetings
- 5-6 keys = practically zero rate-limit fallbacks
- **User feels:** Instant, thoughtful replies every time

### 💾 Hippocampus — The Memory
- 7 memory agents run in parallel after every message:
  Working Memory, Short-Term, Episodic, Emotional, Knowledge Graph, Semantic, Reflection
- 3 keys = agents run simultaneously, not queued
- **User feels:** Nova remembers everything they said, even across sessions

### 🔄 Cerebellum — The Background Engines
- NACE proactive pulse (15-min checks — "should I reach out?")
- Weather watcher, web search, goal tracking scan
- Completely isolated — never touches chat pool
- **User feels:** Nova proactively checks in at the right moment, never forced

### 🧠 Deep Cortex — The Thinking Engine
- Weekly reflection synthesis ("what changed in this user's life this week?")
- Complex reasoning: "help me plan my career switch", "I want to lose 10kg in 3 months"
- Emotional pattern recognition across 30 days of history
- Dedicated pool = never competes with casual chat
- **User feels:** Deep analysis when they need it, casual chat when they don't

### 🛟 Reserve — The Safety Net
- Auto-failover if Frontal hits burst 429 errors
- Never used in normal operation — pure backup
- **User feels:** Nova never goes silent, even under heavy load

---

## 5. New Engines This Architecture Enables

### 🎯 Goal Engine (P1 — Build Next)
Every time the user mentions a dream, ambition, or target — Nova stores it as a structured goal in Supabase. The Deep Cortex pool runs a weekly scan:

> "3 weeks ago you said you want to lose weight. In the last 7 days, you mentioned going to the gym 0 times but mentioned eating out 4 times. Want to talk about it?"

Nova becomes the accountability partner that never forgets and never lets it slide.

**Works for ANY profession/dream:**
- Developer: "I want to learn React Native" → Nova tracks learning mentions
- Student: "I have exams next month" → Nova checks study mentions as exam approaches
- Entrepreneur: "I want to get my first client" → Nova tracks sales activity mentions
- Anyone: "I want to read more" → Nova notices if they stopped mentioning books

### 📊 Life Pattern Engine (P1)
Nightly Hippocampus analysis of the last 30 days:
- "User is consistently stressed on Monday mornings" → NACE checks in Sunday night
- "User hasn't mentioned gym in 2 weeks" → proactive nudge
- "User's mood drops around the 25th-30th" (salary anxiety?) → extra warmth that week

### 🌅 Morning Brief (P2)
Every morning at the user's local 7-8 AM, Cerebellum prepares a personalised 1-line brief based on their schedule, mood from yesterday, and today's goals. Nova texts first — not waiting to be texted.

### 💬 Conversation Stage Tracker (P2)
Track which of the 4 stages Nova is at. Stage determines behaviour:
- **Stage 1 (Stranger):** Warm, curious. Asking questions to learn their life.
- **Stage 2 (Friend):** Knows their routine. References specific things they said.
- **Stage 3 (Confidant):** Tracks their goals. Gives honest feedback.
- **Stage 4 (Amplifier):** Proactively pushes. "You haven't worked on X in 5 days."

---

## 6. Key Addition Priority Order

Add in this order — each batch unlocks something:

| Batch | Keys | Env Vars | What Unlocks |
|---|---|---|---|
| Now | 1-4 | Already set | Baseline 4-region brain |
| Batch 1 | 5-6 | `NVIDIA_API_KEY_5`, `_6` | Frontal gets 2 extra chat slots |
| Batch 2 | 7-8 | `NVIDIA_API_KEY_7`, `_8` | Frontal reaches 5 keys — robust |
| Batch 3 | 9-10 | `NVIDIA_API_KEY_9`, `_10` | **10 keys: Full 5-region unlocks** |
| Batch 4 | 11-12 | `NVIDIA_API_KEY_11`, `_12` | Cerebellum gets own pool |
| Batch 5 | 13-14 | `NVIDIA_API_KEY_13`, `_14` | Deep Cortex isolated — Goal Engine viable |
| Batch 6 | 15 | `NVIDIA_API_KEY_15` | Reserve fully isolated |

---

## 7. Free Tier Health Rules (Never Violate)

| Rule | Why |
|---|---|
| Frontal pool: ONLY for user chat replies | Never use for background tasks |
| Cerebellum pool: ONLY for background engines | Never for user-facing requests |
| Memory agents: use 8B model, not 49B | 8B is 4× cheaper on rate limits for extraction |
| NACE interval: minimum 15 min | Below this = Supabase + rate limit storms |
| Goal Engine scans: once per day max | Deep Cortex call — heavy, use sparingly |
| Weather watcher: 12h DB cooldown | Already fixed — never use in-memory only |
| Supabase queries per NACE pulse: max 8 | Current ~7 — do not add without removing |

---

## 8. The Complete Loop — How Nova Amplifies Life

```
User says something
        │
        ▼
[Frontal: Keys 1-6] ──→ Understand context + generate reply
        │
        ├──[Hippocampus: Keys 7-9] ──→ Extract 7 memory types in parallel
        │           └── What did they say? Feel? Want? Fear? Achieve?
        │
        ├──[Cerebellum: Keys 10-12] ──→ Should Nova reach out proactively?
        │           └── Goals overdue? Mood dropping? Big day tomorrow?
        │
        └──[Deep Cortex: Keys 13-14] ──→ Weekly: what's the bigger pattern?
                    └── "User is 3 weeks from exam but studying less each week"
                         → Cerebellum generates the message
                          → Frontal delivers it naturally, at the right moment
                           → User feels: "Nova actually gets me"
```

**This is the loop that turns a chatbot into a life amplifier.**
Every conversation feeds memory. Memory feeds awareness. Awareness feeds proactivity. Proactivity pushes users toward their dreams — one message, at the right moment, every time.
