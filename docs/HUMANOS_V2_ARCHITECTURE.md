# HumanOS V2 Architecture
**Role:** Principal Architect / Staff Engineer Review
**Date:** 2026-07-01

---

# ARCHITECTURE

---

# 1. Messaging Architecture

## Design Principle
The chat behaves like WhatsApp. Messages are queued locally the moment the user taps Send. The network is irrelevant to the UX. The queue owns the delivery lifecycle.

## Delivery State Machine

QUEUED -> (tap Send) -> SENDING -> (server ack) -> SENT -> (Nova replies) -> RECEIVED -> (user opens) -> READ
  ^                         |
  |   max retries           | network fail
  +-------- FAILED <--------+
                |
                +-- user retries --> SENDING

States:
- queued    written to persistent local storage; not transmitted
- sending   HTTP/SSE request in flight
- sent      server acknowledged; message written to DB
- received  Nova has generated a reply
- read      user has viewed the reply (future)
- failed    all retries exhausted; user action required

## Persistent Outbox

Current: Zustand in-memory (lost on app kill)
V2: Zustand + expo-secure-store

Outbox Entry Schema:
  id             (UUID = idempotency key)
  content
  conversationId
  status
  attempts
  lastAttemptAt
  createdAt
  errorMessage

Persistence rules:
- Write to outbox BEFORE any network call
- On app resume: drain all queued/failed entries
- On success: mark sent, archive 7 days
- On failure: increment attempts, exponential backoff

## Retry Strategy

Attempt 1: immediate
Attempt 2: 2s delay
Attempt 3: 4s delay
Attempt 4: 8s delay
Attempt 5: 16s delay
After 5:   FAILED (user can manually retry)

## Idempotency

Every message carries a UUID as idempotency_key.
Backend: UNIQUE(idempotency_key) on messages table.
On conflict: return existing row. Prevents double-sends.

## FIFO Ordering

Outbox processes messages in createdAt order.
Only one message in sending state per conversation at a time.

## Background Task: OUTBOX_PROCESSOR

Registered in index.ts before React mounts.
- Polls every 30s when backgrounded
- Drains immediately on foreground
- Error-isolated, never crashes app

## Background Receiving

User sends message (app closed)
  -> Backend generates Nova reply
  -> Reply saved to DB
  -> FCM/APNs push triggered
  -> "Nova: [first 80 chars]..."
  -> User taps -> app fetches reply from DB

---

# 2. Memory Architecture

## Design Principle

Constant-size context window regardless of whether user has 1 day or 10 years of history.

## Tiered Memory Model

TIER 0: FAST MEMORY
  Last 20 messages. Zustand. Zero latency.

TIER 1: SHORT-TERM MEMORY
  Last 7 days. Session summaries. pgvector embedded.
  Retrieval: top-3 most recent summaries.

TIER 2: LONG-TERM MEMORY
  Named facts, goals, people, preferences.
  Retrieval: semantic search (pgvector HNSW) top-5.

TIER 3: LIFE TIMELINE
  Monthly/yearly summaries. Milestones.
  Retrieval: only on temporal queries.

## Token Budget (Fixed)

System Prompt                  ~800 tokens
Tier 0: Last 20 messages      ~3000 tokens
Tier 1: Top-3 summaries        ~900 tokens
Tier 2: Top-5 memories         ~600 tokens
Tier 3: Timeline (optional)    ~300 tokens
User message                   ~200 tokens
Total                         ~5800 tokens (constant)

## Database Schema

-- messages: add index
CREATE INDEX idx_messages_conversation_created
  ON messages(conversation_id, created_at DESC);

-- conversation_summaries (Tier 1)
CREATE TABLE conversation_summaries (
  id               uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id  uuid,
  summary_text     text NOT NULL,
  embedding        vector(1024),
  date_range_start timestamptz NOT NULL,
  date_range_end   timestamptz NOT NULL,
  message_count    integer DEFAULT 0,
  created_at       timestamptz DEFAULT now()
);
CREATE INDEX idx_conv_summaries_user_date
  ON conversation_summaries(user_id, date_range_end DESC);
CREATE INDEX idx_conv_summaries_embedding
  ON conversation_summaries USING hnsw (embedding vector_cosine_ops);

-- memories (Tier 2): ensure HNSW index
CREATE INDEX IF NOT EXISTS idx_memories_embedding
  ON memories USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- timeline_entries (Tier 3)
CREATE TABLE timeline_entries (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  period_type   text NOT NULL CHECK (period_type IN ('week','month','year')),
  period_label  text NOT NULL,
  summary_text  text NOT NULL,
  topic_tags    text[],
  memory_count  integer DEFAULT 0,
  created_at    timestamptz DEFAULT now(),
  UNIQUE(user_id, period_type, period_label)
);

-- daily_summaries
CREATE TABLE daily_summaries (
  id           uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date         date NOT NULL,
  summary_text text NOT NULL,
  topics       text[],
  nova_insight text,
  delivered    boolean DEFAULT false,
  created_at   timestamptz DEFAULT now(),
  UNIQUE(user_id, date)
);

## Retrieval Algorithm

1. Load Tier 0 from Zustand (0ms)
2. In parallel:
   a. SELECT TOP 3 conversation_summaries ORDER BY date_range_end DESC (~15ms)
   b. SELECT TOP 5 memories ORDER BY embedding vs query_embedding (~20ms)
3. If temporal keywords ("last year", "when did"): include timeline_entries
4. Assemble within token budget
5. Truncation: oldest Tier 1 first, lowest Tier 2 second, never Tier 0

## Background Jobs

SESSION_SUMMARIZER
  Trigger: 30min inactivity
  Action: messages -> LLM summary -> embed -> conversation_summaries

MEMORY_EXTRACTOR
  Trigger: After each Nova reply
  Action: last 5 messages -> extract facts -> memories with importance score

DAILY_SUMMARIZER
  Trigger: Midnight UTC
  Action: summaries -> LLM recap -> daily_summaries -> push notification

MONTHLY_SYNTHESIZER
  Trigger: 1st of month
  Action: daily_summaries -> timeline_entries

EMBEDDING_REFRESHER
  Trigger: Nightly low-priority
  Action: backfill null embeddings

## Pruning Strategy

conversation_summaries: keep 90 days; archive older to timeline
memories: never prune; importance scores filter retrieval
daily_summaries: keep 365 days; synthesize to timeline after 1 year
timeline_entries: keep forever

---

# 3. Performance Architecture

## Current (Sequential)

profile (15ms) -> history (25ms) -> memories (35ms) -> prompt (10ms) -> LLM (1500-45000ms)
Total: 40-60 seconds worst case

## V2 (Parallel + Streaming)

All in parallel: Tier 0 (0ms), Tier 1 DB (~15ms), Tier 2 pgvector (~20ms), profile cache (~5ms)
Gathered in ~20ms -> prompt build ~5ms -> SSE stream -> FIRST TOKEN 200-500ms
Total perceived: < 500ms

## SSE Flow

Client POST /chat/stream -> Backend SSE opens
  <- data: chunk "Hello"
  <- data: chunk " there"
  <- data: done

## Caching

L1 in-process: user profile (5min TTL), system prompt (indefinite)
L2 Redis (future): summaries (1hr), memories (30min)

## Frontend

FlatList: inverted, windowSize=10, maxToRenderPerBatch=15
Messages: React.memo per item
Dates: useMemo (done)
Hydration: skeleton loader (done)
Appending: never re-render full list

---

# 4. Notifications Architecture

## Full Pipeline

User sends (app closed)
  -> outbox saved (expo-secure-store)
  -> OUTBOX_PROCESSOR fires
  -> POST to backend -> 202 Accepted
  -> backend generates Nova reply
  -> FCM/APNs triggered
  -> "Nova: [80 chars]..."
  -> user taps -> reply in DB -> renders

## Stack

Client:  expo-notifications
Backend: @expo/server
Android: FCM
iOS:     APNs

## Token Management

First launch: request permission
Each login: register/refresh push token
Backend: { user_id, push_token, platform, updated_at }

## Background Tasks (index.ts before React)

OUTBOX_PROCESSOR: drain outbox, stopOnTerminate=false, startOnBoot=true
INBOX_POLLER: poll /messages/latest, update local store

## Notification Content

Nova reply:    Title="Nova" Body="[80 chars of reply]..."
Daily summary: Title="Today in HumanOS" Body="Talked about X, Y. 3 new memories."
Milestone:     Title="HumanOS Milestone" Body="This is your 100th conversation with Nova."

---

# 5. Roadmap

## Phase 1 - Feel Alive (Weeks 1-6) -- START HERE

Goal: Nova feels instant. Zero spinner.

Deliverables:
- /chat/stream SSE endpoint (Express + NVIDIA NIM stream:true)
- streamMessage() with silent fallback to /chat
- novaState: thinking | typing | complete
- "Nova is thinking..." / "Nova is typing..." UI
- Rotating status: "Recalling memories...", "Reading our history..."
- Chunk-by-chunk message rendering
- Metrics: LLM_FIRST_TOKEN_MS, RESPONSE_RENDER_MS, TOTAL_REQUEST_MS

Definition of Done: Tap Send -> first content < 1 second.

## Phase 2 - Persistent Messaging (Weeks 7-12)

Goal: Messages never fail. Queue survives app kill.

Deliverables:
- Persistent outbox (expo-secure-store)
- OUTBOX_PROCESSOR background task
- Full delivery state machine in UI
- Idempotency keys
- Exponential backoff (5 attempts)
- Manual retry on failed messages

Definition of Done: Send offline -> reconnect -> auto-delivers.

## Phase 3 - Memory V2 (Weeks 13-20)

Goal: Memory scales to years without slowing down.

Deliverables:
- conversation_summaries + SESSION_SUMMARIZER
- Cap hydrateMessages to 20 messages
- Prompt builder V2 (tiered, token-budgeted)
- pgvector HNSW on memories
- daily_summaries + DAILY_SUMMARIZER
- timeline_entries + MONTHLY_SYNTHESIZER

Definition of Done: 1000-message user gets same speed as day-1 user.

## Phase 4 - Push Notifications (Weeks 21-28)

Goal: Nova replies even when app is closed.

Deliverables:
- expo-notifications + push token registration
- FCM/APNs backend (@expo/server)
- INBOX_POLLER background task
- Nova reply / daily summary / milestone notifications
- Timeline Tab UI

Definition of Done: Close app -> send -> receive push in 60s.

---

# RISKS

Risk                                     | Severity | Mitigation
SSE dropped on WiFi-LTE transition       | HIGH     | Auto-detect, silent /chat fallback
Android kills background tasks           | HIGH     | Foreground notification while sending
NVIDIA NIM cold starts (40s+)            | HIGH     | 30s timeout, show "Nova is thinking hard..."
pgvector HNSW rebuild cost               | MEDIUM   | ef_construction=64, async off-peak
FCM token staleness on reinstall         | MEDIUM   | Upsert token on every login
OTA crash repeat (native module in JS)   | HIGH     | New native module = new binary first; canary always
Memory extraction LLM cost              | MEDIUM   | Max 1 call per 5 messages
Prompt token budget exceeded             | LOW      | Hard cap + log PROMPT_TOKEN_COUNT

---

# RECOMMENDED IMPLEMENTATION ORDER

Week 1-2:   Backend /chat/stream SSE
Week 3:     Frontend streamMessage() + fallback
Week 4:     novaState machine + thinking/typing UI
Week 5:     Dynamic status messages + chunk rendering
Week 6:     Canary test -> production
Week 7-8:   Persistent outbox
Week 9:     OUTBOX_PROCESSOR background task
Week 10:    Delivery state machine UI
Week 11:    Retry + idempotency
Week 12:    Offline test suite
Week 13-15: conversation_summaries + SESSION_SUMMARIZER
Week 16-17: Prompt builder V2
Week 18-20: pgvector HNSW, daily_summaries, timeline_entries
Week 21-24: FCM + push notifications
Week 25-26: Timeline Tab UI, daily summary cards
Week 27-28: Milestones, HumanOS Moments in chat

---

# ESTIMATED PERFORMANCE

Metric                  | Today     | Phase 1     | Phase 2     | Phase 3
Time to first content   | 40-60s    | < 500ms     | < 500ms     | < 500ms
Full response           | 3-60s     | 2-8s        | 2-8s        | 2-6s
Memory retrieval        | 35-80ms   | 35-80ms     | 35-80ms     | < 20ms
Prompt size             | unbounded | unbounded   | unbounded   | ~5800 tokens (fixed)
Message survival kill   | lost      | lost        | survives    | survives
Auto-delivery reconnect | manual    | manual      | automatic   | automatic
Nova replies app closed | never     | never       | never       | push notification
Memory at 5 years       | degrades  | degrades    | degrades    | fully functional
