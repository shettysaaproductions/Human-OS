# GEMINI TASK: Memory V2 — Session Summarization (Tier 2 Memory)

## Role
You are a Senior Backend Engineer for HumanOS.
Stack: Express + TypeScript + Supabase + NVIDIA NIM API.

## Background
HumanOS currently sends ALL chat messages to the LLM. This doesn't scale.
Memory V2 adds a tiered system: recent messages + summaries + semantic memories.
This task implements **Tier 2: Session Summaries**.

## Goal
After a user is inactive for 30 minutes, summarize their conversation session
and store it in a `conversation_summaries` table. This summary is then injected
into future prompts instead of raw old messages.

## Step 1: Create Supabase Table

Run this SQL in the Supabase SQL Editor:

```sql
CREATE TABLE IF NOT EXISTS conversation_summaries (
  id               uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id          uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  conversation_id  uuid,
  summary_text     text NOT NULL,
  date_range_start timestamptz NOT NULL,
  date_range_end   timestamptz NOT NULL,
  message_count    integer DEFAULT 0,
  created_at       timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_conv_summaries_user_date
  ON conversation_summaries(user_id, date_range_end DESC);
```

## Step 2: Create Backend Service

Create file: `backend/src/services/SessionSummarizerService.ts`

```typescript
import { supabaseAdmin } from '../lib/supabase';
import { chatCompletion } from '../lib/nvidia';
import { logger } from '../lib/logger';

const IDLE_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes
const lastActivityMap = new Map<string, number>(); // userId -> timestamp

export const sessionSummarizerService = {
  /**
   * Called after every Nova reply. Tracks last activity.
   * If user has been idle 30 min, trigger summarization.
   */
  recordActivity: (userId: string): void => {
    lastActivityMap.set(userId, Date.now());
  },

  /**
   * Background check — call every 5 minutes.
   * Summarizes sessions for users who have been idle.
   */
  checkAndSummarize: async (): Promise<void> => {
    const now = Date.now();
    for (const [userId, lastSeen] of lastActivityMap.entries()) {
      if (now - lastSeen > IDLE_THRESHOLD_MS) {
        lastActivityMap.delete(userId);
        await sessionSummarizerService.summarizeSession(userId);
      }
    }
  },

  summarizeSession: async (userId: string): Promise<void> => {
    try {
      // Get recent unsummarized messages (last 2 hours)
      const since = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
      const { data: messages } = await supabaseAdmin
        .from('chat_history')
        .select('role, content, created_at, conversation_id')
        .eq('user_id', userId)
        .gte('created_at', since)
        .order('created_at', { ascending: true });

      if (!messages || messages.length < 4) return; // Not enough to summarize

      const conversationText = messages
        .map(m => `${m.role === 'user' ? 'User' : 'Nova'}: ${m.content}`)
        .join('\n');

      const summary = await chatCompletion([
        {
          role: 'system',
          content: `You are a memory summarizer for a personal AI companion called Nova.
Summarize the following conversation into 2-4 concise sentences.
Focus on: what topics were discussed, any facts shared about the user, emotional state, decisions made.
Be specific. Use third person ("The user said...", "They discussed...").
Never include filler. Never say "In this conversation".`
        },
        { role: 'user', content: conversationText }
      ], { maxTokens: 200, temperature: 0.3 });

      if (!summary || summary.trim().length < 20) return;

      const conversationId = messages[0].conversation_id;
      const dateRangeStart = messages[0].created_at;
      const dateRangeEnd = messages[messages.length - 1].created_at;

      await supabaseAdmin.from('conversation_summaries').insert({
        user_id: userId,
        conversation_id: conversationId,
        summary_text: summary.trim(),
        date_range_start: dateRangeStart,
        date_range_end: dateRangeEnd,
        message_count: messages.length
      });

      logger.info('[SessionSummarizer] Session summarized', {
        userId,
        messageCount: messages.length,
        summaryLength: summary.length
      });
    } catch (err) {
      logger.error('[SessionSummarizer] Failed', {
        userId,
        error: err instanceof Error ? err.message : String(err)
      });
    }
  }
};
```

## Step 3: Wire Into index.ts

In `backend/src/index.ts`, add:

```typescript
import { sessionSummarizerService } from './services/SessionSummarizerService';

// Session Summarizer (check every 5 minutes)
const summarizerInterval = setInterval(async () => {
  await sessionSummarizerService.checkAndSummarize();
}, 5 * 60 * 1000);
if (summarizerInterval.unref) summarizerInterval.unref();
```

## Step 4: Record Activity in chat.ts

In `backend/src/routes/chat.ts`, after saving Nova's reply to DB, add:
```typescript
sessionSummarizerService.recordActivity(userId);
```

## Step 5: Inject Summaries into Prompt

In the prompt builder, after loading short-term memories, also load summaries:

```typescript
// Load recent summaries (Tier 2 Memory)
const { data: summaries } = await supabaseAdmin
  .from('conversation_summaries')
  .select('summary_text, date_range_end')
  .eq('user_id', userId)
  .order('date_range_end', { ascending: false })
  .limit(3);

const summaryContext = summaries && summaries.length > 0
  ? `\n\nRecent session summaries:\n${summaries.map(s => `- ${s.summary_text}`).join('\n')}`
  : '';
```

Then append `summaryContext` to the system prompt.

## Verification
1. `npx tsc --noEmit` — no errors
2. Chat for a few minutes, then wait 30+ min
3. Check Supabase `conversation_summaries` table — should have a new row
4. Next chat session should include the summary in Nova's context

## Deploy
```bash
git add backend/src/services/SessionSummarizerService.ts backend/src/routes/chat.ts backend/src/index.ts
git commit -m "feat(memory): add session summarizer for Memory V2 Tier 2"
git push origin feature-performance-phase1
```
