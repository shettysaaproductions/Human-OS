# Known Issues List (Active)

This document tracks identified bugs, limitations, and workarounds.
**Last Updated: August 2026**

---

## P1 (CRITICAL — Fix Immediately)

(No active P1 issues at this time.)

---

## P2 (Moderate)

### 1. Vision requires GEMINI_API_KEY on Render
- **Symptom:** User shares image, Nova responds with confusion or ignores it.
- **Root Cause:** `GEMINI_API_KEY` not set in Render environment variables.
- **Fix:** Get key from https://aistudio.google.com/app/apikey → add to Render → Environment → `GEMINI_API_KEY`.
- **Current behaviour (mitigation):** Without the key, Nova at least knows an image was shared and asks the user to describe it.

### 2. NACE Proactive Messages May Arrive as "Ghost Duplicates"
- **Symptom:** Occasionally a Nova proactive message appears twice in the chat.
- **Root Cause:** `checkProactiveMessages()` triggered simultaneously by AppState + notification tap.
- **Workaround:** Idempotency check exists in outreach log. If still occurs, add client-side dedup using `nova_outreach_log` ID.

### 3. OTA Updates Not Received by Test APK
- **Root Cause:** APK targets the `production` EAS channel. Previous OTA pushes used `preview` branch.
- **Fix Applied:** All OTA updates must use `--branch production`.
- **Correct Command:** `npx eas update --branch production --message "..."`

---

## P3 (Minor / Cosmetic)

### 4. Mock Authentication in Development
- **Symptom:** Signup/Login fail locally with `Invalid API key`.
- **Workaround:** Use mock UUIDs in test drivers.

### 5. PostgREST Schema Cache Desync After Migrations
- **Symptom:** API calls fail with `PGRST205` after a new SQL migration.
- **Workaround:** Supabase Dashboard → API → "Reload schema cache".

---

## Resolved Issues

| Issue | Resolution | Date |
|---|---|---|
| Messages stuck (yellow dot forever) | Fixed Android `keepalive: true` infinite fetch loop | July 2026 |
| Fallback "technical issue" message | Added NVIDIA rate-limit fallback + 70B→8B timeout fallback | July 2026 |
| Nova using "Aap" (formal) | STRICT PRONOUN RULE added to `promptBuilder.ts` | July 2026 |
| Nova echoing user's words | ANTI-ROBOT ECHO rule added | July 2026 |
| Nova interrogating with questions | INTERROGATION rule added | July 2026 |
| OTA popup never appearing | Fixed OTA branch from production → preview | July 2026 |
| `reminders.status` missing causing log spam | Migration `20260720000000_add_reminders_status.sql` | July 2026 |
| Time Hallucination near midnight | Better context awareness in auto upgrade | July 2026 |
| Repetition of exact phrases | ANTI-ROBOT REPETITION rule added | July 2026 |
| Race Condition (Double text) on rapid messages | Mutex lock per user in `chat.ts` | Aug 2026 |
| Robotic Excuse Hallucination | NO HALLUCINATING ACTIONS rule added | Aug 2026 |
| **Infinite Follow-Up Spam (P0)** | `NovaFollowupService` writes persistent `followup_suppressed_until` (4h) to DB after Level 3 | Aug 2026 |
| `fetch_recent_chats.ts` wrong table | Fixed `messages` → `chat_history` | Aug 2026 |
| `nova_behavioral_patches` missing column | Migration `023_add_source_log_to_patches.sql` | Aug 2026 |
| Missing `axios` and `@google/generative-ai` | Ran `npm install --prefer-offline` | Aug 2026 |
| **Working memory invisible to Nova** | Fixed: all WM keys now injected. Previously only `current_focus`+`active_goals` shown | Aug 2026 |
| **Sleep signal ignored → 71-msg spam** | Sleep detection in `queueFollowup()`: sleep=8h, busy/bye=2h DB suppression | Aug 2026 |
| **Web search broken for Hinglish queries** | Fast-path keyword matching added to `evaluateSearchNeed()` | Aug 2026 |
| **Vision confused when no GEMINI key** | Fallback description returned so Nova asks user to describe image | Aug 2026 |
| **Image ACKNOWLEDGEMENT rule missing** | 3 new ANTI-ROBOT rules: IMAGE ACKNOWLEDGEMENT, SLEEP RESPECT, WORKING MEMORY IS GROUND TRUTH | Aug 2026 |
| **Fabrication of abbreviation meaning (RNR → "Ram Nawami")** | Strengthened ANTI-ROBOT FABRICATION rule — must ASK what an unknown term means, never guess | Aug 2026 |
| **Memory Amnesia (forgot 5-month-old son; forgot same-session metro context)** | Strengthened ANTI-ROBOT MEMORY ACCOUNTABILITY + SAME-SESSION AMNESIA / CONTEXT rules (zero tolerance) | Aug 2026 |
