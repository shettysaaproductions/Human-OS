# HumanOS Specific Agent Rules

---

## 🔴 MANDATORY SESSION BOOT — READ FIRST ON EVERY SESSION

Before doing ANY work in this repository, you MUST read and internalize the following documents IN ORDER. These are the brain of the project. Without them, you will make stale decisions:

1. `SESSION_BOOT.md` — Current production status, all 7 engines, next sprint, key commands
2. `NOVA_ARCHITECTURE.md` — Full 7-engine architecture, cognition pipeline, dual-key strategy
3. `MEMORY.md` — All epochs, known bugs, OTA channel rules, NVIDIA config, Git workflow
4. `MODEL_ROUTER.md` — NVIDIA dual-key routing rules
5. `KNOWN_ISSUES.md` — Active bugs and resolved issues
6. `IMPLEMENTATION_QUEUE.md` — What's done, what's next (P0 → P1 → P2)
7. `LEARNING_LOOP.md` — How Nova self-improves, behavioral failure thresholds
8. `NOVA_PRINCIPLE.md` — Non-negotiable behavioral constitution (read before any feature work)

**Do NOT skip this boot sequence.** If you are a smaller/faster model, read these files before touching any code. They tell you everything you need to know about the current state of the system.

---

## ⚠️ FREE-TIER LIMITS — NEVER VIOLATE THESE

The entire system runs on free tiers. Violating these limits WILL break the app for real users.

| Resource | Hard Limit | Rule |
|---|---|---|
| **Supabase DB** | 500MB storage | Never store logs, documents, or raw chat history dumps in DB. Use memory decay + pruning. |
| **Supabase Bandwidth** | 1GB/month | Never run batch queries that fetch all users' full chat history. Always paginate (limit 20-50). |
| **Supabase Auto-sleep** | Pauses after 7 days inactivity (free tier) | NACE pulse every 15 mins keeps it awake during active use. Do NOT add more frequent polling. |
| **Render RAM** | 512MB | Never load large files into memory. Stream responses. Keep background jobs lightweight. |
| **Render Auto-sleep** | Sleeps after 15 mins no HTTP traffic | NACE + reminder polling (every 10s) keeps Render awake during active hours. |
| **NVIDIA Key 1** | Free rate limit (~10 RPM) | User-facing chat ONLY. Never call from background schedulers. |
| **NVIDIA Key 2** | Free rate limit (~10 RPM) | Background engines ONLY (Reflection, NACE, SelfImprovement, MomentEngine). |
| **EAS OTA** | Free tier | Target `preview` branch ALWAYS. Never push to `production` for APK installs. |

**If a feature would violate any limit above — redesign it to be async, paginated, or scheduled.**

---

## 🚀 The "Auto Upgrade" Protocol

Triggered when user types: `"auto upgrade"`, `"upgrade"`, or similar.

### Step 0: Session Boot (If Not Already Done)
Read all 8 documents listed in the MANDATORY SESSION BOOT section above. Understand the full current state before proceeding.

### Step 1: Pull Recent Chat Logs
```bash
cd backend
npx tsx scripts/fetch_recent_chats.ts
```
This fetches the last 20 messages from Supabase `chat_history`. Study the output carefully — especially Nova's replies, the gaps between messages, and any TELEMETRY META.

### Step 2: Deep Analysis — ALL Aspects of the Chat Interface

Analyze the logs for EVERY dimension listed below. Think like a therapist examining a patient's communication patterns. Do NOT rush this step.

#### A. Behavioral Failures (Anti-Robot Rules)
- **Echoing**: Nova repeating the user's exact words as a question. e.g. "Maine join piya" → "Join peeke kaisa lag raha hai?" ❌
- **Formality**: Nova using "Aap", "Aapka", "Aapko" instead of "Tu", "Tera", "Tum" ❌
- **Interrogation Spam**: Nova ending 3+ consecutive messages with "?" ❌
- **Time Hallucination**: Nova claiming a time of day (e.g. "ab subah ho gayi") that wasn't established by the user ❌
- **Repetition**: Same opener/topic in 3+ consecutive Nova messages ❌

#### B. Contextual Intelligence Failures
- **Reply Intent Blindness**: User replied to a specific message (using swipe-to-reply), but Nova ignored the `reply_to_content` and treated it as a new topic ❌
- **Conversation Phase Mismatch**: User said "gn" or "bye" but Nova kept pushing new topics ❌
- **Gap Ignorance**: User came back after 6+ hours but Nova continued the old thread as if no time passed ❌
- **Stale Memory**: Nova referenced a fact the user already corrected without acknowledging the correction ❌

#### C. Memory & Knowledge Failures
- **Core Fact Forgetting**: Nova forgot the user's name, profession, relationship status, or other key profile facts ❌
- **Goal Abandonment**: A user mentioned a goal 2+ weeks ago but Nova never followed up ❌
- **Emotional Flatness**: User expressed strong emotion (joy, stress) but Nova's response tone didn't match ❌

#### D. Technical / Delivery Failures
- **Stuck Messages**: Any message with the "yellow dot" pattern — user sent, Nova never replied ❌
- **Double Messages**: Nova sent the same message twice (NACE + chat trigger simultaneously) ❌
- **Missing Stagger**: Multiple Nova bubbles arrived at exactly the same time (no 5-10s delays) ❌

### Step 3: Create Implementation Plan Artifact

Before writing a single line of code, create or update `implementation_plan.md` (artifact at conversation artifact path).

The plan MUST contain:
1. **Detected Flaws** — exact quotes from the chat logs showing each failure
2. **Root Cause Analysis** — which file/function caused it
3. **Proposed Fix** — exact code change or prompt rule to add
4. **Files to Modify** — list every file that needs changing
5. **Limits Check** — confirm no free-tier limits will be violated
6. **Documents to Update** — list every .md doc that needs updating after the fix

Present the plan and stop. Wait for user to say "proceed."

### Step 4: Apply All Code Fixes

For prompt/behavioral fixes → patch `backend/src/services/promptBuilder.ts`
For memory/context fixes → patch relevant service in `backend/src/services/`
For frontend fixes → patch relevant file in `mobile/src/`

**CRITICAL RULES WHILE CODING:**
- Always run `npm run build` in `backend/` after TypeScript changes to catch errors BEFORE pushing
- Never introduce duplicate variable declarations (`const x` declared twice in same scope)
- Never use `const async_mode = req.body.async_mode` if already destructured above
- Always paginate Supabase queries (never `select *` without `.limit()`)
- Keep background jobs non-blocking — wrap in `Promise.resolve().then(() => ...)` or use `setImmediate`

### Step 5: Update ALL Relevant Documents

After applying fixes, update every document that is now stale. The following docs MUST be checked:

| Document | Update When |
|---|---|
| `NOVA_ARCHITECTURE.md` | Any engine, pipeline, or cognition flow changed |
| `MEMORY.md` | New bugs found, bugs resolved, new constraints discovered |
| `KNOWN_ISSUES.md` | Bug fixed (move to Resolved) or new bug found (add to Active) |
| `IMPLEMENTATION_QUEUE.md` | Feature completed (move to archive) or new feature planned |
| `LEARNING_LOOP.md` | New behavioral failure pattern identified |
| `SESSION_BOOT.md` | Any change to current production status or next sprint |
| `MOMENT_ENGINE.md` | Any change to MomentEngineService or Time Capsule logic |
| `MODEL_ROUTER.md` | Any change to NVIDIA key routing |
| `MAGICAL_MOMENTS.md` | New moment type added or existing type modified |
| `POST_ALPHA_PLAN.md` | Phase completed or new phase planned |
| `SYSTEM_LAYERS.md` | New layer component added or removed |

### Step 6: Restart Local Backend

Kill any running backend task and restart fresh:
```bash
cd backend && npm run start
```
Verify no errors in first 30 seconds of output before proceeding.

### Step 7: Push Backend to GitHub Main

```bash
cd <workspace root>
git add .
git commit -m 'Auto Upgrade: <brief description of what was fixed>'
git push origin main
```
This triggers automatic Render deployment. **User manually triggers Render redeploy if needed.**

### Step 8: Push OTA to Mobile (If Frontend Files Changed)

If ANY file in `mobile/src/` was modified:
```bash
cd mobile
npx eas update --branch preview --message "<brief description>"
```

**CRITICAL:** Always use `--branch preview`. NEVER use `--branch production` for APK installs.
The installed APK listens to the `preview` EAS channel, NOT `production`.

### Step 9: Final Summary to User

Present a complete summary covering:
1. **Behavioral Flaws Detected** — exact patterns found with example quotes
2. **Root Causes** — which file/function was responsible
3. **Fixes Applied** — exact rule added or code changed
4. **Documents Updated** — list all docs that were updated
5. **Git Push** — confirm main branch updated (Render will auto-deploy)
6. **OTA Status** — confirm whether OTA was pushed and to which branch
7. **What Nova Can Now Do** — describe the behavioral improvement in human terms

---

## 🧠 How to Think About Nova's Intelligence

When analyzing or building any feature, always think through these lenses:

### The 7 Awareness Dimensions Nova Must Have:
1. **Time Awareness** — What time is it for the user? Morning/night changes everything.
2. **Gap Awareness** — How long since last message? 2 mins vs 8 hours = completely different greeting.
3. **Phase Awareness** — Opening / Flowing / Winding Down / Re-Entry? Match Nova's energy.
4. **Emotional Awareness** — Is the user's emotional valence rising, falling, or flat?
5. **Reply Intent Awareness** — Did the user swipe-to-reply a specific bubble? That's context.
6. **Memory Awareness** — What does Nova know about this user from past sessions?
7. **Self-Awareness** — What behavioral mistakes has Nova made recently? (behavioral patches)

### The 3 Questions Before Any Feature:
1. Does this feature respect the free-tier limits? (Supabase 500MB, Render 512MB, NVIDIA ~10 RPM)
2. Does this feature deepen the user-Nova relationship, or just add noise?
3. Does this feature respect user privacy and avoid manipulation/guilt-tripping?

---

## 📋 Document Philosophy

> **Documents turn things into reality. What we write happens.**

Every significant change MUST be reflected in the relevant documents. A code change without a doc update is an invisible change — the next AI session (or the next developer) will not know it happened. Treat documentation updates as equally important as code changes.

The 8 Session Boot documents are Nova's living brain. They must always reflect current reality — not aspirations, not stale plans.
