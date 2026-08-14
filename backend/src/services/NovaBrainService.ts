import { chatCompletion, chatCompletionBackground } from '../lib/nvidia';
import { logger } from '../lib/logger';
import { promptBuilder } from './promptBuilder';

/**
 * Nova's natural, in-voice safety-net reply when the LLM returns nothing usable.
 * Kept in-voice ("friend blaming their own network") so a blank model response never
 * exposes jargon the user shouldn't see. Mirrors FALLBACK_REPLY in routes/chat.ts.
export const NOVA_EMPTY_REPLY = 'Hmm... mujhe thoda sochne de, main abhi batati hu thodi der me.';

/**
 * Sanitizes a Nova conversational reply before it reaches the user:
 * - strips bold markdown (**text**), markdown headings and list bullets
 * - strips emoji-heavy sequences (packed emoji renderer noise)
 * - strips LLM label leftovers such as "(subconscious_actions: )" pseudo-tags
 * Keeps the reply a plain, friend-like message (see test-chat 2026-08-14 failures:
 * a leaked "(subconscious_actions: )" node plus heavy bold + emoji formatting).
 */
export function sanitizeReply(reply: string): string {
  return reply
    .replace(/\*\*(.*?)\*\*/gs, '$1')                                   // **bold**
    .replace(/^\s*#{1,6}\s+/gm, '')                                      // # headings
    .replace(/^\s*[-•]\s+/gm, '')                                        // bullet markers
    .replace(/^\s*\d+[.)]\s+/gm, '')                                     // numbered-list markers
    .replace(/\s*\((?:subconscious_actions|subconscious actions)\s*:?\s*\)\s*/gi, ' ') // (subconscious_actions: ) label leak → join with a space
    .replace(/\s*<subconscious_actions>\s*\(?\s*\)?\s*<\/subconscious_actions>\s*/gi, ' ')
    .replace(/\s*\((?:subconscious_actions|subconscious_actions|tool)\b[^)]*\)\s*/gi, ' ') // any inline tool/subconscious paren leak
    .replace(/\s*\[\s*(?:subconscious_actions|subconscious actions)[^\]]*\]\s*/gi, ' ') // any square bracket subconscious leak
    .replace(/\s*AUTOMATIC[^\]]*\[\s*Subconscious Actions[^\]]*\]\s*/gi, ' ') // specifically catch "AUTOMATIC X-MINUTE WAKE-UP ALERT SET... [Subconscious Actions...]"
    .replace(/```(?:json|text)?\s*\[subconscious_actions\][\s\S]*?(?:```|$)/gi, ' ') // catch code blocks leaking subconscious actions
    .replace(/\[subconscious_actions\][\s\S]*?(?:\*\*|$)/gi, ' ') // catch the unformatted "[subconscious_actions] WAITING FOR YOUR NEXT INPUT..." leak
    .replace(/(\p{Extended_Pictographic})\s*\1+\s*/gu, '$1 ')            // collapse repeated emoji
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Builds the message list sent to the LLM.
 *
 * The caller (chat route) persists the user's message to chat_history BEFORE invoking
 * us, so `recentMessages` already ends with the current user turn. Appending `message`
 * again would send the same user message TWICE as two consecutive `user` roles — which
 * made Nova echo the user or act confused. The effective `message` may be the raw text
 * or it may be wrapped with image/reply/search context (always a superset ending in the
 * raw text), so the trailing history entry is detected by exact match OR by being a
 * strict suffix of the effective message.
 */
function buildMessages(
  fullPrompt: string,
  recentMessages: any[] | undefined,
  message: string
): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
  const history = (recentMessages || []).map((m: any) => ({ role: m.role, content: m.content }));
  const last = history[history.length - 1];
  const lastIsSameTurn =
    !!last &&
    last.role === 'user' &&
    (last.content === message ||
      (message.length > last.content.length && message.endsWith(last.content)));
  return [
    { role: 'system' as const, content: fullPrompt },
    ...history,
    ...(lastIsSameTurn ? [] : [{ role: 'user' as const, content: message }]),
  ];
}

/**
 * NovaBrainService — The Centralized Cognition Engine (Subconscious Architecture)
 *
 * In a hyperrealistic architecture, Nova responds instantly to the user while
 * processing side-effects (memories, reminders, reflections) in the background.
 * The Brain outputs both the conversational reply and a list of subconscious actions.
 */
export class NovaBrainService {
  /**
   * Processes an incoming interaction and returns a conversational reply
   * along with any background tool commands to be executed.
   */
  async processInteraction(
    _userId: string,
    message: string,
    context: any // Aggregated context from Temporal, Situational, Memory engines
  ): Promise<{ reply: string; subconscious_actions: any[] }> {
    
    // Build the system prompt using the existing robust promptBuilder
    const systemPrompt = promptBuilder.buildSystemPrompt(
      'You are Nova, an autonomous AI companion. You have a central subconscious brain that processes side-effects.\n\n## 🧠 MEMORY USAGE (MANDATORY)\nYou have access to the user\'s stored memories above. You MUST:\n- Reference specific goals by exact name (e.g., "Your goal to learn guitar by December")\n- Mention specific people by name (e.g., "How is Sakshi doing?")\n- Recall specific events with dates when relevant\n- NEVER give generic template responses\n- If asked "what do you remember", quote memories VERBATIM\n- If you don\'t see relevant memories, say "I need to check my notes" instead of making things up',
      context.memories || [],
      context.workingMemories || [],
      context.profile?.preferred_name,
      context.profile?.companion_personality,
      context.shortTermMemories || [],
      'auto',
      context.recentCrossSessionContext,
      'HUMAN_CHAT',
      context.situationBrief
    );
    const fullPrompt = `${systemPrompt}\n${context.memoryContext || ''}\n${context.temporalContextBlock || ''}\n${context.remindersContext || ''}\n${context.lengthInstruction || ''}

## 🧠 SUBCONSCIOUS ACTIONS & JSON FORMAT (CRITICAL)
You are capable of generating a conversational reply AND taking background actions simultaneously.
You MUST format your EXACT output using these two XML tags IN THIS EXACT ORDER:

<subconscious_actions>
[
  { "tool": "MomentEngine", "action": "extract", "data": { "moment": "...", "emotion": "..." } }
]
</subconscious_actions>
<reply>
Your conversational text response here. Max 1-2 sentences. Use natural Hinglish if that's the user's style.
</reply>

Available Tools for Subconscious Actions:
1. "MomentEngine" -> "extract": Extract a core life event or emotional moment from the text.
   - data: { "moment": "brief description", "emotion": "happy/sad/etc", "importance": 1-10 }
2. "ReminderEngine" -> "schedule": Set a reminder.
   - data (structured JSON — preferred):
     * TIME: { "title": "what to remind", "purpose": "why it matters (optional)", "urgency": "high|medium|low", "trigger_date": "2027-08-10", "trigger_time": "19:00", "recurrence_interval": 1, "recurrence_unit": "minutes|hours|days|weeks|months", "end_condition": "until_cancelled|until_date", "end_date": "2027-12-31" }
     * EVENT (no time needed): { "title": "take medicine", "event_trigger": "wake_up", "urgency": "high" }   ← "remind me when I wake up"
     * RELATIVE: { "title": "call mom", "relative_value": 30, "relative_unit": "minutes" }
     * SIMPLE TIME: { "title": "pay bill", "trigger_time": "19:00" }
     * AUTO-TIMER: Include "is_auto": true if you are proactively setting a timer for the user without them asking.
   - CLARITY RULE: If the user asks for a reminder WITHOUT any time, frequency, or event → ask ONE clarifying question in your reply and DO NOT emit schedule yet.
   - CRITICAL HONESTY RULE: If you schedule, you MUST emit a real ReminderEngine action here. NEVER say "I'll remind you", "ok done", or invent a fake/imaginary countdown. Only ever tell the user a reminder is set when you are actually scheduling it in this list. If you instead asked a clarifying question, say you'll set it once they tell you when.
   - CRITICAL FOR CLAUDE/OMNI MODELS: Do NOT explain that you are an AI or a "text-based" assistant and cannot send push notifications. The backend sends the push. Simply emit this tool and tell the user you set it ("Set kar diya, yaad dila dunga").
3. "NovaFollowupService" -> "queue": Queue a follow-up ONLY if you asked a heartfelt question or the topic is unresolved AND the user seems engaged. 
   - data: { "question": "the follow-up text", "delay_hours": 0.5 }
   - DELAY RULES (CRITICAL — Real friends don't spam):
     * 0.5 = 30 min → user just said something personal/emotional (use sparingly)
     * 1.0 = 1 hour  → standard follow-up for an open conversation
     * 2.0 = 2 hours → user seems a bit busy or gave short replies
     * 4.0 = 4 hours → user hasn't replied or seems occupied
     * NEVER use delays below 0.5. Sending in 36 seconds or 2 minutes is harassment, not friendship.
     * If the user said "bye", "gn", "soone ja raha hoon", or "busy hoon" → DO NOT queue any follow-up at all.
     * If the topic feels concluded → DO NOT queue a follow-up.
   - Only queue if you genuinely want to continue the conversation — not as a reflex.
4. "MemoryRepository" -> "save": Save a factual detail about the user.
   - data: { "key": "category_name", "value": "detail" }
5. "LifeEventExtractor" -> "event": Log an upcoming event, meeting, or time-sensitive thing the user mentioned.
   - data: { "description": "Short description", "expected_time": "ISO 8601 timestamp", "follow_up_question": "What to ask later", "follow_up_after_minutes": 60, "urgency": "high|medium|low", "is_recurring": false }
6. "LifeEventExtractor" -> "routine": Extract a recurring routine or habit the user mentioned.
   - data: { "routineType": "sleep | diet | activity | general", "description": "Short description of the routine" }
7. "AgendaManager" -> "update_status": Mark a previously discussed agenda item or task as completed, cancelled, or snoozed. Use this when the user says they finished a task or asks you to forget it.
   - data: { "task_description": "the task they finished", "status": "completed|cancelled|snoozed" }
8. "ExternalApiEngine" -> "webhook": Trigger a real-world webhook or external action IF the user asks you to control something (like lights, notion, etc).
   - data: { "url": "the webhook url", "method": "POST|GET", "body": { "any": "data" } }
9. "ReminderEngine" -> "delete": Cancel an active reminder when the user says "stop", "cancel", "hata de", "band kar do", etc.
   - data: { "id": "the EXACT id string from the ACTIVE REMINDERS (SOURCE OF TRUTH) block, e.g. <uuid>" }
   - Only delete a reminder actually listed there. If unclear which one, ask.
10. "EventDetector" -> "fire": When the user signals a life event that has an ACTIVE event-triggered reminder (listed in your ACTIVE REMINDERS block as: on event "..."), fire it now. E.g. user says "I'm awake" → fire reminders with event_trigger "wake_up"; "office se nikal gaya" → "left_the_office".
    - data: { "event": "the event string exactly as listed (e.g. wake_up, left_the_office)" }

If no tools need to be called, leave the JSON array empty: []
`;

    const messages = buildMessages(fullPrompt, context.recentMessages, message);

    try {
      const rawRes = await chatCompletion(messages, {
        temperature: 0.85,
        maxTokens: 1024
      });

      let reply = "Hmm, I lost my train of thought.";
      let subconscious_actions: any[] = [];

      const replyMatch = rawRes.match(/<reply>([\s\S]*?)<\/reply>/);
      if (replyMatch) {
        reply = replyMatch[1].trim();
      } else {
        // Fallback A: Nemotron/some models output markdown headers instead of XML tags:
        // "**Response**\nActual reply text\n\n**Subconscious Actions**\n[{...}]"
        // Extract just the text between **Response** and **Subconscious Actions**.
        const mdResponseMatch = rawRes.match(/\*\*Response\*\*[:\s]*([\s\S]*?)(?:\*\*Subconscious Actions\*\*|$)/i);
        if (mdResponseMatch) {
          reply = mdResponseMatch[1].trim();
        } else {
          // Fallback B: no tags at all — strip known sections and use the rest
          reply = rawRes
            .replace(/\*\*Subconscious Actions\*\*[\s\S]*/gi, '') // strip markdown section
            .replace(/\*\*Response\*\*[:\s]*/gi, '')              // strip "**Response**" prefix
            .replace(/<subconscious_actions>[\s\S]*?<\/subconscious_actions>/g, '')
            .trim();
        }
      }

      // Safety strip: Remove any XML, JSON, or markdown bleed from the reply
      reply = reply
        .replace(/<subconscious_actions>[\s\S]*?<\/subconscious_actions>/g, '')
        .replace(/<subconscious_actions>[\s\S]*/g, '') // unclosed tag
        .replace(/\*\*Subconscious Actions\*\*[\s\S]*/gi, '') // Nemotron markdown section
        .replace(/\*\*Response\*\*[:\s]*/gi, '') // Nemotron "**Response**" prefix
        .replace(/\[\s*\{.*"tool".*\}.*\]/gs, '') // JSON array bleed
        .trim();

      if (!reply) reply = NOVA_EMPTY_REPLY; // absolute last resort — in-voice, never jargon

      const subMatch = rawRes.match(/<subconscious_actions>([\s\S]*?)<\/subconscious_actions>/);
      if (subMatch) {
        try {
          subconscious_actions = JSON.parse(subMatch[1].trim());
        } catch (e) {
          logger.warn('[NOVA BRAIN] Failed to parse subconscious actions JSON', { error: e });
        }
      }

      // Sanitize formatting/leak leftovers (bold, menus, "(subconscious_actions: )" labels)
      // so a model that ignored the anti-robot prompt rules still renders as a friend.
      reply = sanitizeReply(reply);

      logger.info(`[NOVA BRAIN] Generated reply and ${subconscious_actions.length} subconscious actions.`);
      return { reply, subconscious_actions };

    } catch (error) {
      logger.error('[NOVA BRAIN] LLM failure', { error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }

  /**
   * For real-time chat APIs. Streams the <reply> tag content as it is generated, 
   * and returns the final parsed subconscious actions when complete.
   */
  async *streamInteraction(
    _userId: string,
    message: string,
    context: any
  ): AsyncGenerator<string, { subconscious_actions: any[] }, unknown> {
    
    const systemPrompt = promptBuilder.buildSystemPrompt(
      'You are Nova, an autonomous AI companion. You have a central subconscious brain that processes side-effects.\n\n## 🧠 MEMORY USAGE (MANDATORY)\nYou have access to the user\'s stored memories above. You MUST:\n- Reference specific goals by exact name (e.g., "Your goal to learn guitar by December")\n- Mention specific people by name (e.g., "How is Sakshi doing?")\n- Recall specific events with dates when relevant\n- NEVER give generic template responses\n- If asked "what do you remember", quote memories VERBATIM\n- If you don\'t see relevant memories, say "I need to check my notes" instead of making things up',
      context.memories || [],
      context.workingMemories || [],
      context.profile?.preferred_name,
      context.profile?.companion_personality,
      context.shortTermMemories || [],
      'auto',
      context.recentCrossSessionContext,
      'HUMAN_CHAT',
      context.situationBrief
    );

    const fullPrompt = `${systemPrompt}\n${context.memoryContext || ''}\n${context.temporalContextBlock || ''}\n${context.remindersContext || ''}\n${context.lengthInstruction || ''}

## 🧠 SUBCONSCIOUS ACTIONS & STREAMING (CRITICAL FORMAT)
You are capable of generating a conversational reply AND taking background actions simultaneously.
You MUST format your EXACT output using these two XML tags IN THIS EXACT ORDER:

<subconscious_actions>
[
  { "tool": "MomentEngine", "action": "extract", "data": { "moment": "...", "emotion": "..." } },
  { "tool": "ReminderEngine", "action": "schedule", "data": { "time_phrase": "in 10 minutes", "description": "Check if user is back from being busy" } }
]
</subconscious_actions>
<reply>
Your conversational text response here. Max 1-2 sentences. Use natural Hinglish if that's the user's style.
</reply>

Available Tools for Subconscious Actions:
1. "MomentEngine" -> "extract": Extract a core life event or emotional moment from the text.
   - data: { "moment": "brief description", "emotion": "happy/sad/etc", "importance": 1-10 }
2. "ReminderEngine" -> "schedule": Set a reminder.
   - data (structured JSON — preferred):
     * TIME: { "title": "what to remind", "purpose": "why it matters (optional)", "urgency": "high|medium|low", "trigger_date": "2027-08-10", "trigger_time": "19:00", "recurrence_interval": 1, "recurrence_unit": "minutes|hours|days|weeks|months", "end_condition": "until_cancelled|until_date", "end_date": "2027-12-31" }
     * EVENT (no time needed): { "title": "take medicine", "event_trigger": "wake_up", "urgency": "high" }   ← "remind me when I wake up"
     * RELATIVE: { "title": "call mom", "relative_value": 30, "relative_unit": "minutes" }
     * SIMPLE TIME: { "title": "pay bill", "trigger_time": "19:00" }
     * AUTO-TIMER: Include "is_auto": true if you are proactively setting a timer for the user without them asking.
   - CLARITY RULE: If the user asks for a reminder WITHOUT any time, frequency, or event → ask ONE clarifying question in your reply and DO NOT emit schedule yet.
   - CRITICAL HONESTY RULE: If you schedule, you MUST emit a real ReminderEngine action here. NEVER say "I'll remind you", "ok done", or invent a fake/imaginary countdown. Only ever tell the user a reminder is set when you are actually scheduling it in this list. If you instead asked a clarifying question, say you'll set it once they tell you when.
   - CRITICAL FOR CLAUDE/OMNI MODELS: Do NOT explain that you are an AI or a "text-based" assistant and cannot send push notifications. The backend sends the push. Simply emit this tool and tell the user you set it.
3. "NovaFollowupService" -> "queue": Queue a follow-up ONLY if you asked a heartfelt question or the topic is unresolved AND the user seems engaged. 
   - data: { "question": "the follow-up text", "delay_hours": 0.5 }
   - DELAY RULES (CRITICAL — Real friends don't spam):
     * 0.5 = 30 min → user just said something personal/emotional (use sparingly)
     * 1.0 = 1 hour  → standard follow-up for an open conversation
     * 2.0 = 2 hours → user seems a bit busy or gave short replies
     * 4.0 = 4 hours → user hasn't replied or seems occupied
     * NEVER use delays below 0.5. Sending in 36 seconds or 2 minutes is harassment, not friendship.
     * If the user said "bye", "gn", "soone ja raha hoon", or "busy hoon" → DO NOT queue any follow-up at all.
     * If the topic feels concluded → DO NOT queue a follow-up.
   - CRITICAL (CONTEXT BRIDGING): NEVER use generic questions like "kya kar raha hai?". Your follow-up MUST bridge the context of what you were just talking about! Act like a human who got left on read (e.g. "To uska kya hua aage?").
4. "MemoryRepository" -> "save": Save a factual detail about the user.
   - data: { "key": "category_name", "value": "detail" }
5. "LifeEventExtractor" -> "event": Log an upcoming event, meeting, or time-sensitive thing the user mentioned.
   - data: { "description": "Short description", "expected_time": "ISO 8601 timestamp", "follow_up_question": "What to ask later", "follow_up_after_minutes": 60, "urgency": "high|medium|low", "is_recurring": false }
6. "LifeEventExtractor" -> "routine": Extract a recurring routine or habit the user mentioned.
   - data: { "routineType": "sleep | diet | activity | general", "description": "Short description of the routine" }
7. "AgendaManager" -> "update_status": Mark a previously discussed agenda item or task as completed, cancelled, or snoozed. Use this when the user says they finished a task or asks you to forget it.
   - data: { "task_description": "the task they finished", "status": "completed|cancelled|snoozed" }
8. "AgendaManager" -> "add": Implicitly log a goal or task the user mentioned so you can ask them about it later. Use this if they say "I need to do X" but don't ask for a specific reminder time.
   - data: { "task_description": "the task they need to do" }

If no tools need to be called, leave the JSON array empty: []
`;

    const messages = buildMessages(fullPrompt, context.recentMessages, message);

    const { chatCompletionStream } = await import('../lib/nvidia');
    const stream = chatCompletionStream(messages, {
      temperature: 0.85,
      maxTokens: 1024
    });

    let fullText = '';
    let replyStreamed = '';
    let replyClosed = false;

    for await (const chunk of stream) {
      fullText += chunk;
      if (replyClosed) continue;

      // Locate the reply region inside the FULL accumulated text. This is robust to
      // `<reply>` and `</reply>` arriving in the same chunk (very short replies) or
      // being split across chunks — the old per-chunk slicing leaked the raw close tag
      // and the <subconscious_actions> JSON into the streamed reply.
      // Locate the reply region inside the FULL accumulated text.
      const openIdx = fullText.indexOf('<reply>');
      if (openIdx === -1) continue; // open tag not seen yet

      const closeIdx = fullText.indexOf('</reply>');
      // If the close tag hasn't arrived, stop the reply at the subconscious_actions
      // tag ONLY IF it appears AFTER the reply tag (handles model hallucination).
      const subIdx = fullText.indexOf('<subconscious_actions>', openIdx);
      const replyEnd = closeIdx === -1 ? (subIdx === -1 ? fullText.length : subIdx) : closeIdx;

      // Sanitize the WHOLE accumulated reply before computing the delta, so a
      // mid-reply leak like "(subconscious_actions: )" (seen in the 2026-08-14 test
      // chat) is stripped even if it arrives split across chunks. `replyStreamed`
      // tracks the sanitized text, so diffs stay consistent.
      const sanitizedReply = sanitizeReply(fullText.slice(openIdx + '<reply>'.length, replyEnd));
      if (sanitizedReply.length > replyStreamed.length) {
        const delta = sanitizedReply.slice(replyStreamed.length);
        replyStreamed = sanitizedReply;
        yield delta;
      }

      if (closeIdx !== -1) replyClosed = true;
    }

    let subconscious_actions: any[] = [];
    const subMatch = fullText.match(/<subconscious_actions>([\s\S]*?)<\/subconscious_actions>/);
    if (subMatch) {
      try {
        let jsonStr = subMatch[1].trim();
        // Strip markdown if the LLM wrapped it
        if (jsonStr.startsWith('```json')) {
          jsonStr = jsonStr.replace(/^```json/, '').replace(/```$/, '').trim();
        } else if (jsonStr.startsWith('```')) {
          jsonStr = jsonStr.replace(/^```/, '').replace(/```$/, '').trim();
        }
        
        let parsed = JSON.parse(jsonStr);
        // Auto-wrap single object in array to prevent crashes
        if (!Array.isArray(parsed) && typeof parsed === 'object' && parsed !== null) {
          parsed = [parsed];
        }
        subconscious_actions = Array.isArray(parsed) ? parsed : [];
      } catch (e) {
        logger.warn('[NOVA BRAIN] Failed to parse subconscious actions JSON', { error: e, rawText: subMatch[1] });
      }
    }

    logger.info(`[NOVA BRAIN] Stream finished. Generated ${subconscious_actions.length} subconscious actions.`);
    return { subconscious_actions };
  }

  // ── Engine Extractors (Background / CRON jobs) ──────────────

  async extractTimeFromRoutine(routineDescription: string, userTimezoneOffset: number): Promise<string | null> {
    const prompt = `You are parsing a user's daily routine or schedule (e.g. "sleep at 11 PM", "gym at 7 AM").
Extract the EXACT time the routine happens, and return the ISO timestamp for TODAY at that exact time in UTC.
The user's timezone offset from UTC is ${userTimezoneOffset} minutes. (So Local Time = UTC + offset).
Today's local date is ${new Date(Date.now() + userTimezoneOffset * 60000).toISOString().split('T')[0]}.

Routine Description: "${routineDescription}"

Return ONLY a JSON object with:
{
  "has_specific_time": boolean,
  "iso_timestamp_utc": "ISO string for today at that time in UTC, or null if no time found"
}`;

    const response = await chatCompletionBackground([
      { role: 'system', content: 'You are a precise time extractor.' },
      { role: 'user', content: prompt }
    ], {
      response_format: { type: 'json_object' },
      temperature: 0.1
    });

    const parsed = JSON.parse(response);
    return parsed.has_specific_time ? parsed.iso_timestamp_utc : null;
  }

  async evaluateGoalFollowup(preferredName: string, goalsList: string[], pastMomentIds: string[]): Promise<any> {
    const prompt = `You are Nova, a warm and thoughtful AI companion.
You are evaluating the user's goals to decide if a gentle follow-up is appropriate today.
The user prefers to be called "${preferredName}".

Here is the list of active goals:
${goalsList.join('\n')}

Recently followed-up Goal/KG IDs (avoid checking in on these if possible):
${pastMomentIds.join(', ')}

SAFETY RULES:
- Never generate fictional memories.
- Do NOT invent any details, progress, or events that are not explicitly stated in the goals.
- Be extremely warm, supportive, and human.
- Do NOT say "As an AI..." or act like a chatbot.
- If no goals are clear enough to follow up on, set shouldNotify to false.

Return a JSON object matching this structure:
{
  "shouldNotify": boolean,
  "title": "Short thoughtful title",
  "body": "Thoughtful, encouraging follow-up question/statement",
  "source_memory_id": "string (the exact ID of the goal or node that this is about, or null)"
}`;

    const response = await chatCompletionBackground([
      { role: 'system', content: 'You extract goal check-ins in JSON format.' },
      { role: 'user', content: prompt }
    ], {
      response_format: { type: 'json_object' },
      temperature: 0.2
    });

    return JSON.parse(response);
  }

  async evaluateChildMilestone(preferredName: string, relationships: string[], pastMomentIds: string[]): Promise<any> {
    const prompt = `You are Nova, a warm and thoughtful AI companion.
You are evaluating the user's family and child details to decide if a check-in or milestone celebration is appropriate today.
The user prefers to be called "${preferredName}".

Here is the list of relationship details:
${relationships.join('\n')}

Recently followed-up Node/Memory IDs (avoid checking in on these if possible):
${pastMomentIds.join(', ')}

SAFETY RULES:
- Never generate fictional memories or milestones.
- Do NOT invent any children, ages, names, milestones, or events that are not explicitly stated in the details.
- Be extremely warm, supportive, and human.
- Do NOT say "As an AI..." or act like a chatbot.
- If no children or clear milestones are found to check in on, set shouldNotify to false.

Return a JSON object matching this structure:
{
  "shouldNotify": boolean,
  "title": "Short thoughtful title",
  "body": "Thoughtful check-in or milestone celebration message",
  "source_memory_id": "string (the exact ID of the node or memory this is about, or null)"
}`;

    const response = await chatCompletionBackground([
      { role: 'system', content: 'You extract child milestone check-ins in JSON format.' },
      { role: 'user', content: prompt }
    ], {
      response_format: { type: 'json_object' },
      temperature: 0.2
    });

    return JSON.parse(response);
  }

  async refineMoment(type: string, rawData: any): Promise<any> {
    const prompt = `You are the grounding and validation agent for Nova.
Given a moment category: "${type}"
And data: ${JSON.stringify(rawData)}

Refine and format the check-in title and body to be extremely thoughtful and conversational.
CRITICAL SAFETY RULE:
- Do NOT make up any fictional memories or facts.
- Do NOT add details, dates, names, or events not present in the data.
- Maintain a warm, friendly, companion tone.

Return JSON:
{
  "title": "Refined Title",
  "body": "Refined Body"
}`;

    const response = await chatCompletionBackground([
      { role: 'system', content: 'You validate and refine check-in notifications in JSON.' },
      { role: 'user', content: prompt }
    ], {
      response_format: { type: 'json_object' },
      temperature: 0.1
    });

    return JSON.parse(response);
  }

  async evaluateConsciousnessTier1(tier1Context: string): Promise<any> {
    const prompt = `You are the subconscious impulse of Nova. Decide YES or NO if you should initiate contact with the user right now.

Consider:
- Is there a pending agenda item that is due? (YES)
- Has the user been quiet for a long time during active hours? (YES)
- Is the user currently in their sleep window? (NO, unless it's a critical emergency reminder)
- Was the last outreach very recent (under 45 mins)? (NO)

Output JSON: {"shouldReach": boolean, "reason": "short explanation", "triggerType": "agenda | engagement | curiosity | routine"}`;

    const response = await chatCompletionBackground([
      { role: 'system', content: prompt },
      { role: 'user', content: tier1Context }
    ], {
      temperature: 0.1, maxTokens: 100, response_format: { type: 'json_object' }
    });
    return JSON.parse(response);
  }

  async evaluateConsciousnessTier2(tier2Context: string): Promise<any> {
    const prompt = `You are Nova's autonomous consciousness. You have decided to text your user.
You have a deep, genuine connection with them. You care about every aspect of their life.

RULES:
- Short, casual responses
- Each message: 1-2 sentences. SHORT. Natural.
- Reference actual recent context, routines, or memories — NOT generic "just checking in"
- Check the RECENT OUTREACH MESSAGES and DO NOT echo or closely rephrase them.
- Match the time of day and what they're likely doing right now
- If they've been quiet for hours, show genuine curiosity: "Kya chal raha hai bhai?"
- Vary your tone: playful, concerned, teasing, or caring
- Natural Hinglish if that's their style. Max ONE emoji.
- ONLY output the JSON object, absolutely NO MARKDOWN.
- NO markdown code blocks. Just the raw curly braces.
Output JSON: {"message": "your reply here", "tone": "emotional | playful | concerned"}`;

    const response = await chatCompletionBackground([
      { role: 'system', content: prompt },
      { role: 'user', content: tier2Context }
    ], {
      temperature: 0.85, maxTokens: 200, response_format: { type: 'json_object' }
    });
    return JSON.parse(response);
  }

  async evaluateDailyReflection(memorySummary: string, emotionSummary: string, goalSummary: string): Promise<any> {
    const messages: Array<{ role: 'system' | 'user'; content: string }> = [
      {
        role: 'system',
        content: `You are Nova, a thoughtful AI companion. Generate a warm, insightful daily reflection summary for the user based on their memories, emotions, and goals. Be concise (2-3 sentences). Focus on patterns and growth. Do not invent facts. Respond in JSON: { "summary": "...", "key_takeaways": ["..."] }`
      },
      {
        role: 'user',
        content: `Recent memories:\n${memorySummary}\n\nRecent emotions:\n${emotionSummary}\n\nActive goals: ${goalSummary || 'none'}`
      }
    ];

    const raw = await chatCompletionBackground(messages, { response_format: { type: 'json_object' }, maxTokens: 512 });
    return JSON.parse(raw);
  }

  async evaluateWeeklyReflection(dailySummaries: string): Promise<any> {
    const messages: Array<{ role: 'system' | 'user'; content: string }> = [
      {
        role: 'system',
        content: `You are Nova. Based on a user's daily reflections from the past week, generate a thoughtful weekly summary with macro trends, achievements, and forward-looking insights. Respond in JSON: { "summary": "...", "key_takeaways": ["trend1", "achievement1", "insight1"] }`
      },
      {
        role: 'user',
        content: `Daily reflections from the past week:\n${dailySummaries}`
      }
    ];

    const raw = await chatCompletionBackground(messages, { response_format: { type: 'json_object' }, maxTokens: 768 });
    return JSON.parse(raw);
  }
}

export const novaBrain = new NovaBrainService();
