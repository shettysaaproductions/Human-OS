# LIFE TIMELINE VISION

> **Status:** Future Phase (Phase 4)
> **Goal:** Give HumanOS a long-term memory that feels like a shared biography — a living record of the user's journey.

---

## The Core Idea

A Personal AI Operating System that lives for years must be able to *remember* like a person does.

Humans don't remember every word of every conversation. They remember *moments*, *patterns*, and *changes over time*.

HumanOS should do the same.

---

## What the Life Timeline Is

The Life Timeline is a structured, ever-growing record of the user's life — automatically constructed from conversations, memories, and milestones.

It is not a chat log. It is a *biography engine*.

```
2026 — June
  "Started using HumanOS. First conversation about music production goals."
  "Discussed family plans. Created 3 memories about long-term goals."
  "Breakthrough week: resolved career decision after 4 sessions."

2026 — July
  "Focused on productivity and morning routines."
  "Mentioned a health goal for the first time."

2027 — January
  "One year with Nova. Total: 1,240 conversations. 843 memories created."
```

---

## Daily Summary Feature

Every day, HumanOS generates a summary of the day's conversations:

```
🌟 Today in HumanOS

You talked about:
• Music Production
• Family Goals
• Finance Planning

You created:
3 new memories.

Nova noticed:
You're making progress on your productivity goal.
```

Delivered via:
1. **In-app notification** (push, when app is closed)
2. **Memory tab** (accessible anytime)
3. **Timeline view** (scrollable day-by-day history)

---

## The HumanOS Moments Feature

Contextual nostalgic prompts Nova delivers naturally:

```
"One year ago today, you told me about your music production dream.
 You've come a long way. 🎵"
```

```
"This is our 100th conversation. I remember when you first said hello."
```

```
"You set a finance goal 3 months ago. Want to check in on it?"
```

These moments make Nova feel like a genuine companion — not a tool.

---

## Timeline Data Architecture

### `timeline_entries` table

```sql
CREATE TABLE timeline_entries (
  id           uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id      uuid NOT NULL REFERENCES users(id),
  period_type  text NOT NULL,   -- 'day', 'week', 'month', 'year'
  period_label text NOT NULL,   -- '2026-07-01', '2026-07', '2026'
  summary_text text NOT NULL,
  topic_tags   text[],          -- ['music', 'family', 'finance']
  memory_count integer DEFAULT 0,
  message_count integer DEFAULT 0,
  created_at   timestamptz DEFAULT now(),
  updated_at   timestamptz DEFAULT now()
);
```

### `daily_summaries` table

```sql
CREATE TABLE daily_summaries (
  id           uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id      uuid NOT NULL REFERENCES users(id),
  date         date NOT NULL,
  summary_text text NOT NULL,
  topics       text[],
  memory_count integer DEFAULT 0,
  nova_insight text,            -- Optional: Nova's personal observation
  delivered    boolean DEFAULT false,
  created_at   timestamptz DEFAULT now()
);
```

---

## Generation Pipeline

### Daily (runs at midnight UTC or on first access the next day)

```
1. Fetch all messages from yesterday
2. Call LLM: "Summarize this person's day in 2-3 sentences. 
   Extract topics discussed. Note any progress or insights."
3. Store in daily_summaries
4. Send push notification if user has enabled it
```

### Monthly (runs on 1st of each month)

```
1. Aggregate all daily_summaries from last month
2. Call LLM: "Summarize this person's month. 
   Identify recurring themes, progress, and milestones."
3. Store in timeline_entries (period_type: 'month')
```

### Yearly (runs on Jan 1st)

```
1. Aggregate all monthly timeline_entries from last year
2. Call LLM: "Write a meaningful annual summary for this person.
   Capture who they were, what they worked on, and how they grew."
3. Store in timeline_entries (period_type: 'year')
```

---

## Frontend Timeline UI (Concept)

```
Timeline Tab
├── 📅 Today
│   ├── Talked about 3 topics
│   └── 2 new memories
├── 📅 Yesterday
│   ├── "You discussed your music goals."
│   └── 1 new memory
├── 📅 This Week
│   └── 12 conversations · 8 memories
├── 📅 This Month — July 2026
│   └── Tap to expand full summary
└── 📅 2026
    └── Your year so far...
```

---

## HumanOS Milestone Events

Track special moments automatically:

| Milestone                     | Trigger                              |
|-------------------------------|--------------------------------------|
| 🎉 First Conversation         | 1st message ever sent                |
| 💬 100 Conversations          | 100th conversation session           |
| 🧠 First Memory Created       | 1st memory stored                    |
| 📅 One Month Together         | 30 days since first conversation     |
| 🌟 One Year Together          | 365 days since first conversation    |
| 🔥 7-Day Streak               | Conversations 7 days in a row        |
| 🏆 1,000 Messages             | 1,000th message sent                 |

Nova acknowledges these naturally in conversation:
```
"By the way — today is our one-year anniversary. 
 I've really enjoyed getting to know you. 🌟"
```

---

## Privacy Principles

1. All timeline data is **user-owned** and exportable.
2. Summaries are **generated locally** or via user's own API key (future).
3. Users can **delete any summary** at any time.
4. **No timeline data** is used to train or improve the LLM.
5. Users can **disable** daily summaries entirely from Settings.

---

## Implementation Phases

| Phase | Feature                              | Priority |
|-------|--------------------------------------|----------|
| 4.1   | Daily summary generation             | High     |
| 4.2   | In-app Daily Summary card            | High     |
| 4.3   | Timeline tab (day/week view)         | Medium   |
| 4.4   | Monthly summarization job            | Medium   |
| 4.5   | HumanOS Moments in chat              | Medium   |
| 4.6   | Push notification for daily summary  | Low      |
| 4.7   | Yearly summaries                     | Low      |
| 4.8   | Milestone detection & celebration    | Low      |
