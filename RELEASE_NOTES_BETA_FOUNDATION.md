# Release Notes: Beta Foundation Sprint

**Version:** v0.2.0-beta  
**Date:** 2026-06-28  
**Commit:** `feat: Beta Foundation Sprint`  
**Branch:** `main → production`

---

## Summary

This release transforms Human OS from a chat interface into a **visual, reflective, emotionally intelligent companion system**. It is the foundation for onboarding 10–50 real beta users.

---

## Part 1: Brain Visualization v2

All dashboard screens have been upgraded from static lists to rich, interactive experiences.

### Memory Brain (`MemoryBrainScreen`)
- Category cards with neon color coding (Memories, Goals, Wishes, Skills, People, Places, Projects, Lessons)
- Searchable memory list with real-time text filtering
- Category type filters with active state highlighting
- **Memory density heatmap** — bar chart showing relative count per category
- Stats row: Total, Categories, This Week counts
- Memoized `FlatList` with `removeClippedSubviews` for 60fps performance

### Emotional Brain (`EmotionalBrainScreen`)
- **Weekly bar graph** showing average mood intensity per day (last 7 days)
- **Monthly heatmap** — GitHub contribution-style grid (28 days), color-graded from red → green by mood intensity
- Dominant mood insight card
- Streak counter (consecutive days with at least one entry)
- Average intensity stat

### Goal Brain (`GoalBrainScreen`)
- Active / Completed tabs
- **Progress rings** (styled circular indicators) per goal
- Overall progress aggregate
- Progress bar per goal card
- Deadline and creation date displayed per goal

### Life Timeline (`LifeTimelineScreen`)
- Events grouped by date (chronological descent)
- Supports three event types: **Moments** (⚡), **Episodic Memories** (🧠)
- Filter tabs: All / Moments / Memories
- Stats row: count by type

### Founder Dashboard (`FounderDashboardScreen`)
- Fully rebuilt with pull-to-refresh
- **Product section:** Total Users, Memories, Moments (with open rate), Reflections
- **Companion section:** Episodic memories, sessions, DAU
- **AI Cost section:** Total tokens, weekly tokens, estimated USD cost, success rate
- **Moment Engine panel:** Generated / Opened / Dismissed / Open Rate in a 4-up grid
- **System health:** Pending jobs, failed jobs (24h), total failures

---

## Part 2: Reflection Engine Scheduler

New service: `ReflectionSchedulerService.ts`

**Daily Reflections** (run every 24h, idempotent):
- Fetches user's recent memories, emotions, active goals
- Prompts Nova (via LLM / mock fallback) to generate a warm, growth-focused summary
- Stores result in `reflections` table with `key_takeaways`
- Skips if daily reflection already exists for today

**Weekly Reflections** (run every Sunday, idempotent):
- Aggregates last 7 daily reflections as input
- Generates macro trends, achievements, and forward-looking insights
- Stored as `reflection_type: 'weekly'`

**Admin Endpoints:**
- `POST /admin/trigger-reflections-daily` — manually trigger for all users
- `POST /admin/trigger-reflections-weekly` — manually trigger for all users

---

## Part 3: Founder Analytics

New router: `backend/src/routes/founder.ts`

| Endpoint | Description |
|---|---|
| `GET /founder/overview` | Total users, DAU, memories, moments, reflections, sessions |
| `GET /founder/system` | Pending/failed jobs, 24h error rate, system health |
| `GET /founder/costs` | Total tokens, weekly tokens, estimated USD costs, success rate |
| `GET /founder/telemetry` | Moment Engine open rate, dismiss rate; Reflection totals |

All responses are **cached for 60 seconds** to avoid N+1 reads on repeated dashboard refreshes.

---

## Part 4: Multi-Brain Foundation

New database migration: `009_multi_brain_foundation.sql`

`app_settings` table created with default values:

| Key | Default | Description |
|---|---|---|
| `default_chat_model` | `meta/llama-3.1-8b-instruct` | General chat |
| `default_reasoning_model` | `meta/llama-3.1-70b-instruct` | Complex reasoning |
| `default_embedding_model` | `nv-embedqa-e5-v5` | Semantic search |
| `fallback_model` | `mock` | When primary fails |

No migration of existing chat logic. Infrastructure-only.

---

## Part 5: Memory Management

New route: `backend/src/routes/memoryManagement.ts`  
New screen: `MemoryManagementScreen.tsx`

**Backend endpoints:**
- `GET /memories` — list with search, type filter, archived toggle, pagination
- `PATCH /memories/:id` — edit key or value
- `PATCH /memories/:id/archive` — toggle archive state
- `DELETE /memories/:id` — permanently delete (with ownership check)

**Mobile screen:**
- Searchable list with real-time filter
- Archive / Unarchive toggle
- Inline edit with save/cancel
- Destructive delete with confirmation `Alert`
- Pull-to-refresh

---

## Performance

- All screens use `React.memo` on the export
- `useMemo` used for filtered lists, grouped data, and stats computation
- `FlatList` uses `removeClippedSubviews` and `windowSize={10}`
- Founder analytics cached server-side (60s TTL)
- No N+1 queries — `Promise.all` / `Promise.allSettled` for parallel DB fetches

---

## Navigation

- 7-tab Brain Navigator: **Memory Brain → Emotions → Graph → Goals → Timeline → Memories → Founder**
- Accessible from Chat screen via the 🧠 icon

---

## Deployment

- `✅ npm run typecheck` — backend and mobile both pass
- `✅ git push` — pushed to `main → production`
- `🚀 eas update --branch production` — OTA update triggered
