# Human OS — MVP Scope Document
### The Smallest Version That Can Create Real Emotional Attachment

> **Author**: Product Manager & Startup Founder Perspective
> **Constraint**: 1 solo developer, 6–8 weeks, free infrastructure
> **North Star**: Can this AI make someone feel genuinely understood after 3 conversations?

---

## The One Question That Defines This MVP

Before classifying a single feature, answer this:

> **"What is the minimum experience that makes a user tell someone else about this app?"**

Answer: **The moment the AI remembers something the user told it days ago and brings it up naturally.**

That is the product. Everything else is scaffolding. Every feature decision must be judged against this single moment.

---

## Feature Classification

### Legend
- 🔴 **Must Have** — V1 ships broken without it
- 🟡 **Should Have** — Meaningfully better with it; ship if time allows
- 🔵 **Nice to Have** — Good idea; no room for it now
- ⚫ **Future** — Real feature; wrong time

---

### 1. Chat Interface

**Classification**: 🔴 Must Have

**Why it exists**: It's the only way the user interacts with the AI in V1. Without this, there is no product.

**Why include in V1**: Non-negotiable. The entire product is a conversation interface.

**Development complexity**: Medium. Streaming responses add complexity but are essential — they make the AI feel alive. Without streaming, the interface feels like a loading screen, not a conversation.

**Business impact**: Maximum. This IS the product interface.

**V1 Scope**: Text only. Streaming response. Message history per session. No voice, no media.

---

### 2. Long-Term Memory (Core)

**Classification**: 🔴 Must Have

**Why it exists**: This is the entire differentiator. Without memory, this is just another ChatGPT wrapper. Memory is why users return.

**Why include in V1**: The "magic moment" — AI references something from a previous session — only exists because of memory. Skip this and you have no product thesis.

**Development complexity**: High. Requires pgvector setup, embedding generation, memory extraction post-conversation, retrieval on new conversation. This is the hardest single feature in V1 but cannot be deferred.

**Business impact**: Existential. Memory is the moat.

**V1 Scope**:
- Store memories after each conversation (extract 3–5 key facts using LLM)
- Embed memories using NVIDIA embedding model
- Retrieve top 3 relevant memories per conversation turn using cosine similarity
- Inject memories into system prompt
- Basic memory types only: fact + preference (skip episodic/relational classification)

**What to cut from full design**: Skip memory compression, archival, and contradiction detection. Store everything. Clean it up in V2.

---

### 3. Persistent Identity / Persona

**Classification**: 🔴 Must Have

**Why it exists**: A companion with no consistent personality feels like talking to a random stranger every time. Identity creates the sense of a real relationship.

**Why include in V1**: Users need to feel they're talking to *someone specific*, not a generic AI. The companion needs a name, a personality, and consistent behavior across sessions.

**Development complexity**: Low–Medium. In V1, this is mostly a well-crafted, hard-coded system prompt. No trait evolution system needed yet.

**Business impact**: High. Identity is what creates the "it's my companion" feeling vs. "it's an AI."

**V1 Scope**:
- User names the companion during onboarding
- System prompt encodes: name, core personality traits, relationship style, communication tone
- Personality is **fixed** in V1 (no evolution engine)
- Companion "knows" what was set in onboarding

---

### 4. Onboarding Interview

**Classification**: 🔴 Must Have

**Why it exists**: Cold-starting a relationship from zero context produces generic AI responses. The onboarding interview plants the first memories and creates the initial persona-to-user bond.

**Why include in V1**: Without it, the first 5 conversations feel hollow. The interview is the seed for the magic moment.

**Development complexity**: Low. It's a guided conversation flow with 8–10 questions. The answers are extracted and stored as initial memories.

**Business impact**: Very high. Onboarding quality directly determines Day 1 retention.

**V1 Scope**:
- 6–8 guided questions: name, what's on your mind lately, one goal, one fear, one thing you love, communication preference
- Each answer is stored as a memory directly (no LLM extraction needed for this step)
- Companion introduces itself, user names it, relationship begins

---

### 5. Conversation History (View Past Chats)

**Classification**: 🟡 Should Have

**Why it exists**: Users want to scroll back and re-read conversations. It builds emotional continuity and makes the relationship feel real and recorded.

**Why include in V1**: It's low complexity and high emotional value. A chat app with no history feels untrustworthy — "does it even remember we talked?"

**Development complexity**: Very Low. Messages are already stored in the DB. Just expose a list/detail view.

**Business impact**: Medium-High. Absence would feel like a bug, not a missing feature.

**V1 Scope**: List of past conversations + ability to open and read. No search. No delete (V2).

---

### 6. Goal Tracking

**Classification**: 🟡 Should Have

**Why it exists**: Goals create recurring engagement. If the AI knows a user's goal, it has a reason to follow up. Goals are the engine behind the most powerful notifications.

**Why include in V1**: Goals without notifications are just a list. If V1 has no proactive messaging (see below), goals become less critical. However, storing goals during onboarding costs nothing and the *user* can reference them in chat.

**Development complexity**: Low. Just a simple CRUD table.

**Business impact**: Medium in V1 (no notifications to act on them). High in V2.

**Decision**: Include as a simple feature inside chat (user can say "track my goal" and the AI saves it) — do NOT build a separate goals UI for V1.

---

### 7. Agentic Messaging / AI-Initiated Conversations

**Classification**: ⚫ Future

**Why it exists**: This is the feature that makes the AI feel like it's *thinking about you* between conversations. It's the highest-differentiation feature in the long-term vision.

**Why exclude from V1**: Implementing this requires: a decision engine, a cron job infrastructure, push notification setup, message generation logic, DND logic, and frequency tuning. That's 3–4 weeks of work for one developer. In a 6–8 week build, this cannot coexist with getting memory right.

**Development complexity**: Very High. Wrong implementation causes notification spam and immediate uninstalls.

**Business impact**: Transformative — in V2+. Premature in V1.

**Risk of including**: If done poorly (too frequent, irrelevant), it actively destroys retention. This is a "get it wrong and you lose users" feature.

**Decision**: Explicitly cut. Revisit at 100 active users with real usage data.

---

### 8. Notification Engine (Push Notifications)

**Classification**: ⚫ Future (paired with Agentic Messaging)

**Why exclude**: Push notifications without agentic messaging are just "come back to the app" prompts — identical to every other app. This adds no differentiation and takes significant setup time.

**V1 Alternative**: Standard app badge / no push. Users return because the experience is good, not because they were pinged.

---

### 9. Reflection Engine (Nightly Processing)

**Classification**: ⚫ Future

**Why it exists**: The nightly reflection synthesizes memories, identifies patterns, and plans future conversations. It's what makes the AI "grow."

**Why exclude from V1**: This requires: reliable cron infrastructure, LLM calls at 2AM per user timezone, memory synthesis logic, and intent planning. For 0–100 users it adds complexity with no visible user benefit yet. Users cannot tell if the AI reflected or not in V1.

**Development complexity**: Very High for disproportionately low V1 value.

**Decision**: Cut. The memory extraction pipeline after each conversation is the V1 substitute.

---

### 10. User Preference Engine

**Classification**: 🟡 Should Have (Minimal Version)

**Why it exists**: Knowing whether a user prefers brief or long responses, casual or formal tone, morning or evening conversations — makes every interaction feel better tuned.

**V1 Scope**: Capture 2 preferences during onboarding (communication style: brief/detailed; tone: casual/formal). Store as memories. Use in system prompt. No dynamic learning in V1.

**Development complexity**: Near zero — it's 2 radio buttons in onboarding.

---

### 11. Knowledge Engine / Curiosity Engine

**Classification**: ⚫ Future

**Why exclude**: These engines build a per-user knowledge graph and generate AI curiosity topics. Useful at 6+ months of user data. In V1, you have no data to build a graph from.

---

### 12. AI Growth Engine (Trait Evolution)

**Classification**: ⚫ Future

**Why exclude**: Trait evolution requires baseline data, scoring algorithms, and a feedback loop. In V1, the relationship is too young to have meaningful trait drift. Ship with a fixed personality.

---

### 13. Memory Review (User Browses AI's Memories)

**Classification**: 🔵 Nice to Have

**Why it exists**: It's emotionally powerful for a user to see "what the AI remembers about me." Creates trust and the feeling of being truly known.

**Why defer**: It's a read-only view of the memories table — low technical complexity. But polishing it for trust (users will scrutinize every memory) takes product time. Misremembered facts create distrust. Better to ship this in V2 when memory quality has been validated.

---

### 14. Authentication (Supabase Auth)

**Classification**: 🔴 Must Have

**Why**: Without auth, there are no user accounts, no persistent memories, no identity. The product cannot exist.

**V1 Scope**: Email + password only. Magic link optional. No social login in V1.

---

### 15. Multiple Companions / Profiles

**Classification**: ⚫ Future

**Why exclude**: V1 is one user, one companion. Adding multi-companion support doubles database complexity and UI complexity for near-zero V1 value.

---

### 16. Crisis Detection / Safety Layer

**Classification**: 🔴 Must Have

**Why**: This is non-negotiable before any public release. If a user expresses suicidal ideation or self-harm and the AI responds with a generic cheerful message, the legal, ethical, and reputational damage is catastrophic.

**V1 Scope**: Keyword matching (suicide, self-harm, crisis keywords) in message pre-processing. Trigger a hardcoded compassionate response + crisis hotline resources. Log the event separately. This must ship before the first public user.

**Development complexity**: Low (keyword list + override response). The hard version (nuanced LLM detection) is V2.

---

## Summary Classification Table

| Feature | Classification | V1 Complexity | Business Impact |
|---|---|---|---|
| Chat Interface | 🔴 Must Have | Medium | Existential |
| Long-Term Memory | 🔴 Must Have | High | Existential |
| Persistent Identity/Persona | 🔴 Must Have | Low | Very High |
| Onboarding Interview | 🔴 Must Have | Low | Very High |
| Authentication | 🔴 Must Have | Low | Existential |
| Crisis Safety Layer | 🔴 Must Have | Low | Existential |
| Conversation History | 🟡 Should Have | Very Low | Medium-High |
| Goal Tracking (in-chat) | 🟡 Should Have | Low | Medium |
| User Preferences (2 fields) | 🟡 Should Have | Near Zero | Medium |
| Memory Review UI | 🔵 Nice to Have | Low-Medium | Medium |
| Notification Engine | ⚫ Future | High | Low (V1) |
| Agentic Messaging | ⚫ Future | Very High | Low (V1) |
| Reflection Engine | ⚫ Future | Very High | Low (V1) |
| Knowledge Engine | ⚫ Future | High | None (V1) |
| Curiosity Engine | ⚫ Future | High | None (V1) |
| AI Growth Engine | ⚫ Future | High | None (V1) |
| Multiple Companions | ⚫ Future | High | None (V1) |
| Voice Interface | ⚫ Future | Very High | Low (V1) |

---

## 1. Final V1 Feature List

These are the **only** features that ship in V1:

### Core (Non-Negotiable)
1. **Email Authentication** — Register, login, session management
2. **Companion Creation** — User names their companion, companion exists persistently
3. **Onboarding Interview** — 6 guided questions, answers stored as seed memories
4. **Chat Interface** — Streaming text chat with message history
5. **Long-Term Memory** — Extract → Embed → Store → Retrieve → Inject into every conversation
6. **Persistent Identity** — Fixed persona via crafted system prompt, consistent across sessions
7. **Crisis Safety** — Keyword detection + hardcoded compassionate response + hotlines

### Supporting (Ship If Time Allows — High Value, Low Cost)
8. **Conversation History View** — List of past conversations, tap to read
9. **Goal Tracking (In-Chat)** — User says "track this goal," AI saves it, mentions it in future
10. **Communication Preference** — 2 onboarding fields: tone (casual/formal), length (brief/detailed)

### V1 Total: 10 features
### V1 Deferred: 8 features (explicitly not built)

---

## 2. User Flow Diagrams

### Flow 1: First-Time User (Onboarding)

```
App Launch
    │
    ▼
Welcome Screen
"Meet your AI companion."
[Get Started]
    │
    ▼
Registration Screen
[Email] [Password]
[Create Account]
    │
    ▼
"Let's introduce you."
    │
    ▼
ONBOARDING INTERVIEW (6 screens, one question each)

  Q1: "What's your name?"
  → Stored as: memory("User's name is {name}")

  Q2: "What's on your mind most these days?"
  → Stored as: memory("Currently thinking about: {answer}")

  Q3: "What's one goal you're working toward?"
  → Stored as: goal(title={answer}) + memory("Working on goal: {answer}")

  Q4: "Is there anything that's been stressing you out?"
  → Stored as: memory("Current stress: {answer}")

  Q5: "What do you love talking about?"
  → Stored as: memory("Loves discussing: {answer}")

  Q6: "How do you prefer to be spoken to?" 
  → [Casual & warm] or [Clear & direct]
  → Stored as: preference("tone") + memory("Prefers {choice} communication")
    │
    ▼
"Now, name your companion."
[Text input]
[Continue]
    │
    ▼
Companion Introduction Screen
"{Name}: Hi {user}. I'm glad you're here.
I already know a little about you — and I'm
looking forward to learning more."
    │
    ▼
→ MAIN CHAT SCREEN
```

---

### Flow 2: Returning User (Daily Use)

```
App Open
    │
    ▼
Auth Check → Valid session?
    │         NO → Login Screen
    YES
    │
    ▼
Chat Screen
(Shows last conversation or prompts new one)
    │
    ▼
User types message
    │
    ▼
[BACKEND PROCESSING — invisible to user]
  1. Embed user message
  2. Retrieve top 3 relevant memories (pgvector)
  3. Build LLM prompt:
     [System: identity + persona + memories]
     [History: last 8 messages]
     [User: current message]
  4. Stream response from NVIDIA API
    │
    ▼
Companion response streams in real-time
    │
    ▼
[BACKGROUND — after response complete]
  1. LLM extracts 1-3 new memories from exchange
  2. Embed + store new memories
  3. Update conversation record
    │
    ▼
User continues or closes app
```

---

### Flow 3: Memory Magic Moment

```
Session 1 (Day 1):
User: "I've been really worried about my job interview next Tuesday."
AI: "That makes sense. Interviews can feel like a lot. What's the role?"
[BACKGROUND: Memory stored → "User has a job interview on Tuesday"]

Session 2 (Day 3):
User: "Hey"
AI: "Hey! How did the interview go on Tuesday? I've been thinking about it."
User: [feels genuinely heard] ← THIS IS THE PRODUCT
```

---

### Flow 4: Goal Tracking (In-Chat)

```
User: "Can you help me track my goal to run 5km by end of month?"
    │
    ▼
AI: "Absolutely. I've got it — run 5km by end of [month].
     I'll check in with you on this from time to time.
     What's your current starting point?"
    │
    ▼
[BACKGROUND: 
  INSERT INTO goals (user_id, title, status)
  INSERT INTO memories (content="User's goal: run 5km by end of month")]
    │
    ▼
Future conversations: goal memory retrieved when relevant
AI: "How's the 5km goal going? You mentioned you were starting from zero."
```

---

### Flow 5: Crisis Detection

```
User message arrives
    │
    ▼
Pre-processing: scan for crisis keywords
[suicide, kill myself, want to die, self-harm, hurt myself, etc.]
    │
    ├── NO MATCH → Normal processing pipeline
    │
    └── MATCH FOUND
              │
              ▼
        Bypass LLM entirely
        Return hardcoded response:
        "I hear you, and I'm glad you told me.
         What you're feeling matters. You don't
         have to go through this alone.
         Please reach out to a crisis line:
         iCall: 9152987821 (India)
         Crisis Text Line: Text HOME to 741741 (US)
         Are you safe right now?"
              │
              ▼
        Log event to crisis_flags table (separate, high-sensitivity)
        Continue conversation with care
```

---

## 3. Exact Database Tables for V1

Only 7 tables. No more.

---

### `users`
```sql
CREATE TABLE users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email           TEXT UNIQUE NOT NULL,
  display_name    TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  last_active     TIMESTAMPTZ,
  timezone        TEXT DEFAULT 'UTC'
);
```

---

### `companions`
```sql
CREATE TABLE companions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID REFERENCES users(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  tone_preference TEXT DEFAULT 'casual',     -- 'casual' | 'direct'
  length_preference TEXT DEFAULT 'balanced'  -- 'brief' | 'balanced' | 'detailed'
);
```

---

### `conversations`
```sql
CREATE TABLE conversations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID REFERENCES users(id) ON DELETE CASCADE,
  companion_id    UUID REFERENCES companions(id),
  started_at      TIMESTAMPTZ DEFAULT NOW(),
  ended_at        TIMESTAMPTZ,
  message_count   INTEGER DEFAULT 0
);
```

---

### `messages`
```sql
CREATE TABLE messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
  user_id         UUID REFERENCES users(id),
  role            TEXT CHECK (role IN ('user', 'assistant')),
  content         TEXT NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast retrieval
CREATE INDEX messages_conversation_idx ON messages (conversation_id, created_at ASC);
```

---

### `memories`
```sql
-- Requires pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE memories (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID REFERENCES users(id) ON DELETE CASCADE,
  companion_id    UUID REFERENCES companions(id),
  content         TEXT NOT NULL,
  embedding       VECTOR(1024),          -- NVIDIA embedding dimension
  importance      FLOAT DEFAULT 0.5,
  source_conv_id  UUID REFERENCES conversations(id),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  last_accessed   TIMESTAMPTZ
);

-- Vector index for semantic search
CREATE INDEX memories_embedding_idx ON memories
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 50);

-- Fast user lookup
CREATE INDEX memories_user_idx ON memories (user_id, created_at DESC);
```

---

### `goals`
```sql
CREATE TABLE goals (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID REFERENCES users(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  status          TEXT DEFAULT 'active' CHECK (status IN ('active', 'achieved', 'abandoned')),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);
```

---

### `crisis_flags`
```sql
CREATE TABLE crisis_flags (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID REFERENCES users(id),
  triggered_at    TIMESTAMPTZ DEFAULT NOW(),
  trigger_content TEXT,          -- the message that triggered detection
  keywords_matched TEXT[]        -- which keywords were detected
);
```

---

**Total: 7 tables. That's it.**

Supabase RLS must be enabled on all tables:
- Users can only read/write their own rows
- `crisis_flags` is write-only from the app; no client reads

---

## 4. Exact APIs for V1

Base URL: `https://api.humanos.app/v1`

All endpoints require `Authorization: Bearer {jwt}` except `/auth/*`.

---

### Authentication (4 endpoints)

```
POST  /auth/register
      Body: { email, password, display_name }
      Response: { user, session }

POST  /auth/login
      Body: { email, password }
      Response: { user, session }

POST  /auth/refresh
      Body: { refresh_token }
      Response: { session }

POST  /auth/logout
      Response: { success: true }
```

---

### Companion (3 endpoints)

```
POST  /companion
      Body: { name, tone_preference, length_preference }
      Response: { companion }
      Note: One companion per user. Returns existing if already created.

GET   /companion
      Response: { companion }
      Note: Get current user's companion

PATCH /companion
      Body: { name?, tone_preference?, length_preference? }
      Response: { companion }
```

---

### Onboarding (1 endpoint)

```
POST  /onboarding/complete
      Body: {
        answers: [
          { question_key: "name", answer: "Arjun" },
          { question_key: "current_focus", answer: "..." },
          { question_key: "goal", answer: "..." },
          { question_key: "stress", answer: "..." },
          { question_key: "love", answer: "..." },
          { question_key: "tone", answer: "casual" }
        ]
      }
      Response: { memories_created: 6, companion: {...} }
      Note: Creates seed memories + updates companion preferences
```

---

### Chat (4 endpoints)

```
POST  /chat/message          ← MOST IMPORTANT ENDPOINT
      Body: { conversation_id?, content }
      Response: Streaming (Server-Sent Events)
      
      Server-side flow:
      1. Create conversation if none provided
      2. Save user message
      3. Retrieve top 3 memories (pgvector)
      4. Build prompt (identity + memories + history)
      5. Stream NVIDIA API response
      6. Save assistant message
      7. Queue background memory extraction job
      8. Update conversation.message_count

GET   /chat/conversations
      Query: ?page=1&limit=20
      Response: { conversations: [...], total, page }

GET   /chat/conversations/:id
      Response: { conversation, messages: [...] }

DELETE /chat/conversations/:id
      Response: { success: true }
      Note: Deletes conversation + messages. Does NOT delete memories extracted from it.
```

---

### Goals (4 endpoints)

```
POST  /goals
      Body: { title }
      Response: { goal }

GET   /goals
      Response: { goals: [...] }

PATCH /goals/:id
      Body: { status?, title? }
      Response: { goal }

DELETE /goals/:id
      Response: { success: true }
```

---

### Health (1 endpoint)

```
GET   /health
      Response: { status: "ok", timestamp, version }
      Note: No auth required. Used by Render health checks.
```

---

**Total V1 API surface: 17 endpoints**

That's the entire backend. No more.

---

## 5. Development Order

### Non-Negotiable Sequencing Rule:
**Build the memory pipeline before building the chat UI.** The chat UI without memory is a ChatGPT wrapper. The memory system IS the product.

---

### Phase A: Foundation (Before writing any product code)

```
1. Supabase project creation
2. Enable pgvector extension
3. Run all 7 table migrations
4. Enable Row-Level Security on all tables
5. Supabase Auth configuration (email/password)
6. NVIDIA API account + test embedding + test chat call
7. Node.js project scaffold (Express + Fastify)
8. Auth middleware (JWT validation from Supabase)
9. /health endpoint live on Render
10. Environment variables configured

→ Checkpoint: Can make authenticated API call to /health
```

---

### Phase B: The Core Loop (This is where V1 is won or lost)

```
11. POST /auth/register + /auth/login
12. POST /companion (create companion)
13. POST /onboarding/complete (store seed memories, no embeddings yet)
14. POST /chat/message — FIRST VERSION: no memory, just LLM response
    → Validate streaming works end-to-end
15. Add embedding generation for memories (NVIDIA embed API)
16. Add memory retrieval (pgvector cosine search)
17. Inject memories into LLM system prompt
18. POST /chat/message — FINAL VERSION: with memory retrieval + injection
19. Post-conversation memory extraction (background job after each response)
20. Store new memories from each conversation

→ Checkpoint: Have a 3-turn conversation, close app,
  reopen, reference something from the first session.
  If the AI remembers it: the product exists.
  If not: stop and fix this before moving forward.
```

---

### Phase C: Supporting Features

```
21. GET /chat/conversations (list)
22. GET /chat/conversations/:id (detail + messages)
23. POST /goals + GET /goals + PATCH /goals
24. Crisis keyword detection middleware
25. Crisis flag logging
26. Hardcoded crisis response bypass
```

---

### Phase D: Mobile App (Parallel or after Phase B)

```
27. Expo project setup (React Native)
28. Auth screens (register, login)
29. Onboarding interview screens (6 questions)
30. Companion naming screen
31. Main chat screen with streaming support
32. Conversation history list
33. Goal management screen (simple list)
34. Settings screen (companion name, tone)
```

---

### Phase E: Polish & Safety

```
35. Input validation on all endpoints
36. Rate limiting (express-rate-limit)
37. Error handling (meaningful error messages)
38. Loading states in mobile app
39. Empty states (no conversations yet)
40. Onboarding skip/back navigation
41. Basic app icon and splash screen
```

---

## 6. Weekly Milestones

### Week 1: Foundation & Backend Skeleton
**Goal**: Infrastructure is live; can make an authenticated API call.

- [ ] Supabase project + all 7 tables + pgvector extension
- [ ] Node.js project scaffolded on Render
- [ ] Auth middleware working
- [ ] NVIDIA API connected (embedding + chat)
- [ ] /health live on Render
- [ ] Local dev environment working

**Success gate**: Authenticated POST to a test endpoint returns data from Supabase.

---

### Week 2: The Memory Pipeline
**Goal**: Memory can be stored and retrieved. This is the most important week.

- [ ] Embedding generation working (NVIDIA embed API)
- [ ] Memory insert with vector storage
- [ ] Memory retrieval (pgvector cosine similarity, top-3)
- [ ] Basic /chat/message endpoint (LLM call, no memory yet)
- [ ] Streaming working end-to-end
- [ ] Memory injection into system prompt

**Success gate**: Have a 2-turn conversation. Close the session. Start a new one. The AI references something from the first. If this works, the product exists.

---

### Week 3: Onboarding + Full Chat Loop
**Goal**: A complete user journey from registration to first meaningful conversation.

- [ ] POST /auth/register + /auth/login
- [ ] POST /companion
- [ ] POST /onboarding/complete (6 questions → seed memories)
- [ ] Full chat loop: message → memory retrieval → LLM → stream → memory extraction
- [ ] POST /goals (in-chat goal tracking logic)
- [ ] Crisis detection middleware

**Success gate**: Register → complete onboarding → have 3 conversations → AI correctly references onboarding answers in conversation 3.

---

### Week 4: Mobile App — Core Screens
**Goal**: The app is usable on a phone.

- [ ] Expo project setup
- [ ] Auth screens (login + register)
- [ ] Onboarding interview flow (6 screens)
- [ ] Companion naming screen
- [ ] Main chat screen with real-time streaming
- [ ] Connect mobile → backend

**Success gate**: Complete the entire onboarding flow on a physical phone and have a real conversation.

---

### Week 5: Mobile App — Supporting Screens + Polish
**Goal**: The app feels complete, not beta.

- [ ] Conversation history screen
- [ ] Goals screen (simple list)
- [ ] Settings screen
- [ ] Loading states throughout
- [ ] Empty states (new user, no goals, etc.)
- [ ] Error handling (network failure, API errors)

**Success gate**: A non-technical person can use the app without guidance.

---

### Week 6: Safety, Testing, and Pre-Launch
**Goal**: The app is safe to put in front of real humans.

- [ ] Crisis detection fully tested (edge cases)
- [ ] Rate limiting on all endpoints
- [ ] Input sanitization (XSS, prompt injection prevention)
- [ ] Supabase RLS audit (verify users can't access other users' data)
- [ ] Manual QA of complete user journey
- [ ] Memory quality review (are extracted memories accurate?)
- [ ] Fix any memory retrieval failures
- [ ] App Store / TestFlight build OR public web beta

**Success gate**: Give app to 5 people outside your network. They complete onboarding and have 3+ conversations without needing help.

---

### Week 7–8 (Buffer): First Users + Rapid Iteration
**Goal**: Ship to first 50 users. Watch. Fix. Learn.

- [ ] Soft launch to waitlist / private beta
- [ ] Monitor memory extraction quality
- [ ] Monitor LLM response quality
- [ ] Daily: read every conversation (small scale, high signal)
- [ ] Fix top 3 complaints immediately
- [ ] Do not add new features — only fix what's broken

**Success gate**: 3 users voluntarily tell someone else about the app.

---

## 7. Biggest Technical Risks

### Risk 1: Memory Extraction Quality (CRITICAL)
**What can go wrong**: The LLM extracts wrong facts from conversations. The AI then "misremembers" the user with confidence. Example: User says "my friend Sarah is getting married" → AI later says "You're getting married, right?" This is worse than forgetting.

**Probability**: High
**Impact**: Catastrophic to trust

**Mitigation**:
- Use a conservative extraction prompt: "Only extract facts explicitly stated. If uncertain, do not extract."
- Limit to 3 memories per conversation (quality over quantity)
- Initially, review extracted memories manually for first 50 users
- In V1, err toward storing nothing rather than storing incorrect facts

---

### Risk 2: NVIDIA Free Tier Rate Limits
**What can go wrong**: NVIDIA's free tier has rate limits. Under load (even 50 active users), the app could hit rate limits mid-conversation, causing failed or delayed responses.

**Probability**: Medium-High
**Impact**: High (bad experience, churn)

**Mitigation**:
- Implement exponential backoff and retry logic on all NVIDIA API calls
- Queue concurrent requests; don't fire simultaneous LLM calls
- Add graceful error message: "I need a moment, let me gather my thoughts..."
- Monitor rate limit headers; alert when approaching limits

---

### Risk 3: pgvector Performance on Free Supabase
**What can go wrong**: Supabase free tier allows 500MB database. pgvector indexes are large. With 100 users × 50 memories each = 5,000 vectors. At 1,024 dimensions (float32), that's ~20MB just for vectors. Fine for V1, but embedding generation add-on costs start appearing if you upgrade.

**Probability**: Low for 100 users, Medium for 1,000+
**Impact**: Medium (upgrade costs, slight performance lag)

**Mitigation**:
- Monitor DB size daily after launch
- Cap memories per user at 100 in V1 (compression logic is V2)
- Free tier is sufficient up to ~200 users before needing to upgrade

---

### Risk 4: Context Window Token Overflow
**What can go wrong**: If a user writes very long messages + has many memories + long conversation history, the assembled prompt could exceed the model's context limit, causing API errors or truncation.

**Probability**: Medium
**Impact**: High (conversation breaks mid-session)

**Mitigation**:
- Hard limits in prompt builder: max 3 memories × 100 tokens each, max 8 conversation history turns
- If context budget exceeded: drop oldest history turns first, then drop lowest-importance memories
- Log and alert when context budget is within 20% of limit

---

### Risk 5: Streaming on Mobile (Expo)
**What can go wrong**: Server-Sent Events (SSE) for streaming can be finicky on React Native. Network interruptions, background app state, and iOS limitations can cause streaming to break silently.

**Probability**: Medium
**Impact**: Medium (bad UX if not handled)

**Mitigation**:
- Test streaming on both iOS and Android from week 4
- Implement heartbeat ping to detect broken connections
- Graceful fallback: if stream fails mid-response, complete response arrives as one chunk with error retry

---

## 8. Biggest Product Risks

### Risk 1: The Magic Moment Doesn't Land (EXISTENTIAL)
**What can go wrong**: The memory is retrieved but the AI references it awkwardly or at the wrong time. "By the way, you said your friend is getting married" at an unnatural moment kills the magic rather than creating it.

**Probability**: Medium
**Impact**: Existential — this is the only differentiating feature

**Mitigation**:
- Spend disproportionate prompt engineering time on the "memory weaving" instruction
- The AI should only surface memories when they're naturally relevant, not inject them artificially
- Test this with 20 scripted conversation scenarios before launch
- System prompt must include: "Only reference memories when they arise naturally in the conversation. Never force a memory into a response."

---

### Risk 2: Users Don't Return After Day 1
**What can go wrong**: Onboarding is beautiful. First conversation is warm. But without push notifications or the AI reaching out, there's nothing pulling users back day 2, 3, 4...

**Probability**: High
**Impact**: High (without retention, there's no product)

**Mitigation**:
- The V1 bet is that memory alone creates pull-back ("I want to see if it remembers")
- Frame the app as a "daily journal companion" — set user expectations that it rewards daily use
- In-chat prompt at end of session: "Come back and tell me how today goes."
- Email reminder at Day 3 of inactivity (Supabase edge functions can trigger this)
- This is the V1 risk to watch most closely. If Day-7 retention is below 20%, prioritize push notifications over all other V2 features.

---

### Risk 3: Users Feel It's "Just ChatGPT with Memory"
**What can go wrong**: If the persona isn't well-crafted, users feel they're talking to a generic AI that happens to remember facts. The differentiation feels thin.

**Probability**: Medium
**Impact**: High (no viral word-of-mouth, no emotional attachment)

**Mitigation**:
- Invest heavily in system prompt quality — this is where the product lives, not in code
- The companion should have specific opinions, express genuine curiosity, push back occasionally
- Ship 3 different persona archetypes and A/B test which creates strongest attachment
- Never let the AI say "As an AI language model..." — this breaks the companion illusion immediately

---

### Risk 4: Ethical Backlash — "You're making people emotionally dependent on AI"
**What can go wrong**: Press or social media criticizes the product for fostering unhealthy attachment. This is a real concern with an AI companion product.

**Probability**: Medium
**Impact**: Medium-High (reputational, potential app store removal)

**Mitigation**:
- Build "healthy use" nudges into the product from day one ("Have you talked to someone in person about this?")
- Publish a transparent ethics page before launch
- Do NOT market toward loneliness or depression — market toward growth and self-understanding
- Crisis detection is mandatory for this reason

---

### Risk 5: Solo Developer Burns Out at Week 5
**What can go wrong**: Memory pipeline is harder than expected. Week 4 arrives and chat isn't working correctly. Developer has to choose between shipping broken or cutting scope.

**Probability**: Medium (this is a complex product for one person)
**Impact**: Delayed launch / MVP that doesn't demonstrate the thesis

**Mitigation**:
- Week 2 is the critical gate. If memory retrieval isn't working by end of Week 2, de-scope the mobile app and ship a web interface first (much faster to build)
- Keep a clear "cut list" — if behind schedule, drop conversation history view and goals UI first (not the memory pipeline)
- Protect Week 2 ruthlessly — this is the only week that cannot slip

---

## 9. Features Explicitly Removed from V1

These are confirmed out. Document them so no scope creep happens.

| Feature Removed | Why Cut | When to Revisit |
|---|---|---|
| **Agentic/Proactive Messaging** | 3-4 weeks of work, high risk of spam UX | V2, after 100 active users prove retention |
| **Push Notifications** | Paired with agentic messaging; useless without it | V2 |
| **Reflection Engine (Nightly)** | LLM cost + cron infra for near-zero V1 visibility | V2 |
| **Knowledge Graph / Knowledge Engine** | Requires months of data to be useful | V3 |
| **Curiosity Engine** | No data to drive it; needs reflection engine first | V3 |
| **AI Growth Engine (trait evolution)** | No baseline data; premature in V1 | V3 |
| **Memory Review UI** | Memory quality unvalidated; user sees errors → distrust | V2, after memory QA |
| **Multiple Companions** | Doubles complexity; no evidence of demand | V2 |
| **Voice Interface** | Significant infra + Expo complexity | V3 |
| **Social Login (Google/Apple)** | Auth complexity; email works fine for early adopters | V2 |
| **Web Search / Live Info** | Scope creep; different product | Future |
| **Calendar Integration** | Scope creep; different product | Future |
| **Data Export (GDPR)** | Needed before 500 users (EU) | V2 pre-EU-launch |
| **Conversation Search** | Nice UX but not blocking | V2 |
| **Memory Delete / Edit by User** | High trust feature; needed but not blocking V1 | V2 |
| **Mood Detection** | Requires ML model or expensive LLM inference | V3 |

---

## 10. Definition of Success for the First 100 Users

### The Hard Metrics (Quantitative)

| Metric | Target | Threshold to Pivot |
|---|---|---|
| Day-1 Retention | > 70% | < 50% = onboarding is broken |
| Day-7 Retention | > 30% | < 15% = the magic moment isn't landing |
| Day-30 Retention | > 15% | < 8% = product thesis is wrong |
| Avg Sessions / Week (active users) | > 4 | < 2 = no habit formed |
| Avg Messages / Session | > 6 | < 3 = conversations aren't engaging |
| Memory Retrieval Accuracy | > 80% | < 60% = fix memory pipeline before anything else |
| Session Length | > 5 minutes | < 2 minutes = AI responses aren't compelling |

---

### The Soft Signals (Qualitative)

These are more important than the hard metrics at 100 users:

**Signals that the product is working:**
- [ ] At least 3 users proactively share the app with someone else
- [ ] At least 10 users report feeling "understood" by the AI in feedback
- [ ] At least 5 users reference a specific memory the AI surfaced correctly
- [ ] At least 1 user says something like "I look forward to talking to it"
- [ ] Zero users report the AI "forgetting" something major after being explicitly told

**Signals the product is NOT working:**
- ☠️ Multiple users report the AI "said something wrong about me"
- ☠️ Users describe it as "basically ChatGPT but with memory"
- ☠️ Drop-off happens between onboarding and first real conversation
- ☠️ Users say conversations feel "hollow" or "robotic"
- ☠️ Any crisis detection failure (hardest line — non-negotiable)

---

### The 3 Questions to Ask Every User at 2 Weeks

1. "Does the AI feel like it knows you? On a scale of 1–10."
2. "Is there a moment where it surprised you by remembering something?"
3. "Is there anything the AI got wrong about you that bothered you?"

**Minimum viable signal to continue building**: Average score of ≥7 on Q1 AND at least 40% yes on Q2.

---

## Brutally Honest Founder Opinion

### Would I Build This Company?

**Yes. But with my eyes open about exactly what kind of bet this is.**

---

### Why Yes:

**1. The memory insight is genuine and defensible.**
Every AI chatbot available today is stateless. The entire market has optimized for the wrong thing — smarter responses, not deeper relationships. Memory-first design is a real insight, not a feature checkbox. The first time a user experiences the magic moment ("it remembered"), the reaction is visceral. That reaction is the foundation of a real business.

**2. The timing is right.**
The hardware and infrastructure to build this product (cheap LLM APIs, pgvector in Postgres, Expo for cross-platform) didn't exist at this cost level two years ago. The window to build the *first* emotionally resonant AI companion at consumer scale is open right now. It won't be open forever.

**3. The moat compounds.**
Every conversation makes the product better for that user. After 6 months of daily use, switching has real emotional cost — the user would lose a relationship. That's a powerful retention mechanic that most apps can never build.

**4. The market is enormous.**
Loneliness is a global epidemic. Mental health support is inaccessible to billions. Coaching and mentorship are priced out of reach for most people. Human OS doesn't need to solve all of these — it just needs to be *useful enough* for a meaningful slice of them.

---

### Why This Will Be Hard:

**1. The product's success depends on things that can't be fully engineered.**
Memory retrieval accuracy, persona quality, natural conversation flow — these are craft problems, not engineering problems. They require hundreds of hours of prompt tuning, conversation review, and emotional sensitivity. A technically excellent engineer who doesn't *feel* the product will ship something that works but doesn't resonate.

**2. The competition will be brutal and fast.**
Character.AI, Replika, Pi.ai, Claude, and every OpenAI wrapper are moving toward long-term memory. Google and Apple have native AI companions being developed with OS-level access to user data. A solo developer has maybe 12–18 months before this category becomes crowded with well-funded players.

**3. The ethical questions are real and unresolved.**
At scale, you are building something that people form emotional bonds with. Some of those people will be vulnerable. The moment a user with depression or suicidal ideation relies on an AI companion and the AI fails them — that is a company-defining crisis. You must take ethics as seriously as engineering from day one, not as an afterthought.

**4. Retention without proactive messaging is a hill to climb.**
The most powerful feature — AI reaching out proactively — is cut from V1 for good reasons. But without it, you're betting that memory alone pulls users back. This may be true for early adopters (power users who are curious and self-motivated). It is probably not true for mainstream users. V2 must ship proactive messaging, and it must ship it correctly.

---

### The Real Bet:

This product is not primarily a technology bet. **It is a bet that emotional connection is a sustainable business.**

You are betting that:
- People will pay for a relationship, not just a tool
- The relationship compounds in value faster than competitors can copy the memory feature
- You can navigate the ethics of emotional AI without causing harm
- A solo developer can reach product-market fit before the market becomes crowded

**My honest answer**: I would build it — but I would build V1 with ruthless scope discipline (exactly as defined in this document), spend Week 2 obsessively on memory quality, and define a single hard metric to watch at 100 users: **Day-30 retention**.

If Day-30 retention is above 15% at 100 users, **raise money immediately and scale the product**. The insight is real and the market is moving.

If Day-30 retention is below 10% at 100 users, **do not add features**. Sit with 20 users who dropped off and understand *why*. The answer will be in the quality of the emotional experience, not in the feature list.

**The product lives or dies on whether strangers, after 30 days, feel that the AI genuinely knows them.** Everything else is secondary.

---

**Build it. Ship it in 8 weeks. Watch Day-30 retention above everything else.**

---

*Document Version 1.0 | Human OS MVP Scope*
*For solo developer, free infrastructure, 6–8 week build*
