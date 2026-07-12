/**
 * LifeEventExtractor — Nova's Ears
 *
 * Called fire-and-forget after every chat response.
 * Parses the conversation for actionable life events the user mentioned
 * (meetings, gym, exams) and populates nova_agenda.
 * It also extracts recurring user routines (e.g., "I fast on Mondays")
 * and stores them in user_routines.
 */

import { supabaseAdmin } from '../lib/supabase';
import { chatCompletion } from '../lib/nvidia';
import { logger } from '../lib/logger';

const EXTRACTION_PROMPT = `You are Nova's internal event-detection system. Given a recent conversation snippet, extract:
1. Any upcoming events, activities, or time-sensitive things the user mentioned.
2. Any recurring routines or habits the user mentioned.

For events, output:
- type: "event"
- description: Short description of what is happening
- expectedTime: ISO 8601 timestamp of when it will happen (use current time context provided).
- followUpQuestion: What Nova should casually ask about this event later.
- followUpAfterMinutes: How many minutes after expectedTime should Nova follow up?

For routines/habits, output:
- type: "routine"
- routineType: "sleep", "diet", "activity", or "general"
- description: Short description of the routine (e.g. "Fasts every Monday")

CRITICAL EXCLUSIONS:
- "bye", "goodnight", "talk later" are NOT events.
- "I'll call you back" — user will initiate, don't follow up.
- General statements with no time/habit component ("I like pizza") are NOT events or routines.

Respond with ONLY raw JSON (no markdown):
[
  {"type":"event","description":"...","expectedTime":"...","followUpQuestion":"...","followUpAfterMinutes":60},
  {"type":"routine","routineType":"diet","description":"..."}
]`;

export class LifeEventExtractor {

  async extractAndStore(
    userId: string,
    recentMessages: { role: string; content: string }[],
    userLocalTime: Date,
    userTimezoneOffset: number
  ): Promise<void> {
    try {
      const snippet = recentMessages.slice(-6)
        .map(m => `${m.role === 'user' ? 'User' : 'Nova'}: ${m.content.substring(0, 300)}`)
        .join('\n');

      if (snippet.length < 20) return;

      const timeContext = `Current user local time: ${userLocalTime.toISOString()}. ` +
        `Timezone offset: UTC+${userTimezoneOffset}. ` +
        `Today is ${userLocalTime.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}.`;

      const raw = await chatCompletion([
        { role: 'system', content: EXTRACTION_PROMPT },
        { role: 'user', content: `${timeContext}\n\nConversation:\n${snippet}` }
      ], {
        maxTokens: 500,
        temperature: 0.2,
      });

      let items: any[];
      try {
        const jsonMatch = raw.match(/\[[\s\S]*\]/);
        items = JSON.parse(jsonMatch ? jsonMatch[0] : raw);
      } catch {
        logger.debug('[LifeEventExtractor] No valid JSON in LLM response');
        return;
      }

      if (!Array.isArray(items) || items.length === 0) return;

      for (const item of items.slice(0, 4)) {
        try {
          if (item.type === 'event' && item.expectedTime) {
            const expectedTime = new Date(item.expectedTime);
            if (isNaN(expectedTime.getTime())) continue;

            const followUpMinutes = Math.min(Math.max(item.followUpAfterMinutes || 60, 15), 24 * 60);
            const followUpAfter = new Date(expectedTime.getTime() + followUpMinutes * 60 * 1000);

            if (followUpAfter.getTime() < Date.now()) continue;

            const { data: existing } = await supabaseAdmin
              .from('nova_agenda')
              .select('id')
              .eq('user_id', userId)
              .eq('status', 'pending')
              .ilike('event_description', `%${item.description.substring(0, 30)}%`)
              .limit(1);

            if (existing && existing.length > 0) continue;

            await supabaseAdmin.from('nova_agenda').insert({
              user_id: userId,
              event_description: item.description.substring(0, 500),
              expected_time: expectedTime.toISOString(),
              follow_up_question: item.followUpQuestion?.substring(0, 500) || `How did the ${item.description} go?`,
              follow_up_after: followUpAfter.toISOString(),
              source_message: snippet.substring(0, 500),
              status: 'pending',
            });
            logger.info('[LifeEventExtractor] Stored agenda event', { userId, event: item.description });

          } else if (item.type === 'routine' && item.description) {
            const { data: existingRoutine } = await supabaseAdmin
              .from('user_routines')
              .select('id')
              .eq('user_id', userId)
              .ilike('description', `%${item.description.substring(0, 30)}%`)
              .limit(1);

            if (existingRoutine && existingRoutine.length > 0) continue;

            await supabaseAdmin.from('user_routines').insert({
              user_id: userId,
              routine_type: item.routineType || 'general',
              description: item.description.substring(0, 500),
              confidence: 80,
            });
            logger.info('[LifeEventExtractor] Stored user routine', { userId, routine: item.description });
          }
        } catch (itemErr) {
          logger.warn('[LifeEventExtractor] Failed to store item', { error: itemErr instanceof Error ? itemErr.message : String(itemErr) });
        }
      }
    } catch (err) {
      logger.warn('[LifeEventExtractor] Error (non-critical)', { error: err instanceof Error ? err.message : String(err) });
    }
  }
}

export const lifeEventExtractor = new LifeEventExtractor();
