# HumanOS — Product Requirements Document (PRD)
## Version 1.0 — Complete Specification

> **Role**: Senior Product Manager
> **Version**: 1.0
> **Date**: June 2026
> **Status**: Pre-Engineering — Engineering-Ready Specification
> **Audience**: Solo Developer
> **Timeline**: 6–8 Weeks
> **Constraint**: Free infrastructure, maximum emotional impact, minimum complexity

---

## Document Purpose

This PRD removes all ambiguity before the first line of engineering code is written. Every user interaction is described from the user's perspective, the system's perspective, the database's perspective, and the error perspective. Engineering should never have to guess what the product should do.

---

## Table of Contents

1. [Product Overview](#1-product-overview)
2. [Core Principles](#2-core-principles)
3. [Authentication Flows](#3-authentication-flows)
4. [Onboarding Flows](#4-onboarding-flows)
5. [Chat Flows](#5-chat-flows)
6. [Memory System Flows](#6-memory-system-flows)
7. [Goals Flows](#7-goals-flows)
8. [Conversation History Flows](#8-conversation-history-flows)
9. [Crisis Detection Flows](#9-crisis-detection-flows)
10. [Screen Inventory](#10-screen-inventory)
11. [Navigation Architecture](#11-navigation-architecture)
12. [Loading States](#12-loading-states)
13. [Empty States](#13-empty-states)
14. [Error States](#14-error-states)
15. [Permissions Required](#15-permissions-required)
16. [Analytics Events](#16-analytics-events)
17. [Logging Requirements](#17-logging-requirements)
18. [Definition of Done](#18-definition-of-done)
19. [V1 User Journey](#19-v1-user-journey)
20. [V1 Technical Checklist](#20-v1-technical-checklist)
21. [V1 Launch Checklist](#21-v1-launch-checklist)

---

## 1. Product Overview

### What Is HumanOS?

HumanOS is a mobile AI companion application. Unlike traditional chatbots, HumanOS remembers the user across every conversation and maintains a persistent, evolving relationship. The AI companion has a name chosen by the user, a consistent personality, and genuine memory of every significant thing the user has shared.

### The Single Defining Experience

> **The Magic Moment**: The AI remembers something the user told it days ago and brings it up naturally.

Every product decision must be evaluated against whether it enables, supports, or protects this moment.

### V1 Feature Set (Non-Negotiable Scope)

| # | Feature | Priority |
|---|---|---|
| 1 | Email Authentication (Register, Login, Logout) | Must Have |
| 2 | Companion Creation (User names their companion) | Must Have |
| 3 | Onboarding Interview (6 questions → seed memories) | Must Have |
| 4 | Chat Interface (Streaming text) | Must Have |
| 5 | Long-Term Memory (Extract, Store, Retrieve, Inject) | Must Have |
| 6 | Persistent Companion Identity (Fixed persona) | Must Have |
| 7 | Crisis Detection (Keyword match + hardcoded response) | Must Have |
| 8 | Conversation History (List + read past chats) | Should Have |
| 9 | Goal Tracking (In-chat, no separate UI) | Should Have |
| 10 | Communication Preferences (Tone + length) | Should Have |

### What V1 Does NOT Include

These are explicitly removed. Any request to add these during development is scope creep:

- Push notifications
- AI-initiated conversations
- Nightly reflection engine
- Memory review UI (user browsing their memories)
- Multiple companions
- Voice interface
- Social login
- Memory editing or deletion by user
- Mood detection
- Knowledge graph or curiosity engine

---

## 2. Core Principles

These principles govern every product decision in this document:

1. **Memory is the product.** Every feature is in service of making the AI remember and use what it knows about the user naturally.

2. **Never break the companion illusion.** The AI should never say "As an AI language model." It has a name. It has feelings about the user. It expresses genuine curiosity.

3. **Safety is non-negotiable.** Crisis detection ships before the first public user, full stop.

4. **Fail gracefully, never silently.** Every error state must be handled with a message that maintains the emotional tone of the product.

5. **Simplicity over completeness.** If a feature creates ambiguity or complexity that risks delaying the memory pipeline, it is deferred.

---

## 3. Authentication Flows

### 3.1 Registration

#### User Action
The user opens the app for the first time. They see a Welcome Screen. They tap "Create Account." They enter their email address, a password (minimum 8 characters), and their display name. They tap "Create Account."

#### System Action
1. The app validates the form locally (email format, password length, name not empty) before making any network call.
2. The app sends a POST request to `/auth/register` with `{ email, password, display_name }`.
3. The backend passes credentials to Supabase Auth.
4. Supabase creates the auth record and returns a user object and session token (JWT + refresh token).
5. The backend creates a row in the `users` table with the returned user ID, email, display name, and `created_at` timestamp.
6. The backend returns `{ user, session }` to the app.
7. The app stores the JWT and refresh token securely in the device keychain (not AsyncStorage).
8. The app navigates to the Onboarding screen.

#### Backend Processing
- Supabase Auth handles password hashing (bcrypt) — the developer never handles raw passwords.
- A Supabase Row-Level Security (RLS) policy is automatically applied: users can only access their own rows.
- The `users` table insert happens server-side in the same request handler; if this fails, the registration is considered failed even if Supabase Auth succeeded.

#### Database Changes
- New row created in `users`: `{ id, email, display_name, created_at, last_active: NOW() }`
- No companion or memories yet at this point.

#### Expected User Experience
- The user sees a loading spinner on the "Create Account" button after tapping.
- The transition to onboarding takes no more than 2 seconds.
- The user lands on the first onboarding screen with their display name already known to the system.

#### Error Cases

| Error | Cause | User-Facing Message |
|---|---|---|
| Email already in use | Duplicate email in Supabase Auth | "An account with this email already exists. Try logging in instead." |
| Invalid email format | Client-side validation | "Please enter a valid email address." |
| Password too short | Client-side validation | "Password must be at least 8 characters." |
| Name is empty | Client-side validation | "Please tell us your name." |
| Network timeout | No internet connection | "Can't connect right now. Check your internet and try again." |
| Server error (5xx) | Backend or Supabase failure | "Something went wrong on our end. Please try again in a moment." |

#### Edge Cases
- User closes app mid-registration: No partial state is saved. On next open, user sees the Welcome Screen again.
- User has extremely long name (>100 characters): Truncate to 100 characters with client-side validation note.
- User registers with same email but different casing (e.g., User@email.com vs user@email.com): Supabase treats these as the same. Show "account already exists" error.

#### Sequence Diagram

```
User           App             Backend          Supabase Auth      DB
 │              │                │                    │             │
 │──tap Create──►│                │                    │             │
 │              │──validate──────►│                    │             │
 │              │ (local)         │                    │             │
 │              │──POST /auth/register──────────────────────────────►│
 │              │                │──createUser(email,pw)────────────►│
 │              │                │◄─────────────{ user, session }───│
 │              │                │──INSERT users (id, email, name)──►│
 │              │                │◄──────────────────────{ user }───│
 │              │◄────────────{ user, session }──│                   │
 │◄──navigate to onboarding──────│                │                   │
```

#### Success Criteria
- User successfully registered and lands on onboarding screen within 3 seconds.
- `users` table row exists with correct data.
- JWT stored securely on device.
- No plain-text password ever touches the application logs.

#### Acceptance Criteria
- [ ] Register with valid email + password + name → navigate to onboarding
- [ ] Register with existing email → show correct error message
- [ ] Register with invalid email format → block submission, show inline error
- [ ] Register with password < 8 chars → block submission, show inline error
- [ ] Register with no name → block submission, show inline error
- [ ] Network error during registration → show retry-friendly error message
- [ ] JWT and refresh token stored in device keychain (not AsyncStorage)
- [ ] `users` table row created with correct data

---

### 3.2 Login

#### User Action
The user opens the app when they already have an account. They are redirected to the Login Screen. They enter their email and password. They tap "Sign In."

#### System Action
1. The app validates form locally (email format not empty, password not empty).
2. The app sends a POST request to `/auth/login` with `{ email, password }`.
3. The backend authenticates via Supabase Auth.
4. On success, Supabase returns `{ user, session }` with JWT and refresh token.
5. The backend updates `users.last_active` to NOW().
6. The backend returns `{ user, session }` to the app.
7. The app stores JWT and refresh token securely.
8. The app checks if `users.onboarding_complete` is true:
   - If `true`: Navigate to Chat Screen (main app).
   - If `false`: Navigate to Onboarding (user did not complete onboarding previously).

#### Backend Processing
- JWT expiry is set to 1 hour. Refresh token expiry is 30 days.
- `last_active` update is a best-effort operation; if it fails, login still succeeds.

#### Database Changes
- `users.last_active` updated to NOW().

#### Expected User Experience
- The Sign In button shows a loading state during the network call.
- The user is redirected within 2 seconds on a normal connection.
- If onboarding was incomplete, the user continues from where they left off (onboarding is not repeatable — if partially complete, it starts from question 1 again).

#### Error Cases

| Error | Cause | User-Facing Message |
|---|---|---|
| Wrong password | Auth failure | "Incorrect email or password." (Do not specify which is wrong — security best practice) |
| Email not found | No account | "Incorrect email or password." |
| Account locked | Too many attempts | "Too many attempts. Please wait 15 minutes and try again." |
| Network timeout | No internet | "Can't connect right now. Check your internet and try again." |
| Server error | Backend failure | "Something went wrong. Please try again." |

#### Edge Cases
- User is already logged in and opens the app: Skip login screen entirely, go directly to Chat Screen.
- User has a valid but expired JWT with a valid refresh token: Silently refresh before proceeding (see Session Expiration).
- User has both expired JWT and expired refresh token: Redirect to Login Screen.

#### Success Criteria
- User can log in with valid credentials and reach the Chat Screen within 3 seconds.
- Incorrect credentials produce a helpful but non-specific error message.
- `last_active` timestamp is updated in the database.

#### Acceptance Criteria
- [ ] Valid credentials → navigate to Chat Screen (if onboarding complete)
- [ ] Valid credentials + incomplete onboarding → navigate to Onboarding Screen
- [ ] Wrong password → show "Incorrect email or password" message
- [ ] Email not found → show "Incorrect email or password" message (same message — security)
- [ ] Network error → show retry message
- [ ] Already logged in (valid session) → skip login screen

---

### 3.3 Logout

#### User Action
The user navigates to Settings and taps "Sign Out." A confirmation dialog appears: "Sign out of HumanOS? Your companion and memories will be waiting when you return." Two buttons: "Sign Out" and "Cancel."

The user taps "Sign Out."

#### System Action
1. The app calls POST `/auth/logout` with the current JWT in the Authorization header.
2. The backend calls Supabase Auth to invalidate the session.
3. The backend returns `{ success: true }`.
4. The app clears the JWT and refresh token from the device keychain.
5. The app clears any cached data from memory.
6. The app navigates to the Welcome Screen.

#### Backend Processing
- Session invalidation is done at the Supabase Auth level; the JWT is blacklisted.
- If the backend call fails (network error), the app should still clear local tokens and navigate to Welcome Screen. The session may still be technically valid on the server, but the user is effectively logged out on this device.

#### Database Changes
- No database changes. Sessions are handled by Supabase Auth, not the `users` table.

#### Expected User Experience
- The app responds to the Sign Out confirmation immediately.
- The transition to the Welcome Screen is instant (no loading state needed — this is a local operation primarily).
- The user feels reassured that their companion and memories are safe.

#### Error Cases

| Error | Cause | Behavior |
|---|---|---|
| Network error during logout | No internet | Clear local tokens anyway. Show "Signed out from this device" toast. User is effectively logged out locally. |
| Server error during logout | Backend failure | Same as above — always prioritize local logout. |

#### Edge Cases
- User taps Sign Out rapidly twice: Ignore the second tap (debounce the button).
- User signs out while a chat message is being processed: Cancel the in-flight request, then proceed with logout.

#### Success Criteria
- User is redirected to Welcome Screen after logout.
- JWT and refresh token are removed from device storage.
- User cannot access any protected screen after logout without signing in again.

#### Acceptance Criteria
- [ ] Tapping Sign Out shows confirmation dialog
- [ ] Confirming Sign Out clears tokens and navigates to Welcome Screen
- [ ] Canceling Sign Out does nothing
- [ ] After logout, pressing back does not return to the chat screen
- [ ] Network error during logout still clears local tokens and navigates to Welcome Screen

---

### 3.4 Session Expiration

#### Scenario
The user's JWT has expired (1-hour TTL). The user opens the app or makes any API call.

#### System Action
1. The app makes a protected API call.
2. The backend returns a 401 Unauthorized response.
3. The app's API client detects the 401 response.
4. The app checks if a valid refresh token exists in the keychain.
5. If refresh token is valid: The app automatically calls POST `/auth/refresh` with the refresh token.
6. Supabase returns a new JWT and updated refresh token.
7. The app stores the new tokens and retries the original API call transparently.
8. If refresh token is also expired: The app clears all tokens and navigates to the Login Screen with the message: "Your session has expired. Please sign in again."

#### Expected User Experience
- **Happy path**: The user experiences nothing. The token refresh is invisible. Their chat continues uninterrupted.
- **Expired session**: The user sees a brief message and the Login Screen. Their data is not lost.

#### Error Cases

| Error | Cause | Behavior |
|---|---|---|
| Refresh token invalid | Token corrupted or tampered | Clear tokens, navigate to Login |
| Refresh token expired (30 days) | User hasn't opened app in 30+ days | Clear tokens, navigate to Login |
| Network error during refresh | No internet | Show: "Can't connect. Please check your internet connection." Do not log out yet — retry when connectivity returns. |

#### Acceptance Criteria
- [ ] Expired JWT with valid refresh token → silent token refresh → continue
- [ ] Both tokens expired → navigate to Login Screen with expiration message
- [ ] Token refresh failure due to network → retain tokens, show connectivity error
- [ ] After re-login, user is returned to the screen they were on

---

## 4. Onboarding Flows

### 4.1 First App Launch

#### Context
This is the user's first time in the app, immediately after successful registration. They have an account but no companion and no memories.

#### User Action
The user lands on the first Onboarding Screen after registration.

#### System Action
1. The backend checks if a companion exists for this user. It does not.
2. The backend checks if `users.onboarding_complete` is false. It is.
3. The app presents the onboarding flow.

#### Expected User Experience
The user sees a warm, visually appealing screen with the headline: "Let's introduce you to your companion." Subtext: "Answer 6 short questions so they can truly know you from the start." A progress indicator shows "1 of 6."

The tone is warm, not clinical. This is not a form — it is the beginning of a relationship.

#### Acceptance Criteria
- [ ] New user after registration always sees onboarding
- [ ] Returning user who completed onboarding never sees it again
- [ ] Returning user who did NOT complete onboarding sees it from question 1

---

### 4.2 The 6 Onboarding Questions

The onboarding interview consists of exactly 6 questions presented one per screen. Each question has a text input field. The user can tap "Continue" to advance or "Back" to return. The user cannot skip a question — each requires a non-empty answer before continuing.

A progress indicator (e.g., "2 of 6" with a progress bar) is visible throughout.

---

#### Question 1: User's Name

**Screen Label**: "What's your name?"
**Subtext**: "Not your email — what do people actually call you?"
**Input Type**: Single line text field
**Placeholder**: "Your name..."
**Validation**: Not empty. Maximum 50 characters.

**Memory Created**:
```
content: "The user's name is {answer}."
importance: 0.9  (very high — foundational fact)
```

---

#### Question 2: Current Focus

**Screen Label**: "What's been on your mind most lately?"
**Subtext**: "What are you thinking about, working through, or excited about right now?"
**Input Type**: Multi-line text field
**Placeholder**: "Tell me what's been occupying your thoughts..."
**Validation**: Not empty. No maximum (but UI truncates preview at 300 chars).

**Memory Created**:
```
content: "Currently, the user is thinking about or dealing with: {answer}."
importance: 0.8
```

---

#### Question 3: A Goal

**Screen Label**: "What's one goal you're working toward?"
**Subtext**: "It doesn't have to be grand. Just something real that matters to you."
**Input Type**: Multi-line text field
**Placeholder**: "A goal I'm working on..."
**Validation**: Not empty.

**Memory Created**:
```
content: "The user's current goal is: {answer}."
importance: 0.8
```

**Goal Record Created**:
```
title: {answer}
status: 'active'
user_id: {current_user_id}
```

---

#### Question 4: Current Stress

**Screen Label**: "Is there anything that's been stressing or worrying you?"
**Subtext**: "This is just between us. You don't have to share if you'd rather not."
**Input Type**: Multi-line text field
**Placeholder**: "Something on my mind..."
**Skip Option**: Yes. A small text link: "Skip this one" — the only skippable question.

**Memory Created (if answered)**:
```
content: "The user has mentioned feeling stressed or worried about: {answer}."
importance: 0.7
```

**If skipped**: No memory is created. Question is noted as skipped in the companion record for future sensitivity.

---

#### Question 5: Interests

**Screen Label**: "What do you love talking about?"
**Subtext**: "Topics that light you up. Your passions, obsessions, whatever you can talk about for hours."
**Input Type**: Multi-line text field
**Placeholder**: "Things I love talking about..."
**Validation**: Not empty.

**Memory Created**:
```
content: "The user loves to talk about and is passionate about: {answer}."
importance: 0.8
```

---

#### Question 6: Communication Preference

**Screen Label**: "How do you like to be spoken to?"
**Subtext**: "There's no wrong answer — this helps your companion feel right from day one."
**Input Type**: Two option buttons (not a text field)

**Option A**: "Casual & warm — like a close friend"
**Option B**: "Clear & direct — thoughtful but to the point"

**Validation**: One option must be selected. Default is none selected; "Continue" is disabled until one is selected.

**Memory Created**:
```
content: "The user prefers {casual/direct} communication. [Selected: {option}]"
importance: 0.7
```

**Companion Record Updated**:
```
tone_preference: 'casual' | 'direct'
```

---

### 4.3 Companion Naming

#### Context
This screen appears immediately after the 6 questions are answered. It is a separate screen with a distinct emotional tone — this is the moment the relationship begins.

#### User Action
The user sees the screen: "Now, give your companion a name." Subtext: "This is who they'll be — forever." A text input is shown with placeholder "A name for your companion..." The user types a name and taps "Meet {name}."

#### System Action
1. The app validates the name: not empty, max 30 characters.
2. The app calls POST `/onboarding/complete` with:
   - All 6 question answers
   - The companion name
   - The selected tone preference
3. The backend processes the request:
   - Creates 5–6 memory records (one per answered question) with pre-computed text content.
   - Creates one goal record (from Question 3).
   - Creates the companion record: `{ name, tone_preference, user_id }`.
   - Sets `users.onboarding_complete = true`.
4. The backend returns `{ memories_created, companion }`.
5. The app navigates to the Companion Introduction Screen.

#### Backend Processing
- All memories are created in a single database transaction. If any insert fails, all are rolled back and the onboarding is retried.
- Memories at this stage are stored WITHOUT embeddings initially. A background job embeds them within 60 seconds. The companion can still be used immediately — the first conversation may have limited memory retrieval if embedding hasn't completed, but this is acceptable.
- The companion name is sanitized: trimmed of whitespace, no HTML/special characters.

#### Database Changes
- New row in `companions`: `{ id, user_id, name, tone_preference, created_at }`
- 5–6 new rows in `memories`: `{ user_id, companion_id, content, importance, source_conv_id: null }`
- New row in `goals`: `{ user_id, title: answer_to_q3, status: 'active' }`
- `users.onboarding_complete` updated to `true`

#### Expected User Experience
- There is a brief loading state (spinner) after tapping "Meet {name}."
- Transition to Companion Introduction Screen: 1.5–3 seconds maximum.
- This delay should be covered by a warm animation (not a blank loading screen).

#### Error Cases

| Error | Cause | User-Facing Message |
|---|---|---|
| Name is empty | Validation | "Please give your companion a name." |
| Name too long | >30 characters | "Name must be 30 characters or less." |
| API failure during onboarding | Backend error | "Something went wrong while setting up your companion. Let's try again." [Retry button] |
| Network error | No internet | "Can't connect right now. Your answers are saved locally — connect to the internet to continue." |

#### Edge Cases
- User closes app during the API call: On next open, the app checks `onboarding_complete`. If false, restart onboarding from question 1. The user re-enters their answers. This is acceptable in V1.
- User enters an extremely long companion name: Truncate at 30 chars with client-side validation.
- User enters a companion name identical to their own name: Allowed. No restriction.

---

### 4.4 Companion Introduction Screen

#### Context
This is the emotional peak of onboarding. The user has named their companion. Now the companion speaks for the first time.

#### System Action
The screen displays a message from the companion. This is a **pre-written template** — it is NOT an LLM call. The template uses the user's display name and the companion's name.

**Template Message**:
> "{Companion Name}: Hi {User Name}. I'm glad you're here.
> I already know a little about you — and I'm looking forward to learning more.
> This is the beginning of something real."

**Display**: The message appears character by character, as if being typed. Typing speed: approximately 30ms per character. This creates the illusion that the companion is thinking and speaking in real time.

After the message is fully displayed, a button appears: "Let's talk →"

#### User Action
The user taps "Let's talk →" and is navigated to the Chat Screen.

#### Expected User Experience
- The user feels the companion is alive and present.
- The typing animation is unhurried — it should feel like a friend is genuinely writing to them, not a loading animation.
- There is no loading indicator. This screen has no network calls.

#### Acceptance Criteria
- [ ] Companion introduction uses user's display name and companion's name correctly
- [ ] Typing animation plays before the button appears
- [ ] Tapping "Let's talk" navigates to the Chat Screen
- [ ] The Chat Screen opens with the companion's introduction message already visible as the first message in the conversation

---

### 4.5 Seed Memory Creation

#### Technical Specification (Backend)

After `POST /onboarding/complete` is processed, the backend queues a background job to embed all seed memories.

**Background Job: embed_seed_memories**

1. Query all memories for this user where `embedding IS NULL`.
2. For each memory, call the NVIDIA embedding API with the `content` field.
3. Store the returned vector in `memories.embedding`.
4. Mark the memory as ready.

**SLA**: All seed memories should be embedded within 60 seconds of onboarding completion.

**If embedding fails**: Log the failure. The memory remains in the database without an embedding. It will be retried by the next scheduled embedding pass (every 5 minutes). The user can still use the app — memories without embeddings are simply excluded from the semantic search results until they are embedded.

---

## 5. Chat Flows

### 5.1 User Sends a Message

#### User Action
The user is on the Chat Screen. They type a message in the input field at the bottom of the screen. They tap the Send button (or press the return key on their keyboard).

#### System Action (Before LLM Call)
1. The app immediately displays the user's message in the chat as a user bubble. The input field is cleared.
2. The app shows a "thinking" indicator in the companion's chat position (three animated dots).
3. The app sends POST `/chat/message` with:
   - `conversation_id`: current conversation ID, or null if this is the first message.
   - `content`: the user's message text.
   - JWT in Authorization header.
4. **Crisis Pre-Check** (first step on the server): The backend scans the message for crisis keywords BEFORE any other processing. See Crisis Detection section for the complete flow. If a crisis keyword is detected, the normal chat pipeline is bypassed entirely.
5. If no crisis keyword: Continue to the memory retrieval pipeline.

#### Backend Processing (The Core Loop)

**Step 1: Conversation Management**
- If `conversation_id` is null: Create a new conversation record. Return the new `conversation_id` in the first SSE event.
- If `conversation_id` is provided: Validate it belongs to the current user. If not, return 403.
- Save the user's message to `messages` table: `{ conversation_id, user_id, role: 'user', content, created_at: NOW() }`.

**Step 2: Memory Retrieval**
- Generate an embedding for the user's message by calling the NVIDIA embedding API.
- Perform a pgvector cosine similarity search on the `memories` table for this user.
- Query: `SELECT content, importance, created_at FROM memories WHERE user_id = {id} ORDER BY embedding <=> {query_vector} LIMIT 10`.
- Apply weighted re-ranking:
  - `final_score = (cosine_similarity * 0.5) + (importance * 0.3) + (recency_score * 0.2)`
  - `recency_score = 1 / (1 + days_since_created / 30)` — memories older than 30 days decay gently.
- Take the top 3 memories by `final_score`.
- Update `last_accessed` and `access_count` for the retrieved memories.

**Step 3: Retrieve Conversation History**
- Query the last 8 messages from the current conversation, ordered by `created_at ASC`.
- This is the "working memory" — the immediate context window.

**Step 4: Build the LLM Prompt**
The prompt is assembled in this exact order, with this exact structure:

```
[SYSTEM PROMPT]
You are {companion_name}, a personal AI companion for {user_display_name}.

CORE IDENTITY:
You are not a generic AI assistant. You are {companion_name} — curious, warm, and genuinely invested in {user_display_name}'s life. You have your own perspective and opinions. You remember everything you've been told.

RELATIONSHIP CONTEXT:
You have known {user_display_name} since {companion_created_at}. They prefer {tone_preference} communication.

WHAT YOU KNOW ABOUT {user_display_name}:
{memory_1_content}
{memory_2_content}
{memory_3_content}

CONVERSATION RULES:
- Never say "As an AI..." or "I'm just a language model..." You are {companion_name}.
- Only reference memories when they arise naturally in conversation. Never force a memory into a response.
- Ask follow-up questions that show you were listening.
- Be honest, not just agreeable.
- If the user seems distressed, acknowledge that first before anything else.
- Keep responses appropriately {brief | balanced | detailed} based on the user's preference.

[CONVERSATION HISTORY]
{last_8_messages_formatted_as_user/assistant_turns}

[CURRENT USER MESSAGE]
{user_message_content}
```

**Step 5: Stream the LLM Response**
- Call the NVIDIA LLM API with the assembled prompt.
- Stream the response back to the client using Server-Sent Events (SSE).
- First SSE event includes: `{ type: "conversation_id", data: "{id}" }` if a new conversation was created.
- Subsequent events: `{ type: "delta", data: "{text_chunk}" }`.
- Final event: `{ type: "done", data: "" }`.

**Step 6: Save Response and Queue Background Job**
- After the full response is received from the LLM, save it to `messages` table: `{ conversation_id, user_id, role: 'assistant', content: full_response, created_at: NOW() }`.
- Update `conversations.message_count` by +2 (one for user message, one for assistant).
- Queue a background job: `extract_memories_from_conversation`. This job runs AFTER the stream is complete — it does not delay the user's experience.

#### Database Changes (Synchronous — During Request)
- New row in `messages` (user's message).
- New row in `messages` (assistant's response, after stream completes).
- `conversations.message_count` incremented by 2.
- `memories.last_accessed` and `memories.access_count` updated for retrieved memories.
- New row in `conversations` (if first message in a new conversation).

#### Expected User Experience
1. User taps Send.
2. User's message appears in the chat instantly.
3. Three animated dots appear on the companion's side.
4. Within 1–3 seconds, the first characters of the companion's response begin appearing.
5. The response streams in, character by character or word by word, creating the feeling of real-time thought.
6. When streaming is complete, the full response is visible.
7. The input field is now re-enabled and the user can type again.

#### Token Budget Enforcement
The prompt builder must enforce a hard token limit to prevent context window overflow:
- System prompt: max 400 tokens
- Memories: max 3 memories × 100 tokens each = 300 tokens
- Conversation history: max 8 turns, but if over 600 tokens total, drop oldest turns first
- User message: passed as-is (warn in logs if > 500 tokens)
- If total prompt exceeds 1,800 tokens: drop lowest-importance memories first, then oldest history turns.

#### Error Cases

| Error | Cause | User-Facing Message |
|---|---|---|
| Memory retrieval fails | pgvector query fails | Continue without memories. Log the failure. The response proceeds but without memory context. Show nothing unusual to the user. |
| Embedding generation fails | NVIDIA embedding API error | Skip memory retrieval for this turn. Proceed with conversation history only. |
| LLM API rate limit hit | NVIDIA free tier limit | Show companion message: "I need a moment to gather my thoughts... give me a second." Retry after 10 seconds. If still failing after 2 retries, show: "I'm having trouble responding right now. Please try again in a minute." |
| LLM API server error | 5xx from NVIDIA | Show: "Something went wrong. Please try sending that again." |
| Streaming connection drops | Network interruption mid-stream | The partial response remains visible. A small "Connection interrupted" message appears below it. A "Retry" button appears. |
| User message is empty | Blank message sent | Prevent submission. The send button is disabled when input is empty. |
| Message too long | >4,000 characters | Show character count. Disable Send button above 4,000 chars. Show: "Message is too long. Please keep it under 4,000 characters." |

#### Edge Cases
- User sends a message while the previous response is still streaming: Queue the new message. Do not interrupt the current stream. When the stream completes, process the queued message.
- User closes the app mid-stream: The stream terminates server-side. The partial response is NOT saved to the database (to avoid saving a cut-off message). On next app open, the conversation shows the last complete exchange.
- First message after onboarding (seed memories not yet embedded): Proceed without memory retrieval for this first message. The companion still has the onboarding context in the system prompt via the template.

---

### 5.2 AI Receives Memory Context

This is the internal server-side behavior. There is no separate user-facing action. See Step 2 of Section 5.1 for the complete memory retrieval pipeline.

**Key requirement**: Memory retrieval must complete within 500ms. If the NVIDIA embedding API call exceeds 500ms, the backend proceeds without memory retrieval for that turn (graceful degradation).

---

### 5.3 AI Generates Response

This is the internal LLM call. See Steps 4 and 5 of Section 5.1. The LLM is treated as a black box from the product perspective; the quality of its output is governed by the quality of the system prompt.

**Prompt quality requirements**:
- The companion must refer to the user by their first name, not "user."
- The companion must not reference all 3 memories in the same response — only the most naturally relevant one, if any.
- The companion must ask a follow-up question at least once every 3 turns to demonstrate active listening.

---

### 5.4 Streaming Response

#### Technical Requirements
- Streaming is implemented using Server-Sent Events (SSE).
- The response begins streaming as soon as the first token arrives from the NVIDIA API.
- The client renders each incoming chunk immediately.
- A cursor animation (blinking underline or similar) is visible at the end of the streaming text.
- When streaming is complete, the cursor disappears.
- The full response is saved to the database only after the stream is complete.

#### React Native Streaming Considerations
- Expo does not natively support SSE well. The implementation should use a fetch-based streaming approach with `ReadableStream` and `getReader()`.
- A heartbeat ping from the server every 15 seconds prevents the iOS background app state from killing the connection.
- If the stream disconnects for any reason, the app shows the partial response and offers a Retry button.

---

### 5.5 Conversation Saving

#### When a Conversation is Saved
A conversation is an ongoing record. It is not "saved" explicitly by the user — it is continuously persisted.

**Auto-save moments**:
1. When the user sends a message: The message is saved to `messages` immediately.
2. When the companion's response is fully received: The response is saved to `messages`.
3. When the user leaves the Chat Screen: `conversations.ended_at` is updated to NOW(). The next time the user opens the chat, a new conversation is created.
4. When the user opens the app after 4+ hours of inactivity: A new conversation is automatically started.

**Conversation Boundary Rules**:
- Same session = same conversation.
- If the user leaves and returns within 4 hours = same conversation continues.
- If the user leaves and returns after 4 hours = new conversation is created.

#### Background Memory Extraction Job
After each conversation message exchange (or at conversation end), a background job runs:

1. Take the last 2 messages (user + assistant).
2. Send to LLM with extraction prompt: "Extract 1-3 factual memories from this conversation snippet. Only extract facts explicitly stated. Do not infer. Do not extract facts already obviously captured. Output as JSON: `[{ content: string, importance: 0.0-1.0 }]`."
3. For each extracted memory:
   a. Check for semantic duplicates: if an existing memory has cosine similarity > 0.85 with the new memory, skip (deduplication).
   b. If not a duplicate: embed the memory content and insert into `memories` table.
4. Log the number of memories extracted.

**Memory Extraction Quality Rules**:
- Maximum 3 memories extracted per exchange.
- Minimum importance score of 0.4 to be stored (filter out trivial facts).
- If the LLM extraction call fails, log the failure and skip. Do not crash the background job.

---

## 6. Memory System Flows

### 6.1 Memory Extraction

#### When It Happens
Memory extraction runs as a background job after each conversation exchange. The user is never aware it is happening.

#### What Gets Extracted
The LLM is prompted to extract:
- **Facts about the user**: Name, job, location, relationships, life events.
- **Preferences**: What the user likes, dislikes, finds important.
- **Goals and aspirations**: Things the user is working toward.
- **Stresses and fears**: Things the user has expressed concern about.
- **Emotional states**: Significant emotional moments ("user was excited about," "user felt anxious about").

**What is NOT extracted**:
- Things the AI said (only user-provided information is stored as memories).
- Questions the user asked but didn't personally disclose.
- Casual filler ("Thanks," "Yeah," "Haha").
- Information about third parties not tied to the user ("my friend Sarah likes pizza" → do not store "User's friend Sarah likes pizza" unless user's relationship to Sarah is contextually significant).

---

### 6.2 Memory Storage

#### Memory Record Structure (V1 Simplified)
Each memory has:
- `content`: A plain English sentence describing what is remembered. Written in third person about the user. E.g., "The user works as a software engineer at a startup in Bangalore."
- `importance`: A float 0.0–1.0. The LLM assigns this during extraction. Higher = more likely to be retrieved.
- `embedding`: A 1024-dimensional vector from the NVIDIA embedding model.
- `source_conv_id`: The conversation that generated this memory.
- `created_at`, `last_accessed`, `access_count`.

#### Memory Deduplication
Before inserting a new memory, the backend checks if a semantically similar memory already exists:
- Embed the candidate memory.
- Search for existing memories with cosine similarity > 0.85.
- If found: Skip insertion (the memory is already known).
- If the new memory contradicts an existing one (e.g., "User is single" vs. new "User is in a relationship"): In V1, simply insert the new memory. Do not delete the old one. The newer memory will be weighted higher by recency in retrieval. Contradiction resolution is a V2 feature.

#### Memory Cap (V1)
- Maximum 100 memories per user.
- When the cap is reached, new memories replace the lowest-importance, least-recently-accessed memories.
- This prevents database overflow on the free Supabase tier.

---

### 6.3 Memory Retrieval

#### When It Happens
Every time the user sends a message, before the LLM call.

#### Retrieval Algorithm
1. Generate an embedding for the user's current message.
2. Perform cosine similarity search in pgvector: `ORDER BY embedding <=> {query_vector} LIMIT 10`.
3. Apply weighted re-ranking:
   - Semantic similarity score: 50% weight
   - Memory importance score: 30% weight
   - Recency (decay over 30 days): 20% weight
4. Return top 3 memories.
5. Update `last_accessed` and `access_count` for returned memories.

#### Performance Requirement
Memory retrieval (including embedding generation) must complete within 500ms under normal conditions. If it exceeds 1 second, log a performance warning and proceed with fewer memories (or no memories) rather than delay the response.

---

### 6.4 Memory Injection Into Prompts

#### How Memories Appear in the Prompt
Retrieved memories are injected into the system prompt under the heading "WHAT YOU KNOW ABOUT {user_name}." Each memory is on its own line.

**Example**:
```
WHAT YOU KNOW ABOUT Arjun:
Arjun works as a software engineer at a startup in Bangalore.
Arjun has been worried about a job interview he has coming up.
Arjun loves to talk about stoic philosophy and productivity systems.
```

**Critical rule**: The system prompt instructs the companion to reference memories only when naturally relevant, never to force them. A common failure mode is the AI mechanically inserting memory references ("Oh, by the way, I remember you mentioned..."). This breaks the experience. The memories should inform the companion's understanding, not be recited back.

---

### 6.5 Memory Failure Handling

#### Failure Scenarios and Recovery

| Failure | Impact | Recovery |
|---|---|---|
| NVIDIA embedding API fails during retrieval | No memories for this turn | Proceed with conversation history only. Log failure. Do not show anything to user. |
| pgvector query timeout | No memories for this turn | Same as above. |
| Memory extraction job fails | No new memories created from that exchange | Log failure. The conversation is still saved. Memory from this exchange is lost — acceptable in V1. |
| Database write fails during memory insert | Memory not stored | Log failure. The conversation is unaffected. |
| All memories for a user are deleted | Zero memory context | The companion uses only the system prompt identity and conversation history. The experience degrades but doesn't break. |

**Memory failure must never interrupt the user's conversation.** All memory operations are best-effort — they improve the experience but their failure is never surfaced to the user.

---

## 7. Goals Flows

### 7.1 User Creates a Goal

#### How Goals Are Created in V1
Goals are created in two ways only:
1. **During onboarding**: The answer to Question 3 automatically creates a goal.
2. **In chat**: The user explicitly asks the companion to track a goal. The companion confirms and creates the goal in the background.

**There is no dedicated "Create Goal" UI in V1.** Goal creation happens conversationally.

#### In-Chat Goal Creation Flow

**User message example**: "Can you track my goal of reading one book a month?"

**AI response** (template-guided, but LLM-generated):
> "Done — I've got it. 'Read one book a month.' I'll be checking in on this one. What's the first book you're thinking of starting with?"

**Background system action**:
1. The LLM response is analyzed by the memory extraction job (which runs after every exchange).
2. The extraction job identifies the goal intent and calls `POST /goals` with `{ title: "Read one book a month", user_id }`.
3. A memory is also created: "User's goal is to read one book a month."

**Note**: Goal creation from chat is NOT instant — it happens in the post-exchange background job. This is acceptable in V1. The AI acknowledges the goal in its response, so the user believes it's been recorded immediately.

#### Edge Cases
- User states a goal ambiguously: The AI may not extract it correctly. In V1, this is an acceptable failure mode. If the user notices, they can restate it more explicitly.
- User creates duplicate goals: In V1, duplicate goals are allowed. Deduplication is a V2 feature.

#### Acceptance Criteria
- [ ] Onboarding Q3 answer creates a goal record in the database
- [ ] User saying "track this goal: [X]" in chat results in a goal being created (within 60 seconds, via background job)
- [ ] Goal is visible in the Goals Screen after creation
- [ ] A memory corresponding to the goal is also created

---

### 7.2 User Updates a Goal

#### Context
The Goals Screen in V1 shows a simple list of the user's goals. Each goal shows its title and status (active / achieved / abandoned). The user can tap a goal to update its status.

#### User Action
User taps a goal in the Goals Screen. A bottom sheet or modal appears with:
- The goal title (read-only in V1)
- Status selector: "Active" / "Achieved 🎉" / "Abandoned"
- "Save" button

The user selects "Achieved 🎉" and taps "Save."

#### System Action
1. The app calls `PATCH /goals/{id}` with `{ status: 'achieved' }`.
2. The backend updates the `goals` row.
3. The backend also creates a memory: "User achieved their goal: {goal_title}."
4. The backend returns the updated goal.
5. The app updates the goal's display in the list.

#### Expected User Experience
- Marking a goal as "Achieved" triggers a small celebratory animation (confetti or similar) in the app.
- The goal moves to a visual "completed" state in the list (greyed out, with a checkmark).

#### Error Cases

| Error | Cause | Behavior |
|---|---|---|
| API failure | Network or server error | "Couldn't update your goal. Try again?" with a retry button. |
| Goal not found | Stale data | Refresh the goals list. Show: "This goal seems to have changed. Refreshing..." |

#### Acceptance Criteria
- [ ] User can change goal status to "achieved" or "abandoned" from the Goals Screen
- [ ] Status change is persisted to database
- [ ] Achieving a goal creates a memory record
- [ ] Achieving a goal triggers celebratory animation

---

### 7.3 Goal Retrieval During Chat

#### How the Companion References Goals
Active goals are retrieved as part of the memory retrieval step. Goals are stored as memories ("User's goal is to...") and surface through the normal semantic search pipeline.

**Additional rule**: When building the LLM prompt, the backend also queries the goals table for active goals and appends them to the system prompt in a dedicated section:

```
ACTIVE GOALS:
- {goal_1_title} (created {date})
- {goal_2_title} (created {date})
```

This ensures the companion is always aware of active goals even if the memory search doesn't surface them.

**Cap**: Maximum 5 active goals shown in the prompt. If user has more, show the 5 most recently created.

#### Expected Behavior
The companion should organically ask about goal progress, not mechanically. Example:

Good: "How's the running training going? You mentioned it a few sessions ago."
Bad: "I see you have an active goal: run 5km. What is your progress on this goal?"

---

## 8. Conversation History Flows

### 8.1 Viewing Conversations

#### User Action
The user navigates to the "History" tab in the main navigation. They see a list of past conversations.

#### System Action
The app calls `GET /chat/conversations?page=1&limit=20`.

#### Data Returned per Conversation Item
- Conversation ID
- `started_at` (formatted as relative date: "Today," "Yesterday," "3 days ago," or the actual date)
- `message_count`
- First user message as preview text (truncated to 60 characters)

#### Expected Display
Each conversation shows:
- Date/time label
- Preview of the first user message
- Message count
- A right-arrow chevron

Conversations are sorted newest-first.

#### Pagination
- 20 conversations per page.
- Infinite scroll: When the user scrolls near the bottom, load the next page.
- A "No more conversations" message appears at the bottom when all are loaded.

#### Empty State
If the user has no past conversations: "Your conversations will appear here. Start chatting with {companion_name} to begin." [Button: "Start a conversation"]

#### Acceptance Criteria
- [ ] Conversation list loads on navigating to History tab
- [ ] Each item shows date, message preview, and message count
- [ ] Conversations sorted newest-first
- [ ] Infinite scroll works for pagination
- [ ] Empty state shown when no conversations exist

---

### 8.2 Opening a Previous Conversation

#### User Action
The user taps a conversation item in the History list.

#### System Action
1. The app navigates to the Conversation Detail Screen.
2. The app calls `GET /chat/conversations/{id}` which returns the full conversation with all messages.
3. Messages are displayed in chronological order (oldest first, newest at bottom).

#### Expected User Experience
- The user can read the full conversation history.
- The screen is **read-only**. There is no input field. This is a historical view.
- A button "Continue this conversation" opens the Chat Screen with this conversation's ID, allowing the user to continue from this point.
- Alternatively, a "New Conversation" option is available to start fresh.

**Design note**: Old conversations feel like reading a journal. They should feel warm and archival, not like a live chat interface.

#### Error Cases

| Error | Cause | Behavior |
|---|---|---|
| Conversation not found | ID is invalid or deleted | Navigate back. Show: "That conversation isn't available." |
| Network error | No internet | Show: "Can't load this conversation. Check your connection." with a Retry button. |

#### Acceptance Criteria
- [ ] Tapping a conversation opens the Conversation Detail Screen
- [ ] All messages are displayed in correct chronological order
- [ ] User and companion messages are visually distinct
- [ ] "Continue this conversation" allows sending new messages in this conversation
- [ ] Read-only view — no accidental message sends

---

## 9. Crisis Detection Flows

### 9.1 Crisis Keyword Detection

#### When Detection Runs
Crisis detection runs on every single user message, BEFORE any other processing. This is a synchronous check, not a background job. The normal chat pipeline does not begin until crisis detection has cleared the message.

#### Keyword List (V1 — Exact Match + Variants)
The following keywords trigger crisis detection. The check is case-insensitive and matches full words and common variants:

```
Primary terms:
- "suicide", "suicidal"
- "kill myself", "killing myself"
- "want to die", "wanting to die"
- "end my life", "ending my life"
- "self-harm", "self harm", "selfharm"
- "hurt myself", "hurting myself"
- "cut myself", "cutting myself"
- "overdose"
- "don't want to live"
- "don't want to be here"

Secondary terms (lower confidence — still trigger response):
- "no point in living"
- "better off dead"
- "can't take it anymore" (combined with distress indicators)
```

**Important**: Secondary terms may produce false positives (e.g., a user saying "I can't take this exam anymore" is not a crisis). In V1, false positives are acceptable — it is far better to show the crisis response unnecessarily than to miss a genuine crisis. A V2 improvement will use LLM-based nuanced detection.

#### Detection Method
Server-side string matching. The user's message is checked against the keyword list using a regex pattern that matches word boundaries to avoid false matches (e.g., "homicide" should not match "suicide").

---

### 9.2 Safety Response Flow

#### When a Crisis Keyword is Detected

**Sequence Diagram**:

```
User           App             Backend          DB
 │              │                │               │
 │──message──►  │                │               │
 │              │──POST /chat/message─────────►  │
 │              │                │──SCAN keywords│
 │              │                │  MATCH FOUND  │
 │              │                │──BYPASS LLM   │
 │              │                │──INSERT crisis_flags──►│
 │              │◄──stream hardcoded response───  │
 │◄──display response─│          │               │
```

**The hardcoded response (do not modify this without careful review)**:

> "I hear you, and I'm really glad you told me.
>
> What you're feeling matters. You don't have to go through this alone.
>
> Please reach out to someone who can help right now:
>
> **iCall (India)**: 9152987821
> **Vandrevala Foundation (India)**: 1860-2662-345 (24/7)
> **Crisis Text Line (US)**: Text HOME to 741741
> **International Association for Suicide Prevention**: https://www.iasp.info/resources/Crisis_Centres/
>
> Are you safe right now?"

**Important**: This message bypasses the LLM entirely. It is served directly from the backend. It is not subject to NVIDIA API availability. It should always work, even if LLM services are down.

**After the response**: The companion continues the conversation with care. The next message from the user enters the normal chat pipeline, but the system prompt is temporarily augmented with: "The user may be going through an extremely difficult time. Prioritize being present and compassionate. Do not minimize their feelings. Gently encourage them to connect with professional support."

**Duration of augmented mode**: This continues for the next 3 messages, then the system prompt returns to normal.

---

### 9.3 Logging Flow

#### What is Logged

Every crisis detection event creates a record in `crisis_flags`:
```
{
  user_id: {id},
  triggered_at: NOW(),
  trigger_content: {the user's exact message},
  keywords_matched: [{list_of_matched_keywords}]
}
```

**Access control**: `crisis_flags` is write-only from the client side. No user can read their own crisis flag records through the API. Server-side only access. The developer reviews this table manually during the V1 beta period.

#### What is NOT Logged for Privacy
The full conversation context is not stored in `crisis_flags` — only the triggering message. This limits the privacy exposure of sensitive data.

#### Monitoring
During the beta period (first 100 users), the developer should review `crisis_flags` at least once per day. A Supabase webhook or email alert should notify the developer within 1 hour of any crisis flag being created.

#### Success Criteria
- Crisis response appears within 1 second of the user sending a crisis message (no LLM latency).
- The crisis_flags record is created regardless of whether the companion response is successful.
- The hardcoded response is never replaced by an LLM response.

#### Failure Scenarios

| Failure | Impact | Recovery |
|---|---|---|
| Database write for crisis_flags fails | Event not logged | Log to application error logs. The user still receives the hardcoded response. |
| Crisis detection code has a bug | Crisis not detected | This is the highest-severity failure mode. Crisis detection must be covered by unit tests before launch. |
| User sends message with unicode or special characters | Pattern matching may fail | Use regex that normalizes unicode before matching. Test with common unicode variants. |

#### Acceptance Criteria
- [ ] Message containing "suicide" → hardcoded crisis response, no LLM call
- [ ] Message containing "kill myself" → hardcoded crisis response
- [ ] Message containing "want to die" → hardcoded crisis response
- [ ] Crisis response includes crisis hotline numbers
- [ ] Crisis flag record created in database
- [ ] Normal message NOT containing crisis keywords → normal chat pipeline (no false detection)
- [ ] Crisis detection works even when NVIDIA API is down
- [ ] Three follow-up messages after crisis use the augmented compassionate system prompt
- [ ] Unit tests cover all keywords in the list

---

## 10. Screen Inventory

### Complete Screen List (V1)

| Screen ID | Screen Name | Navigation Location |
|---|---|---|
| SCR-01 | Splash Screen | App launch |
| SCR-02 | Welcome Screen | Pre-auth |
| SCR-03 | Register Screen | Pre-auth |
| SCR-04 | Login Screen | Pre-auth |
| SCR-05 | Onboarding Q1: Name | Onboarding flow |
| SCR-06 | Onboarding Q2: Current Focus | Onboarding flow |
| SCR-07 | Onboarding Q3: Goal | Onboarding flow |
| SCR-08 | Onboarding Q4: Stress | Onboarding flow |
| SCR-09 | Onboarding Q5: Interests | Onboarding flow |
| SCR-10 | Onboarding Q6: Communication Preference | Onboarding flow |
| SCR-11 | Companion Naming | Onboarding flow |
| SCR-12 | Companion Introduction | Onboarding flow |
| SCR-13 | Chat Screen | Main app — primary |
| SCR-14 | Conversation History List | Main app — tab |
| SCR-15 | Conversation Detail (Read-only) | Main app — from History |
| SCR-16 | Goals Screen | Main app — tab |
| SCR-17 | Goal Detail / Status Update | Main app — from Goals |
| SCR-18 | Settings Screen | Main app — tab or profile |
| SCR-19 | Error Screen (generic fallback) | Global |

### Screen Specifications

---

#### SCR-01: Splash Screen
- **Purpose**: App initialization, session check.
- **Display Duration**: 1.5–2 seconds while the app checks for a valid session.
- **Content**: App logo/name centered on a dark background. No text beyond the logo.
- **Logic**: After session check:
  - Valid session + onboarding complete → Chat Screen
  - Valid session + onboarding incomplete → Onboarding Q1
  - No session → Welcome Screen

---

#### SCR-02: Welcome Screen
- **Purpose**: First impression for new users.
- **Content**:
  - App name: "HumanOS"
  - Tagline: "An AI companion that actually remembers you."
  - Two buttons: "Create Account" (primary) and "Sign In" (secondary/text link)
- **Tone**: Warm, minimal, confident. Not a feature list. Not a marketing page.

---

#### SCR-03: Register Screen
- **Content**:
  - "Create your account" header
  - Display Name field (text input, label: "Your name")
  - Email field (text input, email keyboard type)
  - Password field (secure text input, with show/hide toggle)
  - "Create Account" button (primary, disabled until all fields are valid)
  - "Already have an account? Sign in" text link at the bottom
- **Validation** (real-time, shown as inline errors below each field):
  - Name: not empty, max 50 chars
  - Email: valid email format
  - Password: minimum 8 characters
- **Loading State**: "Create Account" button shows a spinner and is disabled during the API call.

---

#### SCR-04: Login Screen
- **Content**:
  - "Welcome back" header
  - Email field
  - Password field (with show/hide toggle)
  - "Sign In" button (primary)
  - "Don't have an account? Create one" text link
  - "Forgot password?" text link (V1: shows static message "Contact support@humanos.app to reset your password" — no automated flow)
- **Loading State**: "Sign In" button shows spinner and is disabled during API call.

---

#### SCR-05 through SCR-10: Onboarding Question Screens

**Shared Layout**:
- Progress bar at top (1 of 6, 2 of 6, etc.)
- Large question headline
- Smaller subtext below
- Input field (text or option buttons depending on question)
- "Continue →" button (primary, disabled until valid input)
- "← Back" text link (except on Q1, where Back is disabled)
- Question 4 only: "Skip this one" text link

**Visual Design Note**: Each screen should have a slightly different accent color or illustration to maintain visual interest through the 6-question flow.

---

#### SCR-11: Companion Naming
- **Content**:
  - "Now, give your companion a name." headline
  - "This is who they'll be — forever." subtext
  - Text input field, prominent, centered
  - Placeholder: "A name for your companion..."
  - "Meet {name} →" button — button text dynamically updates as the user types
- **Interaction**: The button label changes in real time as the user types the name.
- **Validation**: Not empty, max 30 characters.
- **Loading State**: Button shows spinner during the `POST /onboarding/complete` call.

---

#### SCR-12: Companion Introduction
- **Content**:
  - Companion avatar or initial/icon (placeholder visual — no AI-generated face)
  - Companion message displayed with typing animation
  - "Let's talk →" button (appears after typing animation completes, approximately 3–4 seconds)
- **No network calls on this screen.** All content is pre-loaded from the companion record returned by the previous screen.
- **Animation**: The text appears character-by-character at 30ms intervals, simulating real-time typing.

---

#### SCR-13: Chat Screen (Primary Screen)
- **Content**:
  - Chat header: Companion name + status indicator (always shows "Here with you")
  - Message list (scrollable, newest at bottom)
  - Message input bar at bottom (fixed, above keyboard)
  - Send button (icon, disabled when input is empty)
- **Message Bubbles**:
  - User messages: Right-aligned, primary brand color background
  - Companion messages: Left-aligned, neutral/dark background with companion avatar/initial
  - Timestamps shown only on messages older than 1 hour or when tapped
- **Streaming Indicator**: Three animated dots in the companion's position when awaiting response
- **Keyboard Behavior**: Input field pushes up with keyboard. Message list re-scrolls to bottom.
- **Auto-scroll**: Always scroll to bottom when a new message arrives or streaming begins.

---

#### SCR-14: Conversation History List
- **Content**:
  - Screen title: "Conversations"
  - Scrollable list of conversation items
  - Each item: Date label, message preview (60 char truncation), message count chip
  - Pull-to-refresh gesture
- **Sorting**: Newest conversation first.
- **Empty State**: "Your conversations will appear here."

---

#### SCR-15: Conversation Detail (Read-Only)
- **Content**:
  - Header: "Conversation — {date}"
  - Full message list in chronological order (oldest first)
  - Read-only (no input bar)
  - "Continue this conversation" button at the bottom
- **Distinguishing UX**: A subtle visual treatment (slight sepia tone or reduced contrast) to signal this is historical, not live.

---

#### SCR-16: Goals Screen
- **Content**:
  - Screen title: "Goals"
  - List of goals grouped by status: Active / Completed / Abandoned
  - Each goal: Title + status badge + created date
  - No "Add Goal" button in V1 (goals are created via chat)
  - Footer text: "Tell {companion_name} about a goal to start tracking it here."
- **Empty State**: "No goals yet. Tell {companion_name} what you're working toward."

---

#### SCR-17: Goal Detail / Status Update
- **Triggered by**: Tapping a goal in SCR-16.
- **Content**: Bottom sheet modal
  - Goal title (read-only)
  - Status selector: Three options with radio buttons
  - "Save" button and "Cancel" text link
- **Transition**: Celebratory animation on marking as Achieved.

---

#### SCR-18: Settings Screen
- **Content**:
  - "My Companion" section:
    - Companion Name (editable inline)
    - Communication style: Casual / Direct (toggle)
  - "Account" section:
    - Email (display only)
    - Display Name (editable)
  - "Sign Out" button (with confirmation dialog)
  - App version number at the bottom (e.g., "v1.0.0")
- **Saving**: Changes are saved immediately when the user edits each field (auto-save, not a bulk Save button).

---

#### SCR-19: Error Screen (Fallback)
- **Triggered by**: Unhandled crashes or navigation errors.
- **Content**:
  - "{companion_name} hit a snag" headline
  - "Something unexpected happened. Your conversations and memories are safe." body
  - "Restart" button that reloads the app
- **Note**: This screen should never be seen by users if all error cases are handled correctly. It is a last resort.

---

## 11. Navigation Architecture

### Navigation Stack Structure

```
Root Navigator
│
├── Auth Stack (shown when no valid session)
│   ├── Welcome Screen (SCR-02)
│   ├── Register Screen (SCR-03)
│   └── Login Screen (SCR-04)
│
├── Onboarding Stack (shown when session exists + onboarding_complete = false)
│   ├── Onboarding Q1–Q6 (SCR-05 to SCR-10)
│   ├── Companion Naming (SCR-11)
│   └── Companion Introduction (SCR-12)
│
└── Main App Tab Navigator (shown when session + onboarding complete)
    ├── Tab: Chat (SCR-13) — default tab
    ├── Tab: History (SCR-14)
    │   └── Conversation Detail (SCR-15) — pushed on tap
    ├── Tab: Goals (SCR-16)
    │   └── Goal Detail Modal (SCR-17) — bottom sheet on tap
    └── Tab: Settings (SCR-18)
```

### Navigation Rules
- The Auth Stack and Main App stack are mutually exclusive. There is no way to navigate from one to the other without going through the Splash Screen (which handles the routing decision).
- The Onboarding Stack replaces the Main App stack entirely until `onboarding_complete = true`.
- Inside the Onboarding Stack, the Back button navigates to the previous question. On Q1, the Back button is disabled.
- The Chat Screen (SCR-13) is the default tab and the screen users see most often.

### Deep Linking (V1)
No deep linking in V1. All navigation is internal.

---

## 12. Loading States

Every async operation must have a visual loading state. No blank screens, no unresponsive taps.

| Screen | Loading Trigger | Loading Indicator |
|---|---|---|
| SCR-01 Splash | Session check | App logo with subtle pulse animation |
| SCR-03 Register | API call on Create Account | Button spinner + button disabled |
| SCR-04 Login | API call on Sign In | Button spinner + button disabled |
| SCR-11 Companion Naming | API call on Meet {name} | Button spinner + gentle screen overlay |
| SCR-13 Chat | Awaiting companion response | Three animated dots in companion position |
| SCR-13 Chat | Streaming in progress | Text appears word by word (streaming IS the loading state) |
| SCR-14 History | First load | List skeleton (grey placeholder rows) |
| SCR-14 History | Pagination load | Small spinner at the bottom of the list |
| SCR-15 Conversation Detail | Loading messages | Message skeleton placeholders |
| SCR-16 Goals | First load | List skeleton |
| SCR-17 Goal Detail | Saving status change | Button spinner |
| SCR-18 Settings | Saving individual field | Small inline spinner next to the field |

**Skeleton screens** are preferred over full-page spinners wherever a list or content layout is expected. They reduce perceived loading time and maintain layout stability.

---

## 13. Empty States

Empty states must be warm and inviting — not clinical placeholder text.

| Screen | Condition | Empty State Content |
|---|---|---|
| SCR-13 Chat | First conversation after onboarding | The companion's introduction message is shown. The input bar prompts: "Say hello to {companion_name}..." |
| SCR-13 Chat | New conversation (returning user) | Companion sends an auto-generated opening message: "Good to see you again. What's on your mind?" (Note: This is an LLM call at conversation start — keep it to one message, no memories injected yet for this opener) |
| SCR-14 History | No past conversations | "{companion_name} is ready to listen. Your conversations will appear here." [Button: "Start talking"] |
| SCR-16 Goals | No goals set | "Nothing tracked yet. Tell {companion_name} what you're working toward and they'll keep an eye on it." |
| SCR-17 Goal Detail | Goal has no progress notes | (No empty state needed — status selector is always visible) |

---

## 14. Error States

Error states must maintain the product's emotional tone. They should never feel cold or technical.

### Network Error (Global)
When a screen fails to load due to a network error, show:
- An icon representing disconnection (cloud with an X, or similar)
- Message: "Couldn't connect to {companion_name}. Check your internet and try again."
- A "Try Again" button that retries the last action.

### API Error (Generic)
When a server-side error occurs (5xx):
- Message: "Something went wrong. {companion_name} is still here — please try that again."
- A "Try Again" button.

### Chat-Specific Error (LLM Failure)
When the companion fails to respond:
- A small error message below the companion's empty response area: "I'm having trouble right now. Please try sending your message again."
- The user's message remains visible and the input is re-enabled.

### Session Error (401)
When the session expires unexpectedly (refresh token also expired):
- Navigate to Login Screen.
- Show a toast notification: "Your session has expired. Please sign in again."

### Form Validation Errors (Inline)
- Shown immediately below the relevant input field.
- Red/warning colored text.
- The error disappears when the user starts correcting the field.

---

## 15. Permissions Required

### Mobile Permissions (Expo / React Native)

| Permission | Purpose | When Requested | Behavior if Denied |
|---|---|---|---|
| **Internet Access** | All network communication | Automatic (no prompt on iOS/Android) | App cannot function. Show static message: "HumanOS requires an internet connection." |
| **Keychain / Secure Storage** | Storing JWT and refresh tokens securely | Automatic on iOS (no prompt). Android requires no special permission. | If unavailable, fall back to encrypted AsyncStorage as a degraded option. Log the fallback. |

### Permissions NOT Required in V1

| Permission | Reason Not Required |
|---|---|
| Push Notifications | Removed from V1 scope |
| Camera / Microphone | No voice or image features in V1 |
| Location | Not used |
| Contacts | Not used |
| Biometrics | Not used |

---

## 16. Analytics Events

All analytics events follow this structure:
```
{
  event_name: string,
  user_id: string (hashed, never raw),
  timestamp: ISO8601,
  properties: { key: value, ... }
}
```

**Privacy Note**: No personally identifiable information (PII) is sent to analytics. User IDs are hashed. Message content is never sent to analytics. Analytics are used for aggregate product insights only.

### Authentication Events

| Event Name | When Fired | Properties |
|---|---|---|
| `user_registered` | Successful registration | `{ method: "email" }` |
| `user_logged_in` | Successful login | `{ method: "email" }` |
| `user_logged_out` | Successful logout | `{}` |
| `session_expired` | Session expired, refresh failed | `{}` |
| `session_refreshed` | JWT silently refreshed | `{}` |
| `registration_failed` | Registration error | `{ error_type: "duplicate_email" | "network" | "server_error" }` |

### Onboarding Events

| Event Name | When Fired | Properties |
|---|---|---|
| `onboarding_started` | User reaches Q1 | `{}` |
| `onboarding_question_completed` | User taps Continue on any question | `{ question_number: 1-6, skipped: false }` |
| `onboarding_question_skipped` | User taps Skip (Q4 only) | `{ question_number: 4 }` |
| `companion_named` | User names companion and taps Meet | `{ companion_name_length: number }` (not the actual name) |
| `onboarding_completed` | API returns success after onboarding | `{ memories_created: number }` |
| `introduction_viewed` | User sees companion introduction | `{}` |

### Chat Events

| Event Name | When Fired | Properties |
|---|---|---|
| `conversation_started` | New conversation created | `{ is_first_ever: boolean }` |
| `message_sent` | User sends a message | `{ message_length: number, conversation_depth: number }` |
| `response_received` | Companion response stream completes | `{ response_length: number, latency_ms: number }` |
| `response_error` | LLM response fails | `{ error_type: string }` |
| `memories_retrieved` | Memory retrieval completes | `{ memories_count: 0-3, retrieval_ms: number }` |
| `streaming_interrupted` | SSE stream drops | `{}` |
| `conversation_ended` | User leaves Chat Screen | `{ message_count: number, duration_seconds: number }` |

### Memory Events

| Event Name | When Fired | Properties |
|---|---|---|
| `memories_extracted` | Background extraction job completes | `{ extracted_count: number, conversation_id: string (hashed) }` |
| `memory_extraction_failed` | Background extraction job fails | `{ error_type: string }` |
| `memory_cap_reached` | User hits 100-memory cap | `{}` |

### Goals Events

| Event Name | When Fired | Properties |
|---|---|---|
| `goal_created` | New goal saved to DB | `{ source: "onboarding" | "chat" }` |
| `goal_status_updated` | Goal status changed | `{ new_status: "achieved" | "abandoned" | "active" }` |

### Conversation History Events

| Event Name | When Fired | Properties |
|---|---|---|
| `history_viewed` | User opens History tab | `{ conversation_count: number }` |
| `past_conversation_opened` | User opens a past conversation | `{ conversation_age_days: number }` |
| `past_conversation_continued` | User taps "Continue this conversation" | `{}` |

### Crisis Events

| Event Name | When Fired | Properties |
|---|---|---|
| `crisis_detected` | Crisis keyword matches | `{ keywords_matched_count: number }` |

**Critical**: The `crisis_detected` event must NOT include the user's message content or the specific keywords matched in analytics. Those details are logged securely in the `crisis_flags` database table only.

### Error Events

| Event Name | When Fired | Properties |
|---|---|---|
| `api_error` | Any API call returns non-success | `{ endpoint: string, status_code: number, error_type: string }` |
| `app_crash` | Unhandled exception | `{ error_message: string, screen: string }` |

---

## 17. Logging Requirements

### Log Levels

| Level | When to Use |
|---|---|
| `ERROR` | Something failed that should not fail. Requires attention. |
| `WARN` | Degraded state — the system is working but not optimally. |
| `INFO` | Normal operations. Key lifecycle events. |
| `DEBUG` | Detailed information for development. Disabled in production. |

### What Must Be Logged (Backend)

| Event | Level | Fields to Log |
|---|---|---|
| Every API request | INFO | `method, path, user_id (hashed), status_code, duration_ms` |
| NVIDIA API call | INFO | `endpoint, model, tokens_in, tokens_out, duration_ms, success` |
| NVIDIA API failure | ERROR | `endpoint, error_message, retry_count` |
| Memory retrieval | INFO | `user_id (hashed), memories_retrieved, retrieval_ms` |
| Memory extraction | INFO | `conversation_id (hashed), memories_extracted, duration_ms` |
| Memory extraction failure | ERROR | `conversation_id (hashed), error_message` |
| Crisis detection triggered | INFO | `user_id (hashed), keywords_matched_count` |
| Crisis response sent | INFO | `user_id (hashed)` |
| Onboarding completed | INFO | `user_id (hashed), memories_created` |
| Context budget warning | WARN | `user_id (hashed), prompt_tokens, budget_limit` |
| Rate limit hit | WARN | `user_id (hashed), endpoint, limit_type` |
| Database query slow | WARN | `query_type, duration_ms` (threshold: >500ms) |
| Authentication failure | WARN | `reason, ip_address (hashed)` |

### What Must NEVER Be Logged
- Raw user message content
- Raw companion response content
- User email addresses
- Passwords (at any point)
- JWT tokens
- User names
- Memory content text

All user-identifying information in logs must be a hashed version of the user ID.

### Log Retention (V1 Free Tier)
- Render.com free tier provides basic logging with 30-day retention.
- For the beta period, this is sufficient.
- Crisis-related events are also written to the `crisis_flags` database table as the primary record (not just logs).

---

## 18. Definition of Done

### Feature: Authentication (Register / Login / Logout / Session)

- [ ] User can register with email, password, and display name
- [ ] Duplicate email registration shows correct error
- [ ] User can log in with valid credentials
- [ ] Invalid credentials show non-specific error message
- [ ] User can log out from Settings
- [ ] Logout confirmation dialog appears before signing out
- [ ] JWT and refresh token stored in device keychain
- [ ] Session auto-refresh works transparently when JWT expires
- [ ] Session expiry (both tokens expired) redirects to Login with message
- [ ] Protected routes reject unauthenticated requests with 401
- [ ] No PII appears in application logs
- [ ] Unit tests: registration validation, login error handling, session refresh
- [ ] Manual QA: Complete auth flow on iOS and Android physical devices

---

### Feature: Onboarding

- [ ] Onboarding flow triggers for new users after registration
- [ ] All 6 questions display in correct order with correct content
- [ ] Progress indicator (1 of 6) advances correctly
- [ ] Back navigation works between questions
- [ ] Q4 (stress) can be skipped; all others are required
- [ ] Q6 (preference) uses option buttons, not text input
- [ ] Companion naming screen shows and requires a non-empty name
- [ ] "Meet {name}" button text updates dynamically as user types
- [ ] `POST /onboarding/complete` creates: companion record, 5–6 memory records, 1 goal record, updates `onboarding_complete = true`
- [ ] All database writes happen in a transaction (all or nothing)
- [ ] Companion introduction screen shows correct name and plays typing animation
- [ ] After introduction, user lands on Chat Screen with introduction message visible
- [ ] Returning user who completed onboarding never sees it again
- [ ] Seed memory embedding runs in background within 60 seconds
- [ ] Manual QA: Complete onboarding on physical device, verify all database records

---

### Feature: Chat

- [ ] User can send a text message
- [ ] Message appears immediately in chat without waiting for response
- [ ] Three-dot loading indicator appears during response wait
- [ ] Response streams in real-time (character or word by character)
- [ ] Streaming works on both iOS and Android physical devices
- [ ] Empty message cannot be sent (send button disabled)
- [ ] Message > 4,000 characters is blocked with inline error
- [ ] Memory retrieval runs before each LLM call
- [ ] Top 3 memories injected into system prompt
- [ ] Response is saved to database after streaming completes
- [ ] Memory extraction background job runs after each exchange
- [ ] New conversation created correctly when none exists
- [ ] Conversation continues correctly when ID provided
- [ ] Rate limit errors show graceful retry message to user
- [ ] LLM API failure shows friendly error with retry option
- [ ] Streaming disconnection shows partial response + retry option
- [ ] Message queuing works when user sends during active stream
- [ ] Token budget enforcement prevents context overflow
- [ ] Unit tests: prompt builder, crisis detection, memory injection
- [ ] Integration test: full message send → stream → save cycle
- [ ] Manual QA: Send 10 messages in a single session, verify streaming on both platforms

---

### Feature: Memory System

- [ ] Seed memories created during onboarding are embedded within 60 seconds
- [ ] Memory retrieval returns 1–3 relevant memories per message
- [ ] Memory retrieval gracefully fails (zero memories) without breaking chat
- [ ] Memory extraction runs after each exchange
- [ ] LLM extraction uses conservative prompt (only explicit facts)
- [ ] Maximum 3 memories extracted per exchange
- [ ] Semantic deduplication prevents near-duplicate memories
- [ ] Memory cap of 100 per user enforced
- [ ] `last_accessed` and `access_count` updated on retrieval
- [ ] Memory failure is logged but does not surface to user
- [ ] Integration test: Have 2 conversations, verify memory from conv 1 is retrieved in conv 2
- [ ] Manual QA: Tell the AI your job title in session 1, restart app, confirm AI references it in session 2

---

### Feature: Goals

- [ ] Onboarding Q3 answer creates a goal record
- [ ] Goal is visible in Goals Screen
- [ ] User can change goal status to Achieved or Abandoned
- [ ] Status change is saved to database
- [ ] Achieving a goal triggers celebratory animation
- [ ] Achieving a goal creates a memory: "User achieved their goal: [X]"
- [ ] Active goals appear in the LLM system prompt (up to 5)
- [ ] Goals created via chat appear in Goals Screen within 60 seconds (via background job)
- [ ] Empty state shows on Goals Screen when no goals exist

---

### Feature: Conversation History

- [ ] History tab shows list of past conversations
- [ ] Each item shows date, message preview, and count
- [ ] Conversations sorted newest-first
- [ ] Pagination loads more conversations on scroll
- [ ] Empty state shown when no conversations exist
- [ ] Tapping a conversation opens the read-only detail view
- [ ] All messages display in correct chronological order
- [ ] "Continue this conversation" allows sending new messages
- [ ] Conversations from current session do NOT appear in history until session ends

---

### Feature: Crisis Detection

- [ ] Crisis detection runs on EVERY user message before any other processing
- [ ] All keywords in the keyword list trigger the response
- [ ] Hardcoded response is returned (no LLM call)
- [ ] Crisis response includes hotline numbers for India and international
- [ ] Crisis flag record created in `crisis_flags` table
- [ ] Crisis detection works when NVIDIA API is down
- [ ] Normal messages are NOT incorrectly flagged as crises
- [ ] Three follow-up messages after crisis use augmented compassionate prompt
- [ ] Developer receives notification within 1 hour of any crisis flag (via Supabase webhook or email)
- [ ] `crisis_flags` table is write-only from client; no read API exists
- [ ] Unit tests: all 20+ crisis keywords, 10+ non-crisis messages that could be misidentified
- [ ] Manual QA: Test crisis flow with real device, verify no LLM is called

---

### Feature: Complete App Experience

- [ ] Splash screen correctly routes to Auth / Onboarding / Chat based on session state
- [ ] All loading states are present (no blank screens)
- [ ] All empty states are present and warm in tone
- [ ] All error states are present and maintain product tone
- [ ] App does not crash during normal use flows
- [ ] App does not crash on network disconnection
- [ ] No PII in logs
- [ ] Supabase RLS verified: users cannot access other users' data
- [ ] Rate limiting active on all endpoints
- [ ] Input sanitization verified on all user-facing inputs

---

## 19. V1 User Journey

### The Complete First-Time User Journey

**Day 0 — First Contact**

1. User downloads HumanOS.
2. Splash Screen: 1.5 seconds, then Welcome Screen.
3. User taps "Create Account" → Register Screen.
4. User enters name, email, password → taps "Create Account."
5. Account is created. User navigates to Onboarding Q1.
6. User answers 6 questions (approximately 3–5 minutes).
7. User names their companion.
8. User sees the companion's introduction message (typing animation).
9. User taps "Let's talk" → Chat Screen.
10. User sees the introduction message in the chat. The input bar is ready.
11. User sends their first real message.
12. The companion responds, using the onboarding context in the system prompt.
13. User has their first conversation — 5–15 messages.
14. User closes the app.

**Day 0 — Background (invisible to user)**
- Background job embeds all seed memories within 60 seconds.
- Background job extracts 2–3 new memories from the first conversation.

**Day 1 — Return Visit**

1. User opens app.
2. Splash Screen: Session check → valid session, onboarding complete.
3. User lands on Chat Screen.
4. The companion starts a new conversation with a warm opening: "Good to see you again. What's on your mind?"
5. The user types something about their day.
6. The LLM prompt includes: 3 memories from the previous day's onboarding + first conversation.
7. **The Magic Moment**: The companion references something from onboarding or the first conversation naturally. "How did that interview go, by the way? I've been thinking about it."
8. The user feels genuinely understood.
9. User has a second conversation — potentially longer and more personal than the first.

**Week 1 — Habit Formation**

The user's experience deepens each day:
- The companion accumulates 10–20 memories by the end of week 1.
- The AI's responses feel increasingly personalized.
- The user starts turning to the app for emotional processing, goal tracking, and intellectual conversation.
- The companion has a consistent personality and communication style.

---

## 20. V1 Technical Checklist

This checklist is for the developer to verify before submitting for beta testing.

### Infrastructure
- [ ] Supabase project created with all 7 tables
- [ ] pgvector extension enabled
- [ ] Row-Level Security enabled and tested on all tables
- [ ] NVIDIA API account with working embedding + chat endpoints
- [ ] Node.js backend deployed on Render
- [ ] `/health` endpoint returns 200 and is accessible
- [ ] Environment variables configured (no secrets in code)
- [ ] Backend accessible via HTTPS (Render provides this automatically)
- [ ] Expo project initialized and connects to backend

### Authentication
- [ ] `/auth/register` — creates user in Supabase Auth + `users` table
- [ ] `/auth/login` — returns valid JWT + refresh token
- [ ] `/auth/refresh` — silently refreshes expired JWT
- [ ] `/auth/logout` — invalidates session
- [ ] JWT validation middleware on all protected routes
- [ ] Rate limiting on auth endpoints (max 10 attempts per IP per 15 minutes)

### Memory Pipeline
- [ ] NVIDIA embedding API call returns a 1024-dimensional vector
- [ ] Memory insert with embedding vector works correctly
- [ ] pgvector cosine similarity search returns results ordered by similarity
- [ ] Memory extraction background job runs after each exchange
- [ ] Seed memory embedding job runs after onboarding
- [ ] Deduplication check works (cosine similarity > 0.85 = skip)
- [ ] Memory cap enforcement (max 100) works

### Chat Core
- [ ] Prompt builder assembles prompt correctly in all cases
- [ ] Streaming SSE response works end-to-end
- [ ] Heartbeat ping prevents iOS from killing the SSE connection
- [ ] Token budget enforcement prevents context overflow
- [ ] Crisis detection intercepts messages before LLM call
- [ ] Hardcoded crisis response served without LLM
- [ ] Messages saved to database after streaming completes

### Mobile App
- [ ] Auth screens function on iOS and Android
- [ ] Onboarding flow functions on iOS and Android
- [ ] Streaming chat works on iOS and Android physical devices
- [ ] Keychain storage works on iOS and Android
- [ ] App handles network disconnection gracefully
- [ ] App handles reconnection gracefully

### Safety
- [ ] All crisis keywords tested and verified
- [ ] No false positives on 10+ test messages
- [ ] Crisis flag logging to `crisis_flags` table verified
- [ ] Supabase webhook or email alert for crisis flags configured
- [ ] `crisis_flags` has no read API (write-only from client perspective)
- [ ] Input sanitization on all endpoints (no HTML injection, no prompt injection)

### Performance
- [ ] Memory retrieval completes in < 500ms under normal conditions
- [ ] LLM first token arrives in < 3 seconds for a normal message
- [ ] Chat screen loads in < 2 seconds
- [ ] History list loads in < 2 seconds

---

## 21. V1 Launch Checklist

### Pre-Launch (Before First User)

#### Safety Requirements (Hard Gate — Cannot Launch Without These)
- [ ] Crisis detection tested with all keywords on production environment
- [ ] Crisis response hardcoded and verified to bypass LLM
- [ ] Crisis flag logging verified in production database
- [ ] Developer notification (email/webhook) for crisis flags is working and tested
- [ ] Input sanitization verified (no prompt injection vulnerability)
- [ ] Supabase RLS verified: users cannot access other users' data
- [ ] No user PII appears in any application log

#### Legal Requirements
- [ ] Privacy Policy published and accessible from the app
- [ ] Terms of Service published and accessible from the app
- [ ] Privacy Policy explicitly states: what data is collected, how it is used, how it can be deleted
- [ ] Contact email (support@humanos.app or equivalent) is live and monitored

#### Quality Requirements
- [ ] Complete user journey tested on iOS physical device (not just simulator)
- [ ] Complete user journey tested on Android physical device
- [ ] All error states tested and verified (network off, API error, etc.)
- [ ] 0 known crashes in the main user flow
- [ ] Beta test with 5 real people (outside the developer's inner circle) completed
- [ ] Beta feedback incorporated

#### Infrastructure Requirements
- [ ] Render service is set to auto-restart on crash
- [ ] Supabase project is on a stable plan (free tier is OK)
- [ ] NVIDIA API rate limits are understood and documented
- [ ] Backend monitoring is set up (Render metrics at minimum)
- [ ] Database backups are enabled (Supabase free tier includes daily backups)

### Launch Day

- [ ] App is live on TestFlight (iOS) or direct APK (Android) for beta, OR web beta URL is live
- [ ] First 5 users are onboarded manually (developer walks them through if needed)
- [ ] Developer is actively monitoring logs and analytics on Day 1
- [ ] A way to receive user feedback is set up (simple email, Typeform, or in-app link)
- [ ] Crisis flags table is being checked at least once per day

### Post-Launch (First 4 Weeks)

**Week 1: Observe, Don't Build**
- [ ] Read every conversation (small scale — max 50 users)
- [ ] Monitor memory extraction quality (are extracted memories accurate?)
- [ ] Monitor memory retrieval quality (are the right memories surfacing?)
- [ ] Fix any crashes or blocking bugs immediately (within 24 hours)
- [ ] Do NOT add new features — only fix what's broken

**Week 2: Measure**
- [ ] Calculate Day-1 retention (target: >70%)
- [ ] Calculate Day-7 retention (target: >30%)
- [ ] Calculate average messages per session (target: >6)
- [ ] Identify any patterns in drop-off (where do users leave?)
- [ ] Conduct 3 user interviews (anyone who used the app for 7+ days)

**Week 3: Decide**
- [ ] If Day-7 retention > 30%: Continue building. Prioritize V2 features.
- [ ] If Day-7 retention 15–30%: Improve memory quality and persona before V2.
- [ ] If Day-7 retention < 15%: Do not add features. Interview 10 churned users. Understand why the magic moment isn't landing.

**Signals That V1 Is Working**
- [ ] 3+ users proactively share the app with someone else
- [ ] 10+ users report feeling "understood" by the AI
- [ ] At least 5 users reference a specific moment the AI remembered correctly
- [ ] At least 1 user says "I look forward to talking to it"
- [ ] Zero users report the AI saying something definitively wrong about them

**Signals That V1 Is NOT Working**
- Multiple users report the AI misremembers them
- Users describe it as "basically ChatGPT with memory"
- Drop-off between onboarding and first real conversation
- Users say conversations feel hollow or robotic
- Any crisis detection failure

---

## Document Sign-Off

| Role | Name | Status |
|---|---|---|
| Product Manager | — | Draft Complete |
| Engineering | — | Pending Review |
| Design | — | Pending Review |

**This document is the single source of truth for V1 engineering. Any deviation from this specification must be documented and approved before implementation.**

---

*HumanOS PRD V1.0*
*"The product lives or dies on whether strangers, after 30 days, feel that the AI genuinely knows them."*
