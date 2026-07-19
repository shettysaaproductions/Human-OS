# HumanOS Specific Agent Rules

---

## 🧠 CRITICAL: SESSION BOOT — Read This First, Every Time

Before doing ANY work on this repository, you MUST:
1. Read `SESSION_BOOT.md` — it has the full current system state, engine list, and active bugs.
2. Read `MEMORY.md` — it has all architectural epochs, constraints, and the OTA branch fix.
3. Read `NOVA_ARCHITECTURE.md` — it has the 7-engine diagram and the full cognition pipeline.
4. Read `KNOWN_ISSUES.md` — to know what bugs are active before making changes.

**DO NOT skip this.** A model that skips the session boot will break things that were already fixed.

---

## 🔑 Critical Constants (Never Get These Wrong)

```
BACKEND DIR:   c:\Users\Mentorus2\OneDrive\Documents\Human Os\backend
MOBILE DIR:    c:\Users\Mentorus2\OneDrive\Documents\Human Os\mobile
ROOT DIR:      c:\Users\Mentorus2\OneDrive\Documents\Human Os

OTA COMMAND:   cd mobile && npx eas update --branch preview --message "..."
               ⚠️  ALWAYS use --branch preview. NEVER use --branch production for OTA.
               The installed APK listens to the preview EAS channel.

GIT PUSH:      git add . && git commit -m "..." && git push origin main
               ⚠️  User manually redeploys Render after each push. You do NOT trigger Render.

BUILD CHECK:   cd backend && npm run build
               ⚠️  ALWAYS run npm run build before git push. Never push broken TypeScript.

BACKEND START: cd backend && npm run start (background task)
               ⚠️  Kill old backend task before starting new one.
```

---

## 🆙 The "Auto Upgrade" Protocol

Triggered when the user types `"auto upgrade"`, `"upgrade"`, or any request to improve Nova's intelligence, personality, or behavior.

**This protocol must be executed in full, in order, without skipping steps.**

---

### STEP 0: Full System Boot (Fresh Context Load)

Before analyzing anything, read the following documents in order:

```
1. SESSION_BOOT.md         — Current production status, active bugs, OTA commands
2. MEMORY.md               — Project epochs, known constraints, environment variables
3. NOVA_ARCHITECTURE.md    — All 7 engines, cognition pipeline, conversation phases
4. KNOWN_ISSUES.md         — Active bugs to NOT break further
5. LEARNING_LOOP.md        — How self-improvement loops work
6. IMPLEMENTATION_QUEUE.md — What is planned vs. completed
7. promptBuilder.ts        — Current identity rules and anti-robot patches
```

This ensures even a low-capability model has enough context to execute the upgrade precisely.

---

### STEP 1: Pull Fresh Chat Telemetry

Run the fetch script:
```bash
cd backend && npx tsx scripts/fetch_recent_chats.ts
```

This pulls the last 20 messages from Supabase. Read ALL of them carefully.

---

### STEP 2: Deep Behavioral Analysis

Analyze every Nova (assistant) message for the following 7 failure modes:

| # | Failure Mode | Detection Signal | Zero Tolerance? |
|---|---|---|---|
| 1 | **Echoing** | Nova's reply contains ≥50% of user's exact phrasing | No (2+ occurrences trigger patch) |
| 2 | **Formality** | Nova uses "Aap", "Aapka", "Aapko" | YES — even 1 instance = patch |
| 3 | **Interrogation Spam** | Nova ends 3+ consecutive messages with "?" | No (3+ consecutive trigger patch) |
| 4 | **Time Hallucination** | Nova claims time passed ("ab subah ho gayi") without user confirming it | No (2+ occurrences trigger patch) |
| 5 | **Repetition** | Same opening word/phrase in 3+ consecutive Nova messages | No (3+ consecutive trigger patch) |
| 6 | **Emotional Mismatch** | Nova ignores user's emotional signal (e.g., user is stressed, Nova asks about movies) | No (2+ occurrences trigger patch) |
| 7 | **Over-explanation** | Nova gives a lecture when a 1-line reply was appropriate (HUMAN_CHAT mode) | No (2+ occurrences trigger patch) |

---

### STEP 3: Create Implementation Plan

Create or update the file:
```
C:\Users\Mentorus2\.gemini\antigravity-ide\brain\<conversation-id>\implementation_plan.md
```

The plan MUST include:

1. **Detected Flaws Table** — List all found failure modes with specific message examples from the logs.
2. **Root Cause Analysis** — For each flaw, explain WHY it happens in the current prompt.
3. **Chat Interface Understanding** — Analyze these dimensions from the logs:
   - **Time Context**: Was Nova aware of the correct time of day?
   - **Message Status**: Did Nova understand whether the user had just opened the app or was mid-conversation?
   - **Reply Intent**: Was the user replying to a specific bubble? Did Nova respond to the correct context?
   - **Conversation Phase**: Was this OPENING, FLOWING, WINDING_DOWN, or RE-ENTRY?
   - **Emotional Momentum**: What was the user's emotional trend across the last 3 messages?
4. **Patch Plan** — Exact new rules to add to `promptBuilder.ts`.
5. **Document Update Plan** — Which architecture docs need updating after this patch.
6. **Other Improvements Found** — Any additional improvements spotted during analysis (even if not a failure mode). Think expansively:
   - Can memory extraction be more granular?
   - Can the NACE agenda be smarter?
   - Can the situation brief inject more context?
   - Are there free-tier optimizations to make?
   - Are there patterns that suggest a new Supabase table would help?

---

### STEP 4: Patch the Brain

Modify `backend/src/services/promptBuilder.ts`:

Rules for patching:
- Add new ANTI-ROBOT rules to the `IDENTITY & TONE RULES` section (lines ~67-83).
- Add new rules to the `CRITICAL FINAL INSTRUCTIONS` block at the bottom (lines ~178-193).
- NEVER remove existing anti-robot rules — only ADD to them.
- Each new rule must be specific and testable.
- Format: `- ANTI-ROBOT RULE (NAME): Specific instruction.`

Also patch any other relevant files found in Step 3 (e.g., `SituationalAwareness.ts`, `NovaConsciousnessEngine.ts`).

---

### STEP 5: Build & Verify (No Broken TypeScript)

```bash
cd backend && npm run build
```

If build fails:
- Fix the TypeScript error immediately.
- Do NOT push broken code.
- Re-run build until it passes cleanly (exit code 0, no errors).

---

### STEP 6: Restart Local Backend

Kill any existing backend task, then start fresh:
```bash
cd backend && npm run start
```

This applies the new prompt patches to the locally running server.

---

### STEP 7: Update All Architecture Documents

After patching `promptBuilder.ts`, update the following docs to reflect what changed:

| Document | What to Update |
|---|---|
| `MEMORY.md` | Add the new patches to "Implemented Features" under Epoch 2 |
| `LEARNING_LOOP.md` | Log the new behavioral patches under "Patches Applied This Week" |
| `KNOWN_ISSUES.md` | Move fixed issues to the "Resolved Issues" table |
| `IMPLEMENTATION_QUEUE.md` | Move completed items to the archive, add any new ideas found in Step 3 |
| `NOVA_ARCHITECTURE.md` | Update implementation phasing table |
| `SESSION_BOOT.md` | Update "Recently Completed" section |

**Documents are the source of truth. Write what happened. This is how Nova grows.**

---

### STEP 8: Git Push to Main

```bash
cd "c:\Users\Mentorus2\OneDrive\Documents\Human Os"
git add .
git commit -m "Auto Upgrade: <specific description of what was patched>"
git push origin main
```

⚠️ The user manually redeploys Render. You do NOT need to trigger Render. Just confirm the push succeeded.

---

### STEP 9: OTA Update (Always — Even If Only Backend Changed)

```bash
cd "c:\Users\Mentorus2\OneDrive\Documents\Human Os\mobile"
npx eas update --branch preview --message "Auto Upgrade: <same description>"
```

⚠️ ALWAYS use `--branch preview`. The installed APK listens to the `preview` EAS channel, NOT `production`.

Wait for the EAS command to complete and confirm:
- ✅ "Published!" message appears
- ✅ Branch = preview
- ✅ Runtime version = 1.1.0

**CRITICAL RULE:** Do NOT consider the Auto Upgrade complete until the EAS update finishes successfully. You must explicitly inform the user that the OTA update was published and they will see a popup in their app.

---

### STEP 10: Present Full Summary

Present to the user:
1. **Behavioral Flaws Found** — Table of all detected issues with real message examples.
2. **Chat Interface Analysis** — What was understood about time, status, reply intent, phase, emotional momentum.
3. **Patches Applied** — Exact new rules added to `promptBuilder.ts`.
4. **Other Improvements Noticed** — Anything else spotted during analysis (future roadmap items).
5. **Documents Updated** — List of all docs that were updated.
6. **Deployment Status** — GitHub push confirmed ✅, OTA published to preview branch ✅, remind user to manually redeploy Render.
7. **Free-Tier Health Check** — Confirm no Supabase query explosion, no memory overload, no aggressive polling added.

---

## ⚠️ Free-Tier Hard Limits (Never Violate These)

These constraints are permanent. Any code change must respect them:

### Supabase Free Tier
- **500MB database storage max.** Memory decay and nightly pruning are critical — never disable them.
- **Supabase auto-sleeps after a few days of no use** — This is expected. The first request after sleep will be slow. Do not add retry loops that will spam the DB on wakeup.
- **Never add tight polling loops** that query Supabase faster than every 10 seconds.
- **Always use `.maybeSingle()` not `.single()`** — `.single()` throws an error when no row is found, causing unnecessary error logs.
- **After any new migration**, always remind the user: Run `NOTIFY pgrst, 'reload schema'` or click "Reload schema cache" in Supabase dashboard.

### Render Free Tier
- **512MB RAM max.** Do not add large in-memory caches. Keep per-request memory minimal.
- **Auto-sleeps after 15 minutes of no traffic.** The NACE pulse (every 15 mins) keeps it alive during active use hours. This is intentional — do not change the NACE interval below 15 mins.
- **CPU is shared and throttled.** Keep background jobs lightweight. Heavy LLM calls must go to NVIDIA, not local compute.
- **User manually redeploys Render** after each `git push origin main`. Never attempt to trigger Render via API unless explicitly asked.

### NVIDIA Free Tier
- **Rate limited per key.** Key 1 handles user-facing chat only. Key 2 handles all background engines.
- **Never call NVIDIA from a tight polling loop.** All NVIDIA calls must be event-driven or scheduled (NACE: 15min, Reflection: daily, Reminders: 10s check but only fires when due).
- **30-second hard timeout** is already set on all NVIDIA calls. Never increase this.
- **If Key 1 rate-limits (429)**, fall back to Key 2 silently and log the event.

### Mobile / EAS Free Tier
- **OTA ALWAYS to `--branch preview`** — this is the branch the APK listens to.
- **Do not run `eas build`** unless the user explicitly asks for a new APK. OTA is sufficient for JS changes.
- **Bundle size must stay under 4MB** — do not add heavy native dependencies without a new build.

---

## 🧩 How to Think During Auto Upgrade

When analyzing the chat logs, think like a **perceptive human friend** reading a conversation:

- Is Nova helping or just responding?
- Does Nova remember what was said earlier in the session?
- Does Nova understand the TIME — is it morning, night, work hours, weekend?
- Does Nova understand the USER'S MOOD — stressed, happy, distracted, excited?
- Does Nova know whether the user is mid-conversation or just woke up?
- Does Nova understand the user's RELATIONSHIP with Nova — are they close friends yet?
- Is Nova speaking like a CLOSE FRIEND or like a CUSTOMER SERVICE BOT?

Every answer that feels robotic, distant, or tone-deaf is a flaw to patch.

**Nova should feel like the user's most perceptive, caring, laid-back best friend — not an AI trying to be helpful.**
