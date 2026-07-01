# MEMORY ARCHITECTURE V2

> **Status:** Planned — Next Major Backend Sprint
> **Goal:** Replace the flat message-history approach with a tiered, retrieval-optimized memory engine that scales across years of use without degrading response speed.

---

## The Problem

The current architecture sends the entire conversation history to the LLM on every request.

```
User message
  → Load ALL chat history (could be 600+ messages)
  → Load ALL memories
  → Build giant prompt
  → Send to LLM
  → Wait 40–60s
```

This does not scale. At 5 years of daily use:
- Chat history: ~50,000+ messages
- Memories: ~10,000+ entries
- Prompt size: exceeds LLM context windows
- Latency: degrades linearly

---

## The Solution: Tiered Memory

```
Fast Memory         ←── Immediate context (last 20 messages)
      ↓
Short-Term Memory   ←── Last 7 days, summarized
      ↓
Long-Term Memory    ←── Important named facts (goals, people, events)
      ↓
Life Timeline       ←── Year-level summaries of entire history
```

Each tier is retrieved selectively, not in full. Total prompt context stays constant regardless of how long Nova has known the user.

---

## Tier Definitions

### Tier 1: Fast Memory (Immediate Context)
- **Contents:** Last 20 chat messages
- **Storage:** In-memory (Zustand store, already implemented)
- **Retrieval:** Always included — no lookup needed
- **Size:** ~2,000–5,000 tokens

### Tier 2: Short-Term Memory (Recent Context)
- **Contents:** Summarized conversation sessions from the past 7 days
- **Storage:** Supabase `conversation_summaries` table
- **Retrieval:** Include latest 3–5 summaries per request
- **Size:** ~500–1,500 tokens
- **Generation:** Background job runs after each session ends (idle > 30 min)

### Tier 3: Long-Term Memory (Named Facts)
- **Contents:** Extracted facts — names, goals, preferences, relationships, events
- **Storage:** Supabase `memories` table with `pgvector` embeddings
- **Retrieval:** Semantic search — top 5–10 most relevant to current message
- **Size:** ~500–1,500 tokens
- **Generation:** Background extraction job after each conversation session

### Tier 4: Life Timeline (Historical Summaries)
- **Contents:** Monthly and yearly summaries of the user's journey
- **Storage:** Supabase `timeline_entries` table
- **Retrieval:** Rarely included — only when user asks about past events explicitly
- **Size:** ~200–500 tokens when included

---

## Prompt Construction (Target)

```
System Prompt
  + Tier 1: Last 20 messages         (~3,000 tokens)
  + Tier 2: Recent session summaries  (~1,000 tokens)
  + Tier 3: Top 5 relevant memories   (~800 tokens)
  + [Optional] Tier 4: Timeline entry (~300 tokens)
────────────────────────────────────────────────────
Total: ~5,000–6,000 tokens (constant regardless of history length)
```

---

## Background Memory Processing Pipeline

All memory work happens **after** Nova replies — never blocking the chat.

```
User sends message
  → [Immediately] Load Fast Memory (Tier 1)
  → [Parallel]    Semantic search Long-Term Memory (Tier 3)
  → [Parallel]    Load latest Short-Term Summaries (Tier 2)
  → Build prompt from retrieved tiers
  → Call LLM
  → Stream response to user
  → [Background, after reply] Extract new memories
  → [Background, after reply] Update embeddings
  → [Background, nightly] Summarize sessions → Tier 2
  → [Background, monthly] Summarize summaries → Tier 4
```

---

## Database Schema (Planned)

### `conversation_summaries`
```sql
id               uuid primary key
user_id          uuid
conversation_id  uuid
summary_text     text
date_range_start timestamptz
date_range_end   timestamptz
created_at       timestamptz
```

### `timeline_entries`
```sql
id           uuid primary key
user_id      uuid
period       text  -- '2026-06', '2026'
summary_text text
memory_count integer
created_at   timestamptz
updated_at   timestamptz
```

---

## Performance Targets

| Metric                  | Current     | Target      |
|-------------------------|-------------|-------------|
| DB Fetch (all tiers)    | 35–80ms     | < 30ms      |
| Prompt Build            | 10–50ms     | < 20ms      |
| LLM First Token         | 1.5–40s     | < 500ms     |
| LLM Total               | 3–60s       | 1–8s        |
| Total Perceived          | 40–60s      | 0.5–2s*     |

*Perceived time with streaming — user sees first token in < 500ms.

---

## Implementation Order

1. `conversation_summaries` table + background summarization job
2. Limit `hydrateMessages` to last 20 messages only
3. Semantic memory retrieval (top 5) with `pgvector`
4. `timeline_entries` table + monthly summarization cron
5. Prompt builder refactored to assemble from tiers
