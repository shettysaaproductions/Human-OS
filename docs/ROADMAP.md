# ROADMAP

# HumanOS North Star

HumanOS is not an app. HumanOS is a Personal AI Operating System. Nova is the first application powered by HumanOS.
The long-term mission is to create a digital brain that understands humans through conversations, voice, vision, actions, memories, documents, sensors, devices, emotions, routines, and context.

## Core Principles
1. User owns their memories.
2. HumanOS remembers context over years.
3. HumanOS synchronizes across devices.
4. HumanOS feels like a companion, not a chatbot.
5. HumanOS augments human intelligence.
6. The application is only a UI layer; HumanOS is the brain.

# 10 Year Vision

## Future Devices
HumanOS should eventually run on phones, tablets, smartwatches, AI glasses, speakers, robots, computers, and future hardware platforms.

## Long-Term Modules
- Memory Engine
- Voice Engine
- Vision Engine
- Context Engine
- Goals Engine
- Relationship Engine
- Device Sync Engine
- Agent System
- Notification System
- Knowledge System


## Phase 1: Internal Testing & Bug Fixes (Current)
- [x] Clear auth and logout flow.
- [x] WhatsApp-style reliable message queue (outboxQueue).
- [x] Pure JS offline retry strategy (replaces NetInfo).
- [x] Fix queue deadlock & stuck typing indicator.
- [x] Establish Canary OTA deployment branch for dependency updates.

## Phase 2: Chat Performance & Nova Feels Alive (Next Sprint — P1)
- [ ] **SSE Streaming Responses** — `/chat/stream` endpoint on Express; `< 500ms` time-to-first-token
- [ ] **"Nova is thinking..."** state → **"Nova is typing..."** state → streaming chunks render
- [ ] **Dynamic Status Messages** — rotate: "Recalling memories...", "Reading our history...", "Preparing reply..."
- [ ] **Chunk-by-chunk rendering** — messages appear progressively, never block UI
- [ ] **Fallback to `/chat`** — if SSE fails, silently fall back; never crash startup
- See: [CHAT_PERFORMANCE_PLAN.md](./CHAT_PERFORMANCE_PLAN.md)

## Phase 3: Memory Architecture V2 (Medium-Term)
- [ ] **Tiered Memory System** — Fast / Short-Term / Long-Term / Life Timeline
- [ ] **Cap history sent to LLM** — last 20 messages only (from 600+)
- [ ] **Session Summarization** — background job after each session; stored as Short-Term Memory
- [ ] **Semantic Memory Retrieval** — pgvector top-5 retrieval instead of full history
- [ ] **Background Memory Processing** — extraction, embedding, summarization never block chat
- See: [MEMORY_ARCHITECTURE_V2.md](./MEMORY_ARCHITECTURE_V2.md)

## Phase 4: Life Timeline & Daily Summaries (Long-Term)
- [ ] **Daily Summary Generation** — LLM-generated recap of each day's conversations
- [ ] **HumanOS Moments** — "One year ago today...", "Our 100th conversation..."
- [ ] **Timeline Tab UI** — scrollable day/week/month/year view
- [ ] **Milestone Detection** — celebrate 100 conversations, 1-year anniversaries, streaks
- [ ] **Push Notifications** — daily summary delivered via FCM/APNS
- See: [LIFE_TIMELINE_VISION.md](./LIFE_TIMELINE_VISION.md)

# Future Product Vision

## 1. Conversational States
- 🧠 Nova is thinking...
- ⌨️ Nova is typing...
- ✅ Nova replied

## 2. Dynamic Status Messages
Real-time micro-status updates while preparing a response:
- Recalling memories...
- Reading our history...
- Understanding your message...
- Preparing reply...

## 3. Memory Recall Moments
Occasional personalized prompts based on historic logs:
- "I remember you mentioned..."

## 4. Relationship Dashboard
A dashboard tab displaying companionship stats:
- Days together
- Total messages exchanged
- Memories created
- Conversation milestones reached

## 5. Nova Personalities
User-customizable companion personas:
- Friendly (Default)
- Professional
- Coach
- Creative
- Motivational

## 6. HumanOS Moments
Contextual nostalgic check-ins:
- One year ago today...
- Your first conversation...
- Goal progress reminders

## 7. Message Status Indicators
Detailed status indicators across client stages:
- **User messages:**
  - 🟡 Sending
  - 🟢 Sent
  - 🔴 Failed
- **AI messages:**
  - 🟣 Thinking
  - 🔵 Typing
  - 🟢 Complete

## 8. Background Messaging Roadmap
- Push notifications support via FCM/APNS.
- Background delivery and silent messaging retry loops when app is minimized or closed.

## 9. Performance Goals
- First token latency <1 second.
- Simple reply time <5 seconds.
- Complex memory-injected reply time <15 seconds.
