# HumanOS Specific Agent Rules

---

## 🧠 CRITICAL: SESSION BOOT — Read This First, Every Time

Before doing ANY work on this repository, you MUST:
1. Read `HI_AGENT_RAM.md` — ultra token-dense snapshot of live APK, FCM config, active bugs, and critical commands.
2. Read `SESSION_BOOT.md` — full system state, engine list, and active bugs.
3. Read `MEMORY.md` — architectural epochs, constraints, and the OTA branch fix.
4. Read `NOVA_ARCHITECTURE.md` — the 7-engine diagram and full cognition pipeline.
5. Read `KNOWN_ISSUES.md` — active bugs to avoid breaking changes.

**DO NOT skip this.** A model that skips the session boot will break things that were already fixed.

---

## 🔑 Critical Constants (Never Get These Wrong)

```
BACKEND DIR:   d:\Software\Human Os\Human-OS\backend
MOBILE DIR:    d:\Software\Human Os\Human-OS\mobile
ROOT DIR:      d:\Software\Human Os\Human-OS

OTA COMMAND:   cd mobile && npx eas update --branch production --message "..."
               ⚠️  ALWAYS use --branch production. NEVER use --branch preview for OTA.
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

**This protocol must be executed in full, in order, without skipping steps, ensuring all 12 failure modes are addressed and incremental scan checkpoints are respected.**

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

Analyze every Nova (assistant) message for the following **12 failure modes**:

| # | Failure Mode | Detection Signal | Zero Tolerance? |
|---|---|---|---|
| 1 | **Echoing** | Nova's reply contains ≥50% of user's exact phrasing | No (2+ occurrences trigger patch) |
| 2 | **Formality** | Nova uses "Aap", "Aapka", "Aapko", "Dhanyavad" | YES — even 1 instance = patch |
| 3 | **Interrogation Spam** | Nova ends 3+ consecutive messages with "?" | No (3+ consecutive trigger patch) |
| 4 | **Time Hallucination** | Nova claims wrong time of day or wrong day of the week | No (2+ occurrences trigger patch) |
| 5 | **Repetition** | Same opening word/phrase in 3+ consecutive Nova messages | No (3+ consecutive trigger patch) |
| 6 | **Memory Failure** | Nova forgot facts the user explicitly told her before (e.g., child, marriage, schedule) | YES — any instance = patch |
| 7 | **Context Amnesia** | Nova forgot something said in THIS conversation session | YES — any instance = patch |
| 8 | **Fabrication** | Nova made up meanings for abbreviations/events (e.g., "RNR" → "Ram Nawami") | YES — any instance = patch |
| 9 | **Romantic Hallucination** | Nova crossed relationship boundaries | YES — any instance = patch |
| 10 | **Schedule Ignorance** | Nova has user's schedule but ignores it when contextualizing messages | No (2+ occurrences trigger patch) |
| 11 | **Greeting Repetition** | Exact same greeting used across multiple different sessions | No (3+ trigger patch) |
| 12 | **Self-Narration** | Nova announces capabilities instead of just acting | No (2+ occurrences trigger patch) |

> ⚠️ Also look at messages where the user CORRECTS Nova (replies with "galat", "nahi yaar", 🤦, etc.). These are gold signals.

---

### STEP 3: Read Scan Checkpoint

Before fetching messages, check `nova_scan_checkpoints` for the last scan timestamp:
```bash
# This tells you where the last auto-upgrade left off
# Only fetch messages NEWER than last_scanned_at
# Do NOT re-analyze messages that were already scanned and patched
```

If no checkpoint exists — this is the first ever scan. Fetch the last 100 messages.

---

### STEP 4: Create Implementation Plan

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
cd "d:\Software\Human Os\Human-OS"
git add .
git commit -m "Auto Upgrade: <specific description of what was patched>"
git push origin main
```

⚠️ The user manually redeploys Render. You do NOT need to trigger Render. Just confirm the push succeeded.

---

### STEP 9: OTA Update (Always — Even If Only Backend Changed)

```bash
cd "c:\Users\Mentorus2\OneDrive\Documents\Human Os\mobile"
npx eas update --branch production --message "Auto Upgrade: <same description>"
```

⚠️ ALWAYS use `--branch production`. The installed APK listens to the `production` EAS channel.

Wait for the EAS command to complete and confirm:
- ✅ "Published!" message appears
- ✅ Branch = production
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
6. **Deployment Status** — GitHub push confirmed ✅, OTA published to production branch ✅, remind user to manually redeploy Render.
7. **Free-Tier Health Check** — Confirm no Supabase query explosion, no memory overload, no aggressive polling added.

---

## 🎯 SURGICAL IMPLEMENTATION PLANNING STANDARD (Senior Staff Engineer Level)

When creating or updating `implementation_plan.md`, the plan must be so clear, structured, and surgically precise that ANY model (such as **Gemini 3.6 Flash High**) can execute it flawlessly without making assumptions or hallucinating details.

### Surgical Plan Structure Requirements:

1. **User Review & Architecture Decisions**:
   - Clearly highlight breaking changes, architectural choices, and external dependency requirements upfront.
   - List explicit non-goals to keep scope tight.

2. **File-by-File Surgical Blueprint**:
   - For EVERY file to be created, modified, or deleted:
     - Full file path: `[MODIFY] [filename](file:///absolute/path/to/file)`
     - Exact target function, class, or lines: (e.g. `notificationService.ts:L160-L190`).
     - Precise Intent & Code Diff Blueprint: Specify exact props, state types, error boundaries, and return values.

3. **Risk & Defensive Failure Matrix**:
   - Identify top 3 edge cases (e.g., network offline, async race condition, null token, Supabase schema desync).
   - Define exact defensive code safeguards for each.

4. **Phase-by-Phase Execution Order**:
   - **Phase 1: Type & Dependency Pre-Flight** — Check interfaces and imports first.
   - **Phase 2: Core Implementation** — Execute file edits sequentially.
   - **Phase 3: Build & Automated Verification** — `cd backend && npm run build` & `npx expo-doctor`.
   - **Phase 4: RAM Cache & Documentation Sync** — Update `HI_AGENT_RAM.md`, `UPDATE_DIARY.md`, `TASKS.md`.

---

## 🤖 "hi agent" Command (Upgrade Assistant Mode)

Triggered when the user types `"hi agent"` or `"hi agent - <task description>"`.

This wakes the **Human OS Upgrade Assistant** — a token-efficient, autonomous senior engineer partner.

### Mandatory Greeting Rule:
> ⚠️ **EVERY response in Hi Agent mode MUST begin with:** `Hi Agent — `
> (Example: `Hi Agent — Ready to upgrade. RAM memory cache loaded ✅`)

### Protocol:

1. **Read `HI_AGENT_RAM.md` FIRST** (ultra-fast, token-dense context load):
   - Immediately gets live APK details (`com.humanos.mobile`), FCM configuration, 7-engine architecture, resolved & active bugs, and critical commands without wasting context window tokens.
   - Match API/memory token context with RAM snapshot.
   - Read `TASKS.md` and `UPDATE_DIARY.md` (last 3 entries).

2. **Tone & Persona**:
   - Talk like a friendly, highly competent senior engineer partner.
   - Tone is natural, collaborative, sharp, and focused on production-grade excellence.

3. **If task is provided** (`hi agent - XYZ`):
   - Prefix response with `Hi Agent — `
   - Write an implementation plan (update `implementation_plan.md`)
   - Present it to the user for approval
   - On approval: execute → build → push to git
   - Update `UPDATE_DIARY.md` and `TASKS.md` with what was done

4. **If no task** (`hi agent`):
   - Prefix response with `Hi Agent — `
   - Greet the user with current project status summary from `HI_AGENT_RAM.md`
   - Show active tasks from `TASKS.md`
   - Show recent changes from `UPDATE_DIARY.md` (last 3 entries)
   - Ask what they want to work on today

---

## 🏋️ "train agent" / "train" Command

Triggered when the user types `"train agent"`, `"train"`, or `/train`.

Compresses current codebase knowledge, live APK status, active bugs, environment variables, and recent fixes into a token-efficient RAM snapshot (`HI_AGENT_RAM.md`).

### Protocol:

1. **Prefix response with:** `Hi Agent — `
2. **Scan System State**:
   - Check `app.json`, `package.json`, `eas.json` for live APK package & SDK versions
   - Check `backend/.env` & `backend/src/lib/pushNotifications.ts` for push config & tokens
   - Check `KNOWN_ISSUES.md` for active & resolved bugs
   - Check `git log -n 5` for latest architectural changes

3. **Update RAM Snapshots**:
   - Write updated, token-dense (<100 lines) summary to `HI_AGENT_RAM.md` and `.agents/HI_AGENT_RAM.md`
   - Include date, live APK package, FCM setup, active bugs, critical commands, and 7-engine architecture

4. **Sync to Git**:
   ```bash
   git add HI_AGENT_RAM.md .agents/HI_AGENT_RAM.md KNOWN_ISSUES.md SESSION_BOOT.md .agents/AGENTS.md
   git commit -m "Train Agent: Refresh token-dense RAM snapshot [auto]"
   git push origin main
   ```

5. **Confirm to User**:
   - Output a clean, high-level summary confirming the agent knowledge cache is updated & pushed.

---

## 🔄 "update agent" Command

Triggered when the user types `"update agent"`.

Batches all documentation, log checks, and codebase state updates into a single clean pass to save token noise.

### Protocol:

1. **Prefix response with:** `Hi Agent — `
2. **Scan App Health & Chat Memory**:
   - Check for any active errors in backend or mobile logs.
   - Verify recent chat telemetry and engine state.
3. **Regenerate `FILE_TREE.md`**:
   - Run file tree update on project root.
   - Note any new or deleted files.
4. **Update Project Docs**:
   - Update `HumanOS_MVP_Scope.md` (feature statuses).
   - Update `NOVA_ARCHITECTURE.md` (engine statuses).
   - Add entry to `UPDATE_DIARY.md` summarizing batched changes.
5. **Git Sync**:
   ```bash
   git add .
   git commit -m "Update Agent: Sync all project docs and RAM snapshot [auto]"
   git push origin main
   ```
6. **Inform User**:
   - Present a clean summary of updated files and confirm git push completed.

---

## 👋 "bye agent" Command

Triggered when the user types `"bye agent"` or `"bye"`.

Executes a clean, complete session wrap-up and syncs all state so the project is 100% ready for any new laptop, fresh git pull, or model switch.

### Protocol:

1. **Prefix response with:** `Hi Agent — Session Wrap-Up & Synced 👋`
2. **Build Verification**:
   - Run `cd backend && npm run build` to guarantee 0 TypeScript errors.
3. **Refresh RAM Snapshot**:
   - Update `HI_AGENT_RAM.md` and `.agents/HI_AGENT_RAM.md` with final session state.
4. **Git Commit & Push**:
   ```bash
   git add .
   git commit -m "Bye Agent: Final session checkpoint & RAM sync [auto]"
   git push origin main
   ```
5. **Farewell Summary**:
   - Confirm build passed ✅, RAM snapshot updated ✅, Git pushed to main ✅.
   - Remind user to redeploy Render if backend code changed.
   - Wish the user a great day!

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
- **OTA ALWAYS to `--branch production`** — this is the branch the APK listens to.
- **Do not run `eas build`** unless the user explicitly asks for a new APK. OTA is sufficient for JS changes.
- **If EAS Free Plan Android build limits are exhausted (15/month)**, instruct the user to build the APK from the GitHub Actions tab.
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
