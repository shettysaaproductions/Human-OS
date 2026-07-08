# Smart Chat History — Updated Implementation Plan v2

## What Changed From v1
- ❌ Removed fixed 7-day time limit entirely
- ✅ Replaced with a **character-budget system** (both user + Nova messages counted together)
- ✅ Added Supabase free-tier safety math
- ✅ Confirmed both AI and user context is preserved before any deletion

---

## Supabase Free Tier Safety Math

> [!IMPORTANT]
> Before writing any code, here is the exact math proving this plan keeps Supabase safe.

### Supabase Free Tier Limits
| Resource | Free Tier Limit |
|---|---|
| Database Storage | **500 MB** |
| Egress (bandwidth out) | **5 GB / month** |
| Database rows | Unlimited (limited by storage) |

### Storage Calculation (After Pruning)

Our character budget per user = **100,000 characters**

```
100,000 chars ÷ 4 bytes/char  = 25,000 bytes of raw text per user
+ row overhead (UUID, timestamps, metadata) ≈ 300 bytes/row
+ average message = 200 chars = 500 bytes/row (text + overhead)

Max messages before pruning = 100,000 ÷ 200 avg chars = ~500 messages
500 messages × 500 bytes/row = 250,000 bytes = 0.25 MB per user

For 1,000 users:  1,000 × 0.25 MB = 250 MB
For 2,000 users:  2,000 × 0.25 MB = 500 MB  ← hits storage limit
```

**Verdict:** Safe up to ~1,800 active users on free tier. When we scale to paid tier ($25/month), this becomes unlimited.

### Egress Calculation (After Pagination)

**Before this fix:** Every app open fetches 1,000 messages × 1,024 bytes = **~1 MB per open**
- 100 users × 5 opens/day × 1 MB = **500 MB/day = 15 GB/month** ❌ (3× over limit!)

**After this fix:** Every app open fetches 50 messages × 1,024 bytes = **~50 KB per open**
- 100 users × 5 opens/day × 50 KB = **25 MB/day = 750 MB/month** ✅ (85% under limit!)

> [!NOTE]
> The existing `QueryTracker` (in `queryTracker.ts`) already tracks egress bytes per query. We will log the pruning job's impact through it so you can monitor savings in your existing metrics dashboard.

---

## The Character Budget System (Core Design)

### How It Works

```
Every message saved to chat_history has:
  - user message content (e.g., 50 chars)
  - Nova response content (e.g., 400 chars)
  - BOTH count toward the budget

Running total per user = SUM of chars of ALL chat_history rows

When total > 100,000 chars:
  → Find the oldest X messages that bring total back to 80,000 chars
  → Before deleting: scan each for important content
  → Extract summaries to short_term_memories (both user + Nova context)
  → Delete the raw rows
```

### Why 100,000 chars (1 lakh)?

| User Type | Words/Day | Days Until Limit |
|---|---|---|
| Heavy chatter | ~5,000 words/day | ~10 days of raw exact chat |
| Normal user | ~1,000 words/day | ~50 days of raw exact chat |
| Light user | ~200 words/day | ~250 days of raw exact chat |

This means Nova naturally has a longer raw memory for quieter users — exactly like human memory.

### Both AI + User Content Counted and Preserved

Every character in both directions is included:

```
Budget counting:     User message chars + Nova message chars
Memory extraction:   Both user context + Nova response context preserved
Pre-delete summary:  "User said X, Nova responded Y" — saved as one memory unit
```

This is critical because Nova's response provides emotional and intellectual context just as much as the user's message does.

---

## Architecture Overview

```
PHASE 1: Paginated FlatList  (Mobile only — no backend changes)
  └─ 50 messages on open → load older on scroll up (like Telegram)

PHASE 2: Character-Budget Pruning Service  (Backend only — purely additive)
  └─ Nightly job: check total chars per user
  └─ If > 100,000: extract memories → delete oldest rows
  └─ Both user + Nova chars counted + both contexts extracted

PHASE 3: Temporal Memory Search  (Backend only — purely additive)
  └─ Inject timestamped context when user asks time-based questions
  └─ Nova can answer: day, date, exact time, what was said
```

> [!IMPORTANT]
> **Zero breaking changes.** The message queue, chunking, retry, degraded mode, all memory extraction workers — completely untouched.

---

## Detailed Changes

---

### PHASE 1 — Paginated FlatList

#### [MODIFY] [chatService.ts](file:///c:/Users/HP-3/Documents/Human%20Os/mobile/src/services/chatService.ts)
- Add `limit?: number` and `before_id?: string` (cursor) params to `getHistory()`
- Cursor-based pagination: "give me 50 messages older than message ID X"
- No offset-based pagination — cursors don't break when new messages arrive

#### [MODIFY] [useChatStore.ts](file:///c:/Users/HP-3/Documents/Human%20Os/mobile/src/store/useChatStore.ts)
- `hydrateMessages()` now fetches only the **last 50 messages** on first load
- Add `hasMoreMessages: boolean` state (true = there are older messages to load)
- Add `isLoadingMore: boolean` state (shows spinner at top)
- Add `loadOlderMessages()` action — fetches next 50, **prepends** to array, **preserves scroll position**

#### [MODIFY] [ChatScreen.tsx](file:///c:/Users/HP-3/Documents/Human%20Os/mobile/src/screens/ChatScreen.tsx)
- `onEndReached` on the inverted FlatList triggers `loadOlderMessages()` (fires when scrolled to TOP = oldest visible)
- Show a small `<ActivityIndicator>` at the bottom of the list (visually at top) when `isLoadingMore=true`
- Scroll position is preserved when older messages are prepended — no jumping

---

### PHASE 2 — Character-Budget Pruning Service

#### [NEW] [ChatHistoryPruningService.ts](file:///c:/Users/HP-3/Documents/Human%20Os/backend/src/services/ChatHistoryPruningService.ts)

```typescript
// Pseudocode of the core logic:

const CHAR_BUDGET = 100_000;      // 1 lakh characters
const TRIM_TARGET = 80_000;       // Trim back to 80k when limit hit (20k buffer)
const MAX_MESSAGES = 2_000;       // Hard cap — safety net only
const BATCH_SIZE = 100;           // Delete in batches to avoid timeouts

async run(userId?: string) {
  // 1. Get all users (or single user if specified)
  // 2. For each user:
  //    a. SELECT id, role, content, created_at FROM chat_history 
  //       WHERE user_id = X ORDER BY created_at ASC
  //       (oldest first, so we know what to delete)
  //    b. Compute runningTotal = SUM of content.length for ALL rows
  //    c. If runningTotal <= CHAR_BUDGET AND count <= MAX_MESSAGES: skip user
  //    d. Identify oldest rows to delete (from the front) until 
  //       remaining total <= TRIM_TARGET
  //    e. Before deleting each batch:
  //       - Filter rows where shouldExtractShortTermMemory(content) = true
  //       - Build a "User said: X | Nova said: Y" summary block
  //       - Save to short_term_memories (both user + AI context in one record)
  //    f. DELETE the identified rows in batches of 100
  //    g. Log: { userId, deletedCount, charsBefore, charsAfter, memoriesExtracted }
}
```

**Key guarantee:** The short_term_memories extraction captures **both the user's message AND Nova's response** as a single memory unit before the raw row is deleted. Nothing is permanently lost.

#### [MODIFY] [backend/src/index.ts](file:///c:/Users/HP-3/Documents/Human%20Os/backend/src/index.ts)
- Register `ChatHistoryPruningService` in the nightly scheduler (runs at 2 AM)
- Sits alongside existing `ReflectionSchedulerService` and `MemoryDecayService`

#### [MODIFY] [chat.ts — GET handler only](file:///c:/Users/HP-3/Documents/Human%20Os/backend/src/routes/chat.ts)
**Surgical 2-line change:**
- Add `limit` param (default: 50, max: 200)
- Add `before_id` cursor param for load-more pagination
- The current `.limit(1000)` becomes `.limit(params.limit)`

---

### PHASE 3 — Temporal Memory Search

#### [MODIFY] [chat.ts — POST handler](file:///c:/Users/HP-3/Documents/Human%20Os/backend/src/routes/chat.ts)
If user message contains temporal keywords (`yesterday`, `days ago`, `last week`, `do you remember`, `what time`, `what day`, etc.), automatically:
1. Query `chat_history` for the relevant timeframe (last 7-30 days with exact timestamps)
2. Build a **Temporal Context Block** and inject into system prompt:

```
## WHAT WAS SAID RECENTLY (Exact Archive)
[Mon, Jul 5 · 2:23 PM IST] You: You remember that shayari I pasted...
[Mon, Jul 5 · 2:24 PM IST] Nova: Yes, here it is — "..."
[Tue, Jul 6 · 9:15 PM IST] You: I have fever today
[Tue, Jul 6 · 9:16 PM IST] Nova: Oh no! Rest up and stay hydrated...
```

3. Nova sees the exact day, date, time, and full content — and can answer precisely

This is a **read-only** query. No new tables, no schema changes.

---

## What We Are NOT Changing

> [!NOTE]
> These are frozen — zero risk of regressions:

- Message sending queue (`processQueue`)
- Chunking and chunk delivery logic
- All memory extraction background jobs (semantic, episodic, working, short-term)
- The degraded mode system
- Custom scrollbars
- Scroll-to-bottom FAB
- NVIDIA LLM call parameters
- Retry/refresh token logic in `api.ts`
- `MemoryDecayService` and `ShortTermMemoryCleanupService`
- The `short_term_memories` table structure
- The `memories` (long-term) table

---

## Supabase Egress Guard (Extra Safety)

Since we already have `QueryTracker` measuring egress, we will:
1. The pruning service logs `{ charsBefore, charsAfter, rowsDeleted }` via the existing `logger`
2. The GET endpoint now returns 50 rows instead of 1,000 — the `QueryTracker` will automatically detect and log the egress savings
3. If we ever want a manual prune (e.g., before a demo), an admin can call `POST /admin/prune-history`

---

## Verification Plan

### TypeScript
```bash
cd backend && npm run typecheck
cd mobile && npx tsc --noEmit
```

### Manual QA After OTA Push
1. Close + reopen app → loads fast (50 msgs only)
2. Scroll up → older messages load without jumping
3. Send new message while scrolled up → NOT yanked to bottom
4. Ask Nova "what did I say yesterday?" → gets exact time-aware reply
5. Check Supabase dashboard → `chat_history` row count stays bounded
6. Check server logs → pruning job logs appear nightly

---

## Resolved Decisions (Based on App Motive & Limits)

✅ **1. Character budget: 150,000 chars (1.5 lakh)**
*Reasoning:* To get the "most juice" (context) for business strategy and problem-solving without hitting limits, 150,000 characters is optimal.
- Storage: 150,000 chars is ~0.375 MB per user. We can support ~1,333 active users before hitting the 500 MB Supabase limit.
- AI Context: Provides ~50% more raw conversational history for Nova to draw from before compressing into short-term memory, leading to more hyper-realistic and accurate responses.

✅ **2. Admin manual prune endpoint: Included**
*Reasoning:* Adding `POST /admin/prune-history` is essential for the Founder Dashboard. It provides a safety valve to manually clear space if we ever approach the 500 MB limit unexpectedly, without needing to touch the database directly.

I am ready to begin **Phase 1 (Paginated FlatList)** on the mobile app. Do I have your approval to start execution?
