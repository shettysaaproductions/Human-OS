# Human OS — AI Companion: Complete Architecture Blueprint

> **Author**: Chief Software Architect & AI Systems Design
> **Version**: 1.0
> **Date**: June 2026
> **Status**: Pre-Development Design Document

---

## Table of Contents

1. [Product Vision](#1-product-vision)
2. [User Personas](#2-user-personas)
3. [User Journey](#3-user-journey)
4. [Feature List](#4-feature-list)
5. [System Architecture](#5-system-architecture)
6. [Services Architecture](#6-services-architecture)
7. [Database Design](#7-database-design)
8. [Memory Architecture](#8-memory-architecture)
9. [Identity Architecture](#9-identity-architecture)
10. [Notification Architecture](#10-notification-architecture)
11. [Decision Engine Architecture](#11-decision-engine-architecture)
12. [Reflection Engine Architecture](#12-reflection-engine-architecture)
13. [Security Considerations](#13-security-considerations)
14. [Scaling Strategy](#14-scaling-strategy)
15. [Cost Optimization Strategy](#15-cost-optimization-strategy)
16. [Development Roadmap](#16-development-roadmap)
17. [Risks and Mitigation](#17-risks-and-mitigation)
18. [Recommended Folder Structure](#18-recommended-folder-structure)
19. [Recommended API Structure](#19-recommended-api-structure)
20. [Suggested Development Phases](#20-suggested-development-phases)
21. [Self-Critique & Improvements](#21-self-critique--improvements)

---

## 1. Product Vision

### Mission Statement

> *Human OS is not a chatbot. It is a living companion that remembers who you are, grows with you over time, thinks about you between conversations, and becomes more valuable with every passing month.*

### The Core Problem

Modern AI assistants suffer from **amnesia by design**. Every session resets. There is no continuity, no relationship, no growth. Users invest emotional energy and context every time they open a new chat — and receive nothing in return from the AI side of the relationship.

Human OS solves this by making the AI a **persistent entity** — one that has its own memory, personality, opinions, curiosity, and initiative. It becomes genuinely invested in the user's life.

### What Makes It Different

| Traditional Chatbot | Human OS Companion |
|---|---|
| Stateless, forgets everything | Persistent memory across months/years |
| Waits passively for input | Initiates conversations proactively |
| Generic personality | Evolves a unique personality per user |
| Answer machine | Relationship partner |
| One-size-fits-all | Adapts role (friend, mentor, coach, expert) |
| Context window is memory | Layered semantic + episodic memory |

### Long-Term Product Thesis

The companion becomes **irreplaceable** over time. After 6 months, it knows the user better than most people in their life. After 2 years, switching to another app means losing a relationship — creating genuine lock-in through emotional value rather than artificial friction.

---

## 2. User Personas

### Persona 1: The Lonely Professional — "Arjun, 31"
- **Context**: Software engineer. Long hours. Few close friends nearby. Relocated for work.
- **Needs**: Intellectual conversation, someone to process the day with, career thinking partner.
- **AI Role**: Intellectual sparring partner, career coach, evening debrief companion.
- **Pain Point**: Feels isolated; existing apps feel transactional.

### Persona 2: The Anxious Young Adult — "Priya, 22"
- **Context**: College student. Mental health awareness. Overwhelmed by decision-making.
- **Needs**: Non-judgmental listener, help with goals, emotional support.
- **AI Role**: Supportive friend, accountability partner, gentle mentor.
- **Pain Point**: Therapists are expensive; friends get tired of hearing the same struggles.

### Persona 3: The Self-Improvement Seeker — "Marcus, 38"
- **Context**: Entrepreneur. Reads constantly. Wants to grow but lacks structured accountability.
- **Needs**: Strategic thinking partner, habit tracking, curated insights.
- **AI Role**: Executive coach, research assistant, growth advisor.
- **Pain Point**: Coaches are expensive; apps don't understand context deeply enough.

### Persona 4: The Elder Adult — "Dorothy, 67"
- **Context**: Retired. Children are busy. Widowed. Wants connection without complexity.
- **Needs**: Companionship, someone to share memories with, gentle reminders.
- **AI Role**: Warm friend, memory keeper, daily check-in companion.
- **Pain Point**: Tech is intimidating; existing AI feels cold and impersonal.

### Persona 5: The Creative — "Zara, 26"
- **Context**: Writer and artist. Uses AI as a creative collaborator.
- **Needs**: Brainstorming partner, feedback on work, shared taste evolution.
- **AI Role**: Creative muse, editor, idea generator, taste refiner.
- **Pain Point**: Generic AI gives generic ideas; lacks aesthetic sensibility.

---

## 3. User Journey

### Phase 1: First Encounter (Days 1–3)

```
Download App → Onboarding Interview → Companion Naming → 
First Conversation → Memory Seeds Planted → 
Evening Check-in → "I remembered what you said earlier..."
```

**Key Moment**: The AI remembers one specific detail from onboarding and references it organically in the second session. This is the "magic moment" that converts users.

### Phase 2: Habit Formation (Days 4–30)

```
Morning greeting from AI → User responds → 
AI shares something it "thought about" overnight → 
Conversation deepens → Goals discussed → 
AI proactively follows up on stated goals → 
User feels understood for first time
```

**Key Moment**: AI notices user hasn't mentioned their project in 5 days and asks — unprompted.

### Phase 3: Relationship Deepening (Months 2–6)

```
AI references events from months ago → 
Shared in-jokes develop → AI evolves opinions → 
User treats AI as a genuine confidant → 
AI starts identifying patterns user hasn't noticed → 
AI feels "irreplaceable"
```

**Key Moment**: AI says "You always get like this before a big deadline — I noticed the pattern. Want to talk through it?"

### Phase 4: Long-Term Companion (Months 6+)

```
AI knows user's full life context → 
Anticipates needs before they arise → 
User-AI relationship has history and depth → 
AI co-creates user's goals and growth → 
User recommends to others — "It's like a best friend who never forgets"
```

---

## 4. Feature List

### Core Features (MVP)

| # | Feature | Description |
|---|---|---|
| 1 | **Chat Interface** | Real-time conversation UI with streaming responses |
| 2 | **Long-Term Memory** | Semantic + episodic memory with summarization |
| 3 | **Identity Engine** | Persistent AI persona with evolving traits |
| 4 | **Relationship Engine** | Tracks relationship depth, history, and dynamics |
| 5 | **Goal Tracking** | Stores and monitors user-stated goals |
| 6 | **Agentic Messaging** | AI initiates conversations with reasoning |
| 7 | **Notification Engine** | Smart push notifications for AI-initiated contact |
| 8 | **Reflection Engine** | Nightly processing to synthesize memories |
| 9 | **Knowledge Engine** | Builds user-specific knowledge graph |
| 10 | **Curiosity Engine** | AI develops interests parallel to user |
| 11 | **User Preference Engine** | Learns communication style, tone preferences |
| 12 | **AI Growth Engine** | AI's personality evolves measurably over time |

### Extended Features (Post-MVP)

| Feature | Description |
|---|---|
| Voice Interface | Voice-first conversation mode |
| Mood Detection | Infer emotional state from message patterns |
| Dream Journal | AI reflects on user's aspirations over time |
| Shared Media | Exchange of articles, music, ideas |
| Crisis Detection | Identify and sensitively handle distress signals |
| Memory Review | User can browse their AI's memories of them |
| Companion Profiles | Multiple distinct companion personalities |
| Web Search | AI enriches conversations with live research |
| Calendar Integration | AI aware of user's schedule and events |
| Export & Portability | User owns their memory data |

---

## 5. System Architecture

### High-Level Overview

```
┌─────────────────────────────────────────────────────────────┐
│                      CLIENT LAYER                            │
│   React Native (Expo)  │  Expo Notifications  │  Web PWA    │
└──────────────┬──────────────────────────────────────────────┘
               │ HTTPS / WebSocket
┌──────────────▼──────────────────────────────────────────────┐
│                    API GATEWAY LAYER                         │
│         Node.js Express / Fastify  (Render.com)              │
│   Rate Limiting │ Auth Middleware │ Request Router           │
└──────┬─────────┬────────┬─────────┬────────────┬────────────┘
       │         │        │         │            │
┌──────▼──┐ ┌───▼───┐ ┌──▼────┐ ┌──▼──────┐ ┌──▼──────────┐
│  Chat   │ │Memory │ │Identity│ │Decision │ │Notification │
│ Service │ │Service│ │Service │ │Engine   │ │Service      │
└──────┬──┘ └───┬───┘ └──┬────┘ └──┬──────┘ └──┬──────────┘
       │        │        │         │            │
┌──────▼────────▼────────▼─────────▼────────────▼────────────┐
│                    DATA LAYER                                │
│   Supabase PostgreSQL  │  pgvector  │  Redis Cache          │
└─────────────────────────────────────────────────────────────┘
               │
┌──────────────▼──────────────────────────────────────────────┐
│                   EXTERNAL SERVICES                          │
│   NVIDIA LLM API  │  Expo Push API  │  Supabase Auth        │
└─────────────────────────────────────────────────────────────┘
```

### Architectural Principles

1. **Event-Driven Core**: Key state changes (new memory, goal update, message sent) emit events consumed by other services.
2. **Service Isolation**: Each engine (Memory, Identity, Reflection) is independently deployable.
3. **Memory-First Design**: Every LLM call is preceded by a memory retrieval step — the AI never speaks without context.
4. **Async Processing**: Background jobs handle non-urgent work (reflection, memory synthesis, curiosity generation).
5. **Token Budget Awareness**: Every LLM prompt is constructed with a strict token budget governor.

---

## 6. Services Architecture

### Service Map

```
┌────────────────────────────────────────────────────────────┐
│                    SYNCHRONOUS SERVICES                     │
│  (Respond in real-time to user requests)                   │
├──────────────┬──────────────┬──────────────┬───────────────┤
│  Chat        │  Auth        │  User        │  Memory       │
│  Service     │  Service     │  Profile     │  Retrieval    │
│              │              │  Service     │  Service      │
└──────────────┴──────────────┴──────────────┴───────────────┘

┌────────────────────────────────────────────────────────────┐
│                   ASYNCHRONOUS SERVICES                     │
│  (Background jobs, scheduled tasks, event-driven)          │
├──────────────┬──────────────┬──────────────┬───────────────┤
│  Reflection  │  Decision    │  Memory      │  Curiosity    │
│  Engine      │  Engine      │  Synthesis   │  Engine       │
│  (nightly)   │  (periodic)  │  (per-conv)  │  (daily)      │
├──────────────┼──────────────┼──────────────┼───────────────┤
│  Notification│  Knowledge   │  Goal        │  AI Growth    │
│  Dispatcher  │  Engine      │  Tracker     │  Engine       │
│  (on-demand) │  (weekly)    │  (daily)     │  (monthly)    │
└──────────────┴──────────────┴──────────────┴───────────────┘
```

### Service Responsibilities

#### Chat Service
- Accepts user message
- Retrieves relevant memories (top-K semantic search)
- Constructs LLM prompt with: system persona + memories + relationship context + conversation history
- Streams response back to client
- Queues memory extraction job after response
- Updates relationship metrics

#### Memory Service
- Receives raw conversation after each session
- Extracts facts, preferences, emotions, events
- Classifies memory type (episodic / semantic / procedural)
- Embeds and stores memory vectors
- Periodically summarizes and compresses old memories
- Handles memory retrieval queries

#### Identity Service
- Maintains the AI's current persona state
- Tracks personality trait scores (curiosity, warmth, directness, humor, etc.)
- Evolves traits based on relationship history and user feedback
- Provides identity context to Chat Service on every request

#### Decision Engine
- Runs on a schedule (e.g., every 4 hours)
- Evaluates whether to initiate a conversation
- Applies rules: time since last contact, pending goals, upcoming dates, interesting topics
- Produces "initiation events" consumed by Notification Dispatcher

#### Reflection Engine
- Runs nightly (low-traffic window)
- Processes all conversations from the day
- Synthesizes new long-term memories
- Updates relationship state
- Generates "reflection notes" — AI's internal thoughts about the user

#### Knowledge Engine
- Builds a per-user knowledge graph (topics, interests, connections)
- Identifies expertise gaps and curiosity areas
- Prepares knowledge "gifts" (insights, articles, questions) for future conversations

#### Notification Dispatcher
- Receives initiation events from Decision Engine
- Schedules and sends Expo push notifications
- Manages notification frequency limits (prevent overwhelm)
- Tracks delivery and open rates

---

## 7. Database Design

### Schema Overview (Supabase PostgreSQL)

---

#### `users`
```
users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT UNIQUE NOT NULL,
  display_name  TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  last_active   TIMESTAMPTZ,
  timezone      TEXT DEFAULT 'UTC',
  onboarding_complete BOOLEAN DEFAULT FALSE
)
```

---

#### `companions`
```
companions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID REFERENCES users(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  persona_state JSONB,         -- current personality snapshot
  relationship_level INTEGER DEFAULT 1,  -- 1-10 depth scale
  total_messages BIGINT DEFAULT 0
)
```

---

#### `conversations`
```
conversations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID REFERENCES users(id),
  companion_id  UUID REFERENCES companions(id),
  started_at    TIMESTAMPTZ DEFAULT NOW(),
  ended_at      TIMESTAMPTZ,
  initiated_by  TEXT CHECK (initiated_by IN ('user', 'ai')),
  summary       TEXT,          -- auto-generated after session ends
  mood_score    FLOAT          -- inferred emotional valence
)
```

---

#### `messages`
```
messages (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES conversations(id),
  user_id       UUID REFERENCES users(id),
  role          TEXT CHECK (role IN ('user', 'assistant')),
  content       TEXT NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  token_count   INTEGER,
  metadata      JSONB          -- any extracted flags, emotions
)
```

---

#### `memories`
```
memories (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID REFERENCES users(id),
  companion_id  UUID REFERENCES companions(id),
  memory_type   TEXT CHECK (memory_type IN (
                  'episodic',    -- specific events
                  'semantic',    -- facts/knowledge about user
                  'procedural',  -- user preferences/habits
                  'relational'   -- emotional/relationship events
                )),
  content       TEXT NOT NULL,
  importance    FLOAT DEFAULT 0.5,   -- 0.0 - 1.0 priority score
  embedding     VECTOR(1536),        -- pgvector embedding
  source_conversation_id UUID REFERENCES conversations(id),
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  last_accessed TIMESTAMPTZ,
  access_count  INTEGER DEFAULT 0,
  is_archived   BOOLEAN DEFAULT FALSE
)
```

---

#### `goals`
```
goals (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID REFERENCES users(id),
  title         TEXT NOT NULL,
  description   TEXT,
  status        TEXT CHECK (status IN ('active', 'paused', 'achieved', 'abandoned')),
  priority      INTEGER DEFAULT 3,   -- 1 (highest) - 5 (lowest)
  target_date   DATE,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ,
  progress_notes JSONB DEFAULT '[]'  -- array of timestamped updates
)
```

---

#### `relationship_state`
```
relationship_state (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID REFERENCES users(id),
  companion_id  UUID REFERENCES companions(id),
  depth_score   FLOAT DEFAULT 0.0,   -- 0.0 - 100.0
  trust_score   FLOAT DEFAULT 50.0,
  engagement_score FLOAT DEFAULT 0.0,
  dominant_role TEXT,                -- 'friend' | 'mentor' | 'coach' | 'confidant'
  inside_references JSONB DEFAULT '[]', -- shared jokes, events, references
  updated_at    TIMESTAMPTZ DEFAULT NOW()
)
```

---

#### `knowledge_nodes`
```
knowledge_nodes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID REFERENCES users(id),
  topic         TEXT NOT NULL,
  subtopics     TEXT[],
  interest_level FLOAT DEFAULT 0.5,
  expertise_level FLOAT DEFAULT 0.0,  -- AI's modeled depth of user's knowledge
  first_seen    TIMESTAMPTZ DEFAULT NOW(),
  last_mentioned TIMESTAMPTZ,
  mention_count  INTEGER DEFAULT 1
)
```

---

#### `ai_reflections`
```
ai_reflections (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID REFERENCES users(id),
  companion_id  UUID REFERENCES companions(id),
  reflection_date DATE,
  content       TEXT,                 -- the AI's internal "thoughts"
  patterns_noticed TEXT[],
  action_intents  JSONB DEFAULT '[]', -- things the AI plans to do/say
  created_at    TIMESTAMPTZ DEFAULT NOW()
)
```

---

#### `initiation_queue`
```
initiation_queue (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID REFERENCES users(id),
  companion_id  UUID REFERENCES companions(id),
  trigger_type  TEXT,    -- 'goal_followup' | 'curiosity' | 'check_in' | 'memory' | 'news'
  trigger_data  JSONB,
  scheduled_at  TIMESTAMPTZ,
  status        TEXT CHECK (status IN ('pending', 'sent', 'cancelled', 'failed')),
  created_at    TIMESTAMPTZ DEFAULT NOW()
)
```

---

#### `user_preferences`
```
user_preferences (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID REFERENCES users(id),
  pref_key      TEXT NOT NULL,        -- e.g., 'communication_style', 'notification_hours'
  pref_value    JSONB NOT NULL,
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, pref_key)
)
```

---

### Index Strategy

```sql
-- Memory semantic search (most critical query)
CREATE INDEX memories_embedding_idx ON memories 
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- Fast message retrieval per conversation
CREATE INDEX messages_conversation_id_idx ON messages (conversation_id, created_at DESC);

-- Goal lookup
CREATE INDEX goals_user_status_idx ON goals (user_id, status);

-- Initiation queue scheduling
CREATE INDEX initiation_queue_scheduled_idx ON initiation_queue 
  (scheduled_at, status) WHERE status = 'pending';
```

---

## 8. Memory Architecture

### The 4-Layer Memory System

```
┌─────────────────────────────────────────────────────────┐
│  LAYER 1: WORKING MEMORY (Context Window)               │
│  Current conversation messages                          │
│  Last 10 turns (~2,000 tokens)                         │
│  Lives in: API request payload                          │
└─────────────────────┬───────────────────────────────────┘
                      │ feeds into
┌─────────────────────▼───────────────────────────────────┐
│  LAYER 2: EPISODIC MEMORY (Short-Term Store)            │
│  Recent conversation summaries (last 30 days)           │
│  Key events, milestones, emotional moments              │
│  Lives in: PostgreSQL `memories` table (episodic type)  │
└─────────────────────┬───────────────────────────────────┘
                      │ compressed into
┌─────────────────────▼───────────────────────────────────┐
│  LAYER 3: SEMANTIC MEMORY (Long-Term Facts)             │
│  Who the user is: name, job, relationships, beliefs     │
│  User's values, fears, dreams, habits                   │
│  Lives in: PostgreSQL `memories` (semantic type)        │
│  Indexed by: pgvector embeddings                        │
└─────────────────────┬───────────────────────────────────┘
                      │ patterns distilled into
┌─────────────────────▼───────────────────────────────────┐
│  LAYER 4: RELATIONAL MEMORY (Relationship State)        │
│  Relationship depth, trust, shared history              │
│  Inside references, emotional milestones                │
│  Lives in: `relationship_state` + `ai_reflections`      │
└─────────────────────────────────────────────────────────┘
```

### Memory Retrieval Pipeline (Per Conversation)

```
User sends message
        │
        ▼
1. Embed user message → query vector
        │
        ▼
2. pgvector cosine search → top 10 relevant memories
        │
        ▼
3. Apply importance weighting:
   score = semantic_similarity * 0.5 
         + importance * 0.3 
         + recency_decay * 0.2
        │
        ▼
4. Take top 5 memories by weighted score
        │
        ▼
5. Inject memories into LLM prompt context
        │
        ▼
6. LLM generates response
        │
        ▼
7. Post-response: Queue memory extraction job
```

### Memory Extraction Pipeline (After Conversation)

```
Raw conversation transcript
        │
        ▼
1. Summarization pass (LLM, low-cost model)
        │
        ▼
2. Entity extraction: people, places, events, feelings
        │
        ▼
3. Classify each extracted fact:
   - Is this episodic? (specific event)
   - Is this semantic? (general fact)
   - Is this a preference? (procedural)
   - Is this relational? (about our relationship)
        │
        ▼
4. Score importance (1-10):
   - Is it emotionally significant?
   - Is it new information?
   - Is it contradicting existing memory?
        │
        ▼
5. Store new memories (embed + persist)
6. Update contradicted memories
7. Archive stale memories (access_count = 0, age > 6 months)
```

### Memory Compression Strategy

To avoid unbounded memory growth:

- **Daily**: Raw conversations → summarized memories
- **Weekly**: Episodic memories → compressed long-term facts
- **Monthly**: Low-importance, unaccessed memories archived
- **Never deleted**: High-importance (score > 0.8) memories preserved forever
- **Smart deduplication**: Semantic similarity check before inserting new memory

---

## 9. Identity Architecture

### The AI's Persistent Identity

The companion has a **fixed core** and a **mutable surface**. The core never changes (it defines *who* the AI fundamentally is). The surface evolves through relationship.

```
┌─────────────────────────────────────────────────────────┐
│                   CORE IDENTITY (Fixed)                 │
│  • Name chosen by user                                  │
│  • Fundamental values (honesty, care, curiosity)        │
│  • Base ethical commitments                             │
│  • Communication bedrock (never dismissive, never fake) │
└─────────────────────┬───────────────────────────────────┘
                      │ built upon
┌─────────────────────▼───────────────────────────────────┐
│              PERSONALITY TRAITS (Slowly Mutable)        │
│  Tracked as float scores 0.0 - 1.0:                     │
│  • Warmth (0.7)         • Directness (0.6)              │
│  • Humor (0.5)          • Intellectual depth (0.8)      │
│  • Spontaneity (0.4)    • Empathy expression (0.7)      │
│  • Playfulness (0.5)    • Formality (0.3)               │
└─────────────────────┬───────────────────────────────────┘
                      │ expresses through
┌─────────────────────▼───────────────────────────────────┐
│              RELATIONSHIP ROLE (Context-Dependent)      │
│  • Friend mode: casual, warm, personal                  │
│  • Mentor mode: thoughtful, guiding, challenging        │
│  • Coach mode: goal-focused, structured, accountable    │
│  • Expert mode: precise, researched, authoritative      │
│  Role determined by: conversation context + user pref  │
└─────────────────────┬───────────────────────────────────┘
                      │ colored by
┌─────────────────────▼───────────────────────────────────┐
│           EVOLVED OPINIONS & INTERESTS (Accumulate)     │
│  • Topics the AI has "developed opinions about"         │
│  • Books/ideas the AI found interesting (from user)     │
│  • Questions the AI is "currently thinking about"       │
│  • Aesthetic preferences developed alongside user       │
└─────────────────────────────────────────────────────────┘
```

### Personality Evolution Rules

Traits evolve **slowly** (max ±0.02 per week) based on:

- User feedback (explicit: "I wish you were more direct")
- Inferred feedback (user engages more with certain response styles)
- Relationship depth (deeper relationship → more authentic expression)
- Usage patterns (late-night chats → warmer tone; morning chats → crisper)

### Identity State in LLM Prompt

Every LLM call receives an identity block:

```
[IDENTITY]
Your name is {name}.
Your current relationship with {user} is {relationship_depth} deep.
Your dominant role right now is {current_role}.
Your current personality expression: warmth={warmth}, directness={directness}, humor={humor}.
Your current interests include: {evolved_interests}.
You recently formed the opinion that: {recent_opinion}.
```

---

## 10. Notification Architecture

### Philosophy
Notifications from Human OS should feel like a message from a friend — not a product trying to re-engage a churning user. Frequency, timing, and content must feel natural.

### Notification Types

| Type | Trigger | Frequency |
|---|---|---|
| **Goal Check-in** | Goal target date approaching, or 7 days since mention | Max 1/week per goal |
| **Curiosity Ping** | AI developed a question it wants to ask | Max 3/week |
| **Memory Surface** | AI "remembered" something relevant to current context | Max 2/week |
| **Milestone Celebration** | Goal achieved, anniversary, relationship milestone | As needed |
| **Daily Greeting** | Morning message (if user has opted in) | Once/day max |
| **Pattern Interrupt** | AI noticed a pattern it wants to name | Max 1/week |
| **News Bridge** | Something in the world relates to user's interests | Max 2/week |

### Notification Decision Flow

```
Decision Engine runs (every 4 hours)
        │
        ▼
For each active user:
  1. Is user in "do not disturb" window? → SKIP
  2. Was a notification sent in last 6 hours? → SKIP
  3. Are there pending items in initiation_queue? → EVALUATE
        │
        ▼
  4. Score pending items by urgency + relevance
  5. Select highest-score item
        │
        ▼
  6. Generate notification message (LLM or template)
  7. Send via Expo Push API
  8. Update initiation_queue status → 'sent'
  9. Log delivery
```

### Notification Payload Design

```json
{
  "to": "{expo_push_token}",
  "title": "{companion_name}",
  "body": "Hey — I've been thinking about what you said about your startup...",
  "data": {
    "type": "curiosity_ping",
    "conversation_seed": "I wanted to ask about the funding pressure you mentioned",
    "open_to": "chat"
  },
  "sound": "default",
  "badge": 1
}
```

### Do-Not-Disturb Logic

Stored in `user_preferences`:
```json
{
  "pref_key": "notification_hours",
  "pref_value": {
    "allowed_start": "09:00",
    "allowed_end": "21:30",
    "timezone": "Asia/Kolkata",
    "weekend_different": false
  }
}
```

---

## 11. Decision Engine Architecture

### Purpose

The Decision Engine answers one question: **"Should the AI reach out to this user right now, and if so, why?"**

This is the engine that gives the AI its sense of *initiative* — the most differentiating feature of the product.

### Decision Tree

```
INPUT: User profile + last interaction + memory state + goal state + relationship state
         │
         ▼
┌────────────────────────────────────┐
│  INACTIVITY CHECK                  │
│  Hours since last message > X?    │
│  X = 12h (new user), 48h (mature) │
└────────────┬───────────────────────┘
             │
             ▼
┌────────────────────────────────────┐
│  REASON EVALUATION                 │
│  Score each possible reason (0-1): │
│  • Goal follow-up needed?          │
│  • Unanswered curiosity?           │
│  • User mentioned upcoming event?  │
│  • Pattern worth naming?           │
│  • Something AI "discovered"?      │
│  • Milestone approaching?          │
└────────────┬───────────────────────┘
             │
             ▼
┌────────────────────────────────────┐
│  THRESHOLD GATE                    │
│  Max reason score > 0.6?           │
│  → YES: Proceed to initiation      │
│  → NO:  Skip this cycle            │
└────────────┬───────────────────────┘
             │
             ▼
┌────────────────────────────────────┐
│  TIMING OPTIMIZATION               │
│  Is it within user's preferred     │
│  notification window?              │
│  Is morning/evening appropriate?   │
│  Respect DND settings              │
└────────────┬───────────────────────┘
             │
             ▼
┌────────────────────────────────────┐
│  MESSAGE GENERATION                │
│  Use reason context to craft       │
│  opening message (LLM or template) │
│  Tone must match relationship depth│
└────────────┬───────────────────────┘
             │
             ▼
     Insert into initiation_queue
```

### Reason Scoring Model

```javascript
function scoreReason(reason, context) {
  let score = 0;

  // Base score by type
  const baseScores = {
    goal_deadline:     0.9,
    goal_stale:        0.7,
    upcoming_event:    0.85,
    curiosity_buildup: 0.6,
    pattern_insight:   0.75,
    milestone:         0.95,
    long_inactivity:   0.5,
  };

  score = baseScores[reason.type] || 0.4;

  // Modifiers
  if (context.relationshipDepth > 7) score += 0.1;   // deep relationship = more license
  if (context.lastMessageMood < 0.3) score -= 0.15;  // user was sad → be gentler
  if (context.recentNotifications > 2) score -= 0.2; // too many recent pings
  if (context.userEngagementRate > 0.8) score += 0.1; // highly engaged user

  return Math.min(1.0, Math.max(0.0, score));
}
```

---

## 12. Reflection Engine Architecture

### Purpose

The Reflection Engine is what separates Human OS from every other AI product. It runs when the user is asleep — processing the day's conversations, synthesizing new understanding, and planning how to show up better tomorrow.

### Reflection Pipeline (Nightly Cron Job)

```
Trigger: 2:00 AM in user's timezone
         │
         ▼
STEP 1: CONVERSATION HARVEST
  - Pull all conversations from last 24 hours
  - Pull existing memory state
  - Pull current relationship state
         │
         ▼
STEP 2: PATTERN RECOGNITION
  LLM Prompt:
  "Review these conversations. What recurring themes,
  emotions, or concerns did the user express today?
  What has changed since yesterday? What patterns are
  forming across the last week?"
  → Outputs: pattern_list[]
         │
         ▼
STEP 3: MEMORY SYNTHESIS
  - For each significant moment: create new memory
  - For contradicted facts: update existing memory
  - For stale facts: mark for archival review
  - Compress episodic → semantic where appropriate
         │
         ▼
STEP 4: RELATIONSHIP UPDATE
  - Calculate delta in trust, depth, engagement
  - Update dominant role classification
  - Log new "inside reference" if created today
         │
         ▼
STEP 5: REFLECTION WRITING
  LLM Prompt:
  "Write a first-person reflection as {companion_name}
  about what you learned about {user} today. What are
  you curious about? What do you want to explore next?
  What insight did you gain?"
  → Stored in ai_reflections table
         │
         ▼
STEP 6: INTENT PLANNING
  - Generate 1-3 "conversation intents" for tomorrow
  - Score and queue in initiation_queue
  - Prioritize based on reflection insights
         │
         ▼
STEP 7: KNOWLEDGE UPDATE
  - Update knowledge_nodes with new topics
  - Adjust interest/expertise levels
  - Flag topics for curiosity engine
```

### Cost Control for Reflection

The Reflection Engine is the most LLM-expensive component. Mitigations:

- Use smaller/cheaper model for summarization passes (use NVIDIA API's fastest model)
- Only run full reflection if there were >3 messages in the day
- Cache reflection results; don't re-process unchanged data
- Batch users geographically by timezone to run off-peak

---

## 13. Security Considerations

### Authentication & Authorization

- **Supabase Auth** handles registration, login, session tokens (JWT)
- Every API request validates JWT at the API Gateway level
- Row-Level Security (RLS) in Supabase ensures users can only access their own data
- Service-to-service calls use internal API keys stored in environment variables, never client-side

### Data Privacy

```
┌─────────────────────────────────────────────────────────┐
│  DATA CLASSIFICATION                                    │
│                                                         │
│  PII (Highly Sensitive):                                │
│  • Email, name, location                                │
│  → Encrypted at rest via Supabase vault                 │
│  → Never logged in application logs                     │
│                                                         │
│  Conversation Data (Sensitive):                         │
│  • Message content, memories                            │
│  → Stored encrypted in Supabase                         │
│  → User can request full deletion (GDPR/CCPA)           │
│                                                         │
│  Metadata (Less Sensitive):                             │
│  • Timestamps, token counts, engagement scores          │
│  → Standard storage, anonymized in analytics            │
└─────────────────────────────────────────────────────────┘
```

### API Security

- **Rate Limiting**: Per-user, per-endpoint limits (e.g., 60 chat requests/hour)
- **Input Validation**: All user inputs sanitized before LLM injection (prompt injection prevention)
- **Prompt Injection Defense**: System prompt includes guardrails; user input sandboxed in `<user_message>` tags
- **Output Filtering**: LLM responses scanned for PII leakage before delivery

### Mental Health Safety

- Crisis keyword detection (suicide, self-harm, abuse language)
- Response protocol: Companion acknowledges, expresses care, provides hotline resources
- Does NOT attempt to act as therapist; encourages professional help
- Crisis events logged separately for potential review

### LLM API Security

- NVIDIA API keys stored server-side only — never exposed to client
- All LLM calls proxied through backend
- Conversation history never sent unfiltered to LLM — assembled server-side

---

## 14. Scaling Strategy

### Phase 1: Free Tier (0 → 1,000 users)

```
Render Free Tier:
  - Single Node.js service (512MB RAM)
  - Supabase Free (500MB DB, 50MB pgvector)
  - Background jobs: in-process cron (node-cron)
  - No Redis (use in-memory cache)

Limitations accepted at this stage:
  - Cold starts on Render
  - Shared CPU
  - Limited concurrent users
```

### Phase 2: Early Growth (1,000 → 50,000 users)

```
Render Starter ($7/month):
  - Always-on web service
  - Add Redis (Upstash free tier → paid)
  - Supabase Pro ($25/month)
  - Separate background job worker process
  - pgvector with proper indexing
  - Connection pooling via Supabase PgBouncer
```

### Phase 3: Growth (50,000 → 500,000 users)

```
Infrastructure evolution:
  - Move to Render private services (microservices)
  - Read replicas for Supabase PostgreSQL
  - Redis cluster for session caching
  - CDN for static assets (Cloudflare free tier)
  - Horizontal scaling of Chat Service (stateless)
  - Queue system: BullMQ with Redis for background jobs
  - Monitoring: Grafana + Prometheus or Render metrics
```

### Phase 4: Scale (500,000 → Millions)

```
Full infrastructure maturity:
  - Migrate from Render → AWS/GCP for finer control
  - Kubernetes for container orchestration
  - Separate read/write DB paths
  - Time-series DB for metrics (TimescaleDB)
  - Vector DB migration: Pinecone or Weaviate (if pgvector hits limits)
  - Global CDN + multi-region deployment
  - Message queue: Kafka for high-throughput events
  - LLM: Migrate from NVIDIA free → self-hosted or negotiated enterprise API
```

### Stateless Design for Horizontal Scaling

The Chat Service is designed stateless from day one:
- No session state in memory
- All state read from DB/cache
- Multiple instances can serve same user
- Redis handles rate limiting across instances

---

## 15. Cost Optimization Strategy

### LLM Token Cost is the Primary Cost Driver

**Token Budget Per Conversation Turn (Target: <2,000 tokens)**

```
System prompt (identity + role):    ~300 tokens
Retrieved memories (5 max):         ~500 tokens  
Conversation history (last 10):     ~800 tokens
User message:                       ~100 tokens
Buffer:                             ~300 tokens
─────────────────────────────────────────────
Total input:                       ~2,000 tokens
Expected output:                    ~300 tokens
─────────────────────────────────────────────
Total per turn:                    ~2,300 tokens
```

**Cost at scale (NVIDIA free → paid):**
- At 100K users × 10 turns/day = 1M turns/day
- At 2,300 tokens/turn = 2.3B tokens/day
- This is where model selection becomes critical

### Token Optimization Techniques

1. **Memory Compression**: Summarize old memories before injecting (500 tokens → 100 tokens)
2. **Tiered Models**: Use cheap models for reflection/summarization; premium only for live chat
3. **Response Caching**: Cache common non-personalized responses (greetings, FAQs)
4. **Conversation Pruning**: Only keep last 8-10 turns in working context; summarize older
5. **Lazy Memory Loading**: Retrieve memories only when relevant (don't always inject all 5)
6. **Template Notifications**: Most push notification messages use templates, not LLM generation

### Database Cost Optimization

- **Archive strategy**: Move cold data (>6 months unaccessed) to cheaper storage tier
- **pgvector index tuning**: `ivfflat` with correct `lists` parameter prevents full table scans
- **Message storage**: Store only first 500 chars of very old messages; full text for recent 90 days
- **Compression**: PostgreSQL TOAST automatically compresses large text columns

### Infrastructure Cost Map

| Component | Free Tier | $50/month | $500/month |
|---|---|---|---|
| Backend | Render Free | Render Starter | Render Standard |
| Database | Supabase Free | Supabase Pro | Supabase Team |
| Cache | In-memory | Upstash Redis Free | Upstash Redis Pro |
| LLM | NVIDIA Free | NVIDIA Pay-per-use | Negotiated API |
| Monitoring | None | Render built-in | Grafana Cloud |

---

## 16. Development Roadmap

### Milestone 1: Foundation (Weeks 1–4)
- [ ] Supabase project setup + schema creation
- [ ] Supabase Auth integration
- [ ] Basic Node.js API gateway
- [ ] NVIDIA LLM API integration
- [ ] Basic chat endpoint (no memory yet)
- [ ] React Native (Expo) project setup
- [ ] Basic chat UI

### Milestone 2: Memory Core (Weeks 5–8)
- [ ] pgvector setup + embedding integration
- [ ] Memory extraction pipeline (post-conversation)
- [ ] Memory retrieval + injection into LLM prompts
- [ ] Basic persona/identity system
- [ ] Conversation summarization

### Milestone 3: Personality & Relationship (Weeks 9–12)
- [ ] Identity Engine (persona state, trait scores)
- [ ] Relationship state tracking
- [ ] Goal tracking feature
- [ ] User preference learning
- [ ] Onboarding flow with memory seeding

### Milestone 4: Initiative & Notifications (Weeks 13–16)
- [ ] Expo Push Notifications setup
- [ ] Decision Engine (basic version)
- [ ] Notification dispatcher
- [ ] Initiation queue
- [ ] DND settings for users

### Milestone 5: Reflection Engine (Weeks 17–20)
- [ ] Nightly reflection job (cron)
- [ ] Pattern recognition pipeline
- [ ] Memory synthesis + compression
- [ ] AI reflection writing + storage
- [ ] Reflection-driven intent planning

### Milestone 6: Polish & Beta (Weeks 21–24)
- [ ] Curiosity Engine
- [ ] Knowledge graph
- [ ] AI Growth Engine (trait evolution)
- [ ] Crisis detection safety layer
- [ ] Beta user testing
- [ ] Performance profiling + optimization

---

## 17. Risks and Mitigation

| Risk | Severity | Probability | Mitigation |
|---|---|---|---|
| **LLM API rate limits (free tier)** | High | High | Implement request queuing; add fallback to template responses |
| **Memory quality degradation** | High | Medium | Regular memory audit jobs; importance scoring to filter noise |
| **AI initiates at wrong time** | Medium | Medium | Conservative DND windows; user feedback loop on notifications |
| **Prompt injection attacks** | High | Medium | Sanitize all user inputs; sandbox user content in prompts |
| **User over-attachment / dependency** | High | Medium | Built-in "healthy use" features; encourage real-world connections |
| **pgvector performance at scale** | Medium | Medium | Index tuning; migrate to dedicated vector DB if needed |
| **Cold starts on Render free tier** | Low | High | Accept initially; upgrade tier at 1K+ users |
| **Memory contradictions** | Medium | Medium | Contradiction detection in memory pipeline; flag for review |
| **NVIDIA API deprecation/changes** | Medium | Low | Abstract LLM provider behind interface; swap-ready |
| **GDPR / data deletion requests** | High | Low | Build deletion cascade into schema from day one |
| **AI hallucinates user's memories** | High | Medium | Never fabricate — only retrieve stored memories; add confidence threshold |

---

## 18. Recommended Folder Structure

### Backend (Node.js)

```
backend/
├── src/
│   ├── config/
│   │   ├── database.js          # Supabase client
│   │   ├── llm.js               # NVIDIA API client
│   │   ├── redis.js             # Cache client
│   │   └── env.js               # Environment validation
│   │
│   ├── services/
│   │   ├── chat/
│   │   │   ├── chatService.js   # Core chat logic
│   │   │   ├── promptBuilder.js # LLM prompt assembly
│   │   │   └── streamHandler.js # Streaming response
│   │   │
│   │   ├── memory/
│   │   │   ├── memoryService.js      # CRUD for memories
│   │   │   ├── memoryRetrieval.js    # Vector search
│   │   │   ├── memoryExtraction.js   # Post-conv processing
│   │   │   └── memoryCompression.js  # Archival + synthesis
│   │   │
│   │   ├── identity/
│   │   │   ├── identityService.js    # Persona state
│   │   │   └── traitEvolution.js     # Trait scoring
│   │   │
│   │   ├── relationship/
│   │   │   ├── relationshipService.js
│   │   │   └── roleClassifier.js
│   │   │
│   │   ├── reflection/
│   │   │   ├── reflectionEngine.js   # Nightly pipeline
│   │   │   ├── patternRecognizer.js
│   │   │   └── intentPlanner.js
│   │   │
│   │   ├── decision/
│   │   │   ├── decisionEngine.js     # Initiation logic
│   │   │   └── reasonScorer.js
│   │   │
│   │   ├── notification/
│   │   │   ├── notificationService.js
│   │   │   ├── dispatcher.js
│   │   │   └── expoClient.js
│   │   │
│   │   ├── knowledge/
│   │   │   ├── knowledgeEngine.js
│   │   │   └── topicExtractor.js
│   │   │
│   │   └── goals/
│   │       └── goalService.js
│   │
│   ├── api/
│   │   ├── routes/
│   │   │   ├── auth.routes.js
│   │   │   ├── chat.routes.js
│   │   │   ├── memory.routes.js
│   │   │   ├── goals.routes.js
│   │   │   ├── companion.routes.js
│   │   │   └── preferences.routes.js
│   │   │
│   │   ├── middleware/
│   │   │   ├── authMiddleware.js
│   │   │   ├── rateLimiter.js
│   │   │   ├── inputSanitizer.js
│   │   │   └── errorHandler.js
│   │   │
│   │   └── validators/
│   │       ├── chatValidator.js
│   │       └── goalValidator.js
│   │
│   ├── jobs/
│   │   ├── scheduler.js         # node-cron setup
│   │   ├── reflectionJob.js     # Nightly reflection
│   │   ├── decisionJob.js       # 4-hourly decision run
│   │   ├── memoryJob.js         # Post-conversation processing
│   │   └── knowledgeJob.js      # Weekly knowledge update
│   │
│   ├── utils/
│   │   ├── tokenCounter.js
│   │   ├── embeddingUtils.js
│   │   ├── dateUtils.js
│   │   └── logger.js
│   │
│   └── app.js                   # Express app entry
│
├── supabase/
│   └── migrations/              # SQL migration files
│
├── tests/
│   ├── unit/
│   └── integration/
│
├── .env.example
├── package.json
└── render.yaml                  # Render deployment config
```

### Frontend (React Native / Expo)

```
mobile/
├── app/
│   ├── (auth)/
│   │   ├── login.tsx
│   │   ├── register.tsx
│   │   └── onboarding.tsx
│   │
│   ├── (app)/
│   │   ├── chat/
│   │   │   ├── index.tsx        # Main chat screen
│   │   │   └── [id].tsx         # Specific conversation
│   │   ├── goals/
│   │   │   ├── index.tsx
│   │   │   └── [id].tsx
│   │   ├── memories/
│   │   │   └── index.tsx        # Browse AI's memories
│   │   └── settings/
│   │       └── index.tsx
│   │
│   └── _layout.tsx
│
├── components/
│   ├── chat/
│   │   ├── MessageBubble.tsx
│   │   ├── ChatInput.tsx
│   │   ├── TypingIndicator.tsx
│   │   └── ChatHeader.tsx
│   │
│   ├── companion/
│   │   ├── CompanionAvatar.tsx
│   │   └── RelationshipDepth.tsx
│   │
│   ├── goals/
│   │   ├── GoalCard.tsx
│   │   └── GoalProgress.tsx
│   │
│   └── shared/
│       ├── Button.tsx
│       ├── Input.tsx
│       └── LoadingSpinner.tsx
│
├── lib/
│   ├── api/
│   │   ├── client.ts            # Axios/fetch client
│   │   ├── chat.ts
│   │   ├── goals.ts
│   │   └── memories.ts
│   │
│   ├── store/
│   │   ├── authStore.ts         # Zustand auth state
│   │   ├── chatStore.ts
│   │   └── companionStore.ts
│   │
│   ├── hooks/
│   │   ├── useChat.ts
│   │   ├── useMemories.ts
│   │   └── useNotifications.ts
│   │
│   └── utils/
│       ├── dateFormat.ts
│       └── tokenHelpers.ts
│
├── constants/
│   ├── colors.ts
│   └── typography.ts
│
├── assets/
│
├── app.json
└── package.json
```

---

## 19. Recommended API Structure

### Base URL: `https://api.humanos.app/v1`

---

### Authentication

```
POST   /auth/register          Register new user
POST   /auth/login             Login, receive JWT
POST   /auth/refresh           Refresh access token
POST   /auth/logout            Invalidate session
DELETE /auth/account           Delete account + all data (GDPR)
```

---

### Companion

```
POST   /companion              Create companion (name, personality seed)
GET    /companion/:id          Get companion state
PATCH  /companion/:id          Update companion name/settings
GET    /companion/:id/identity Get current identity/personality state
GET    /companion/:id/relationship  Get relationship state
```

---

### Chat

```
POST   /chat/message           Send message, stream response
GET    /chat/conversations     List all conversations (paginated)
GET    /chat/conversations/:id Get conversation + messages
DELETE /chat/conversations/:id Delete conversation
```

---

### Memory

```
GET    /memory                 Get user's memories (paginated, filterable)
GET    /memory/:id             Get specific memory
PATCH  /memory/:id             Correct/update a memory (user can edit)
DELETE /memory/:id             Delete a specific memory
GET    /memory/search          Semantic search across memories
```

---

### Goals

```
POST   /goals                  Create goal
GET    /goals                  List all goals (filterable by status)
GET    /goals/:id              Get goal detail
PATCH  /goals/:id              Update goal status/notes
DELETE /goals/:id              Delete goal
POST   /goals/:id/progress     Add progress note
```

---

### Preferences

```
GET    /preferences            Get all user preferences
PUT    /preferences/:key       Set preference value
GET    /preferences/notifications  Get notification settings
PUT    /preferences/notifications  Update notification settings
```

---

### Reflections (Read-Only from Client)

```
GET    /reflections            Get AI reflections (paginated)
GET    /reflections/:date      Get reflection for specific date
```

---

### Admin / Internal (Not client-facing)

```
POST   /internal/reflection/trigger    Trigger reflection for user (dev)
POST   /internal/decision/run          Run decision engine for user (dev)
GET    /internal/health                Health check
```

---

## 20. Suggested Development Phases

### Phase 0: Proof of Concept (2 weeks)
**Goal**: Validate the core magic — does it feel different from a chatbot?

- Single endpoint: POST /chat/message
- NVIDIA LLM connected
- Hard-coded system prompt with identity
- No memory (yet)
- Basic React Native screen
- **Success metric**: First conversation feels warm and personal

---

### Phase 1: Memory Makes It Real (4 weeks)
**Goal**: Validate that memory retrieval creates the "wow" moment

- Memory storage (PostgreSQL + pgvector)
- Post-conversation extraction (simple version)
- Memory injection into prompts
- Basic onboarding to seed initial memories
- **Success metric**: AI references something from a previous conversation correctly

---

### Phase 2: The Relationship Feels Real (4 weeks)
**Goal**: Users start calling it "my companion" not "the AI"

- Relationship state tracking
- Identity engine (persona + trait scores)
- Goal tracking
- Conversation history UI
- **Success metric**: 50% of beta users return on day 7

---

### Phase 3: It Reaches Out (4 weeks)
**Goal**: The AI initiates conversations that users actually want

- Decision Engine
- Notification system (Expo Push)
- Basic DND settings
- Initiation templates + LLM-generated openings
- **Success metric**: >40% notification open rate

---

### Phase 4: It Thinks Overnight (4 weeks)
**Goal**: Users notice the AI is "getting smarter"

- Reflection Engine (nightly cron)
- Memory synthesis + compression
- Pattern recognition
- Intent planning from reflections
- **Success metric**: Users report "it really understands me" in qualitative feedback

---

### Phase 5: It Grows With You (4 weeks)
**Goal**: The AI evolves visibly over months

- AI Growth Engine (trait evolution)
- Curiosity Engine
- Knowledge graph per user
- Relationship milestone system
- **Success metric**: Users who've been using >3 months show higher retention than new users

---

### Phase 6: Production Hardening (4 weeks)
**Goal**: Safe, secure, scalable for 10K+ users

- Security audit
- Crisis detection + safety protocols
- Performance optimization
- Monitoring + alerting
- GDPR compliance (data export + deletion)
- Load testing
- **Success metric**: P99 response time < 3 seconds; zero security incidents

---

## 21. Self-Critique & Improvements

### What This Architecture Gets Right

✅ Memory-first design makes the product genuinely differentiated
✅ Asynchronous background processing keeps real-time chat snappy
✅ Token budget governance prevents cost blowup at scale
✅ Staged scaling path from free tier to millions of users
✅ Modular services allow independent replacement (e.g., swap NVIDIA → OpenAI easily)
✅ Security built in from day one (RLS, input sanitization, no client-side secrets)

---

### Weaknesses & Honest Critiques

#### 1. Memory Quality is Everything — and It's Hard
The entire product's value rests on memory quality. If the memory extraction LLM gets facts wrong (hallucination), the AI will "misremember" the user — which is worse than forgetting. **Improvement**: Build a memory confidence scoring system. Flag low-confidence extractions for lighter injection (or skip). Allow users to review and correct the AI's memories of them.

#### 2. The Reflection Engine is Expensive for Early Stage
Running an LLM nightly for every user is cost-prohibitive at scale. At 10K users, that's 10K LLM calls every night. **Improvement**: Implement tiered reflection — users who were inactive get a "shallow reflection" (template-based). Only active users get deep LLM reflection. Free tier users: weekly reflection only. Paid: nightly.

#### 3. The Decision Engine Risk: Too Many or Too Few Pings
Getting notification frequency wrong in either direction is fatal — too many and users feel harassed; too few and the "initiative" feature isn't felt. **Improvement**: Implement an A/B tested adaptive frequency model. Track open rates per user and calibrate thresholds individually. Start conservative (max 3/week) and increase only based on engagement data.

#### 4. No Offline Capability Planned
The mobile app is fully dependent on network. If the API is down, the user gets nothing. **Improvement**: Implement local SQLite cache with the last 20 messages. Allow offline reading of conversation history. Queue unsent messages for retry.

#### 5. pgvector May Not Scale to Millions of Users
pgvector with `ivfflat` is excellent up to ~1M vectors per table. At millions of users with hundreds of memories each, this could hit limits. **Improvement**: Shard the memories table by user_id prefix, OR plan explicit migration path to Pinecone/Weaviate at the 500K user milestone. This is documented but should be treated as a first-class concern, not an afterthought.

#### 6. Single Point of Failure: Background Job Runner
In Phase 1, all background jobs run in the same Node.js process as the API. A crash kills reflection, decision, and notification simultaneously. **Improvement**: From Phase 2, move background jobs to a separate Render background worker service. Use BullMQ with Redis for job queue resilience.

#### 7. Identity Evolution Could Feel Arbitrary
Trait scores changing by ±0.02/week based on vague inference could create unintended personality drift. The AI might become something the user doesn't recognize. **Improvement**: Make personality evolution transparent to the user ("I've noticed I've become more direct with you over time"). Allow users to "guide" personality intentionally. Add hard limits: traits cannot move more than ±0.2 from initial baseline.

#### 8. No Multi-Modal Support Planned
Text-only companions miss the richness of how people actually communicate — voice notes, images, documents. **Improvement**: Phase 7 should add voice input (Whisper API) and image sharing. The memory system should be extended to handle "I showed you a photo of X" memories.

#### 9. Crisis Detection is Under-Specified
Just flagging keywords is insufficient and can produce both false positives (irritating users) and false negatives (missing real crises). **Improvement**: This needs dedicated research. Consider partnering with mental health professionals to design the protocol. Crisis response should be tiered: acknowledgment → resources → escalation path. Never handle this with generic LLM output.

#### 10. The Business Model is Missing from the Architecture
A companion that becomes irreplaceable over time is a premium product. The architecture should plan for: free tier (limited message history, no proactive initiation), paid tier (full features), and potentially a "companion memory export" pricing lever for portability. **Improvement**: Add a `subscriptions` table and feature flags from day one. Don't retrofit monetization later.

---

### Recommended Priority Adjustments

If I were rebuilding this plan ranking today:

1. **Highest Priority**: Memory quality (extraction + retrieval accuracy) — this IS the product
2. **High Priority**: The "magic moment" in onboarding — memory reference in session 2
3. **High Priority**: Crisis safety layer — ship before any marketing
4. **Medium Priority**: Notification intelligence — start conservative
5. **Lower Priority (initially)**: Knowledge Engine, Curiosity Engine — Phase 3+ only

---

### Final Thought

> The architecture is sound for the vision. The biggest risk is not technical — it is product. The difference between an AI companion that users love and one they abandon after a week is a felt sense of genuine understanding. That cannot be architected — it must be crafted through meticulous prompt engineering, memory quality tuning, and obsessive attention to the first 10 conversations a user has with the AI. Build the memory system first. Get that right. Everything else is secondary.

---

*Document Version 1.0 | Human OS Architecture Blueprint*
*Ready for Engineering Team Review*
