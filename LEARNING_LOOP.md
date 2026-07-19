# Learning Loop Process Spec

**Mission:** Define the continuous, evidence-based process that turns Nova's own behavioral data into permanent self-improvements — making Nova smarter with every passing week.

---

## 1. The Two Learning Loops

### Loop A: Manual "Auto Upgrade" (Triggered by User)
Triggered when the user types `"auto upgrade"` or `"upgrade"`:
1. Run `backend/scripts/fetch_recent_chats.ts` to pull last 20 messages from Supabase.
2. Analyze for behavioral failures:
   - **Echoing**: Parroting what the user just said as a question
   - **Formality**: Using "Aap" or "Aapka" instead of "Tu"/"Tera"/"Tum"
   - **Interrogation**: Ending every message with a question
   - **Time Hallucination**: Claiming time has passed without evidence
   - **Repetition**: Same topic/opener in consecutive messages
3. Create `implementation_plan.md` artifact with deep analysis.
4. Patch `backend/src/services/promptBuilder.ts` with strict anti-robot rules.
5. Build, restart backend, push to GitHub.
6. Patches accumulate over time — Nova never forgets a lesson.

### Loop B: Autonomous Weekly Self-Improvement (Automated)
Runs every Sunday night via `NovaSelfImprovementService`:
1. Reads the last 100 messages from Supabase for all active users.
2. Uses NVIDIA Key 2 (background) to analyze for the same 5 failure modes.
3. If any score exceeds threshold → writes a new `nova_behavioral_patches` row to Supabase.
4. `PromptBuilder` loads all active patches from DB at startup → Nova patches herself.
5. A human does not need to approve or trigger this — Nova does it automatically.

---

## 2. Behavioral Failure Thresholds

| Failure Mode | Detection Signal | Threshold to Patch |
|---|---|---|
| **Echoing** | Nova's reply contains >50% of user's exact words | 2+ occurrences in 100 messages |
| **Formality** | "Aap" or "Aapka" in Nova's reply | 1 occurrence (zero tolerance) |
| **Interrogation** | Nova ends 3+ consecutive replies with "?" | 3+ consecutive occurrences |
| **Time Hallucination** | Nova references a time-of-day not established by user context | 2+ occurrences in 100 messages |
| **Repetition** | Same opening word/phrase used in 3+ consecutive Nova messages | 3+ consecutive occurrences |

---

## 3. `nova_behavioral_patches` Table

Each auto-detected (or manually triggered) improvement is stored permanently:

```sql
CREATE TABLE IF NOT EXISTS nova_behavioral_patches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patch_rule TEXT NOT NULL,
  flaw_type TEXT NOT NULL,
  severity TEXT DEFAULT 'medium',
  created_at TIMESTAMPTZ DEFAULT now(),
  is_active BOOLEAN DEFAULT true
);
```

- Nova's **entire learned history** lives in this table
- Patches are NEVER automatically deleted (only manually archived)
- This is Nova's long-term behavioral memory — her self-awareness record

---

## 4. Weekly Product Review (Human-Layer)

Every 7 days, the founder reviews:

### Required Sections:
1. **Most Natural Moments:** Messages that felt genuinely like a best friend
2. **Most Robotic Moments:** Where Nova felt like a chatbot
3. **Behavioral Patches Applied This Week:** What `NovaSelfImprovementService` fixed
4. **User Experience Wins:** Features that made the app feel alive
5. **Stuck/Error Events:** Any message delivery failures, ghost duplicates, or errors
6. **Next Auto Upgrade Focus:** What flaws to target manually

---

## 5. Core Learning Rule

> [!IMPORTANT]
> **Nova must never repeat the same mistake twice.**
> Once a behavioral patch is written — either manually via auto upgrade or automatically via `NovaSelfImprovementService` — it is permanent. The patch accumulates. Nova grows smarter with every week.
> A real human friend doesn't make the same social mistake after being corrected. Nova doesn't either.

---

## 6. Input Sources for Analysis

| Source | How Used |
|---|---|
| `backend/scripts/fetch_recent_chats.ts` | Pulls real-time chat logs from Supabase for manual review |
| Supabase `chat_history` table | Source for `NovaSelfImprovementService` automated analysis |
| Supabase `nova_behavioral_patches` | Growing library of Nova's self-knowledge |
| `promptBuilder.ts` | Where all patches are injected into Nova's identity rules |
