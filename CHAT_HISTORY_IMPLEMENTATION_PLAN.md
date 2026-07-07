# Smart Chat History — Implementation Plan v2
> **Status:** ⏸️ Paused — Awaiting final approval on 2 questions before execution  
> **Last Updated:** 2026-07-07  
> **Author:** Antigravity AI + Shetty Saa

---

## What This Plan Is About

A production-level upgrade of the chat history system to work like Telegram/WhatsApp.  
Three phases. Zero breaking changes to anything that already works.

---

## What's Broken Today

| Problem | Root Cause |
|---|---|
| App takes long to load | `GET /chat` fetches 1,000 messages at once — all loaded into FlatList immediately |
| Auto-scroll yanks you back | `onContentSizeChange` calls `scrollToOffset(0)` even when user is scrolled up reading history |
| No infinite scroll / lazy load | `hydrateMessages()` is all-or-nothing — no pagination |
| Supabase free-tier risk | `chat_history` table has no upper bound — grows forever |
| Nova can't answer "2 days ago" | LLM only gets last 20 messages — no older history in context |

---

## Supabase Free Tier Safety Math

### Limits
| Resource | Free Tier Limit |
|---|---|
| Database Storage | **500 MB** |
| Egress (bandwidth out) | **5 GB / month** |

### Storage (After Pruning)
```
Budget per user = 100,000 characters
Avg message = 200 chars = ~500 bytes (text + row overhead)
Max messages before prune = 100,000 ÷ 200 = ~500 messages
Storage per user = 500 × 500 bytes = 0.25 MB

Safe for: ~1,800 active users on free tier
```

### Egress (After Pagination)
```
BEFORE: 1,000 msgs × 1,024 bytes = 1 MB per app open
        100 users × 5 opens/day = 500 MB/day = 15 GB/month  ❌ 3× OVER LIMIT

AFTER:  50 msgs × 1,024 bytes = 50 KB per app open
        100 users × 5 opens/day = 25 MB/day = 750 MB/month  ✅ SAFE
```

---

## The Character Budget System (Core Design)

### Key Design Decision
> **No fixed time limit.** Instead: delete oldest messages when total characters across ALL chat history (user + Nova combined) exceeds 100,000 characters (1 lakh).

| User Type | Words/Day | Days of Raw Exact History |
|---|---|---|
| Heavy chatter | ~5,000 words/day | ~10 days |
| Normal user | ~1,000 words/day | ~50 days |
| Light user | ~200 words/day | ~250 days |

### Budget Rules
- **Budget:** 100,000 characters (both user + Nova messages counted together)
- **Trim target:** When limit hit, prune back to 80,000 chars (keeps a 20k buffer)
- **Hard cap:** 2,000 messages maximum (safety net only)
- **Before deleting:** Extract important content to `short_term_memories` first
- **What is extracted:** Both user message AND Nova response — saved as one combined memory unit

---

## Phase 1 — Paginated FlatList (Mobile Only)
**Scope:** Mobile only. No backend changes.  
**Risk:** Medium (scroll position management is tricky — will be tested carefully)

### Files to Change
| File | Change |
|---|---|
| `mobile/src/services/chatService.ts` | Add `limit` + `before_id` cursor params to `getHistory()` |
| `mobile/src/store/useChatStore.ts` | Load 50 msgs on open; add `loadOlderMessages()`, `hasMoreMessages`, `isLoadingMore` state |
| `mobile/src/screens/ChatScreen.tsx` | `onEndReached` triggers load-more; spinner at top; preserve scroll position on prepend |

### Behaviour After
- App opens → loads last **50 messages** instantly (fast!)
- User scrolls up → older messages load in batches of 50 without jumping
- User sends message while scrolled up → **NOT auto-yanked down** (fixed!)

---

## Phase 2 — Character-Budget Pruning Service (Backend Only)
**Scope:** Backend only. Purely additive new service.  
**Risk:** Low (background job only, never touches the chat request pipeline)

### Files to Change
| File | Change |
|---|---|
| `backend/src/services/ChatHistoryPruningService.ts` | **NEW** — Character budget pruning logic |
| `backend/src/index.ts` | Register pruning service in nightly scheduler (2 AM) |
| `backend/src/routes/chat.ts` (GET only) | Add `limit` + `before_id` params; change `.limit(1000)` to `.limit(50)` default |

### Pruning Logic (Pseudocode)
```
1. For each user:
   a. Fetch ALL rows from chat_history ORDER BY created_at ASC
   b. Compute totalChars = SUM(content.length for all rows)
   c. If totalChars <= 100,000 AND rowCount <= 2,000 → SKIP (nothing to do)
   d. Walk from oldest → identify rows to delete until remaining = 80,000 chars
   e. For each row to delete:
      - If shouldExtractShortTermMemory(content) → save combined summary to short_term_memories
   f. DELETE rows in batches of 100
   g. Log { userId, deletedCount, charsBefore, charsAfter, memoriesExtracted }
```

---

## Phase 3 — Temporal Memory Search (Backend Only)
**Scope:** Backend only. Purely additive — no existing routes touched.  
**Risk:** Very Low (read-only query injection)

### Files to Change
| File | Change |
|---|---|
| `backend/src/routes/chat.ts` (POST handler) | Detect temporal keywords → inject Temporal Context Block into system prompt |

### Temporal Context Block (Injected into System Prompt)
```
## WHAT WAS SAID RECENTLY (Exact Archive)
[Mon, Jul 5 · 2:23 PM IST] You: You remember that shayari I pasted...
[Mon, Jul 5 · 2:24 PM IST] Nova: Yes, here it is — "..."
[Tue, Jul 6 · 9:15 PM IST] You: I have fever today
[Tue, Jul 6 · 9:16 PM IST] Nova: Oh no! Rest up and stay hydrated...
```

**Trigger keywords:** `yesterday`, `days ago`, `last week`, `do you remember`, `what time`, `what day`, `that day when`, `how long`, `how many times`

---

## What Is Frozen (NOT Changing)

- Message sending queue (`processQueue`)
- Chunking and chunk delivery logic
- All memory extraction background jobs (semantic, episodic, working, short-term)
- Degraded mode system
- Custom scrollbars & scroll-to-bottom FAB
- NVIDIA LLM call parameters
- Retry/refresh token logic (`api.ts`)
- `MemoryDecayService` and `ShortTermMemoryCleanupService`
- `short_term_memories` table structure
- `memories` (long-term) table

---

## ⏸️ Open Questions — Need Answers Before Coding Starts

> **Q1 — Character budget:** 100,000 (1 lakh) or 150,000 (1.5 lakh)?  
> Both are Supabase-safe. 1 lakh = more conservative. 1.5 lakh = more raw history for heavy users.

> **Q2 — Admin manual prune endpoint:** Add `POST /admin/prune-history` to Founder Dashboard?  
> Recommended: YES — useful for testing and emergency cleanups.

---

## Verification Plan

```bash
# TypeScript checks
cd backend && npm run typecheck
cd mobile && npx tsc --noEmit
```

### Manual QA
1. Close + reopen app → loads fast (50 msgs only)
2. Scroll up → older messages load without jumping
3. Send message while scrolled up → NOT yanked to bottom
4. Ask Nova "what did I say yesterday?" → exact time-aware reply
5. Check Supabase → `chat_history` row count stays bounded
6. Check server logs → pruning job logs appear nightly

---

## Future Phase 4 (Not In Scope Now)
**Local SQLite Backup (WhatsApp-style)**
- Every message saved locally on device using `expo-sqlite`
- Survives app uninstall / reinstall
- Works fully offline
- Full chat history forever (no cloud size limit)
- Restore on new phone

*Will plan this separately after Phases 1-3 are stable.*
