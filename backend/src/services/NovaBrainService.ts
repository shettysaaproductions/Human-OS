import { chatCompletion, chatCompletionBackground } from '../lib/nvidia';
import { logger } from '../lib/logger';
import { promptBuilder } from './promptBuilder';

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
      'You are Nova, an autonomous AI companion. You have a central subconscious brain that processes side-effects.',
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

    const fullPrompt = `${systemPrompt}

## 🧠 SUBCONSCIOUS ACTIONS & STREAMING (CRITICAL FORMAT)
You are capable of generating a conversational reply AND taking background actions simultaneously.
You MUST format your EXACT output using these two XML tags:

<reply>
Your conversational text response here. Max 1-2 sentences. Use natural Hinglish if that's the user's style.
</reply>
<subconscious_actions>
[
  { "tool": "MomentEngine", "action": "extract", "data": { "moment": "...", "emotion": "..." } }
]
</subconscious_actions>

Available Tools for Subconscious Actions:
1. "MomentEngine" -> "extract": Extract a core life event or emotional moment from the text.
   - data: { "moment": "brief description", "emotion": "happy/sad/etc", "importance": 1-10 }
2. "ReminderEngine" -> "schedule": Set a reminder ONLY IF EXPLICITLY ASKED.
   - data: { "time_phrase": "tomorrow at 10am", "description": "what to remind" }
3. "NovaFollowupService" -> "queue": Queue a follow-up if you ask a question or want to keep the chat going. If they leave you on read, this fires to double-text them (e.g. "hey?", "busy?").
   - data: { "question": "the follow-up text", "delay_hours": 0.1 } (Use 0.1 for 6 mins, 0.25 for 15 mins)
4. "MemoryRepository" -> "save": Save a factual detail about the user.
   - data: { "key": "category_name", "value": "detail" }
5. "LifeEventExtractor" -> "event": Log an upcoming event, meeting, or time-sensitive thing the user mentioned.
   - data: { "description": "Short description", "expected_time": "ISO 8601 timestamp", "follow_up_question": "What to ask later", "follow_up_after_minutes": 60, "urgency": "high|medium|low", "is_recurring": false }
6. "LifeEventExtractor" -> "routine": Extract a recurring routine or habit the user mentioned.
   - data: { "routineType": "sleep | diet | activity | general", "description": "Short description of the routine" }
7. "AgendaManager" -> "update_status": Mark a previously discussed agenda item or task as completed, cancelled, or snoozed. Use this when the user says they finished a task or asks you to forget it.
   - data: { "task_description": "the task they finished", "status": "completed|cancelled|snoozed" }

If no tools need to be called, leave the JSON array empty: []
`;

    const messages = [
      { role: 'system' as const, content: fullPrompt },
      ...(context.recentMessages || []).map((m: any) => ({ role: m.role, content: m.content })),
      { role: 'user' as const, content: message }
    ];

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
        // Fallback: If tags are missing, assume the whole response is the reply
        reply = rawRes.replace(/<subconscious_actions>[\s\S]*?<\/subconscious_actions>/g, '').trim();
      }

      // Safety strip: Remove any XML or JSON bleed from the reply
      reply = reply
        .replace(/<subconscious_actions>[\s\S]*?<\/subconscious_actions>/g, '')
        .replace(/<subconscious_actions>[\s\S]*/g, '') // unclosed tag
        .replace(/\[\s*\{.*"tool".*\}.*\]/gs, '') // JSON array bleed
        .trim();

      if (!reply) reply = "Yaar, ek second ruk."; // absolute last resort

      const subMatch = rawRes.match(/<subconscious_actions>([\s\S]*?)<\/subconscious_actions>/);
      if (subMatch) {
        try {
          subconscious_actions = JSON.parse(subMatch[1].trim());
        } catch (e) {
          logger.warn('[NOVA BRAIN] Failed to parse subconscious actions JSON', { error: e });
        }
      }

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
      'You are Nova, an autonomous AI companion. You have a central subconscious brain that processes side-effects.',
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

    const fullPrompt = `${systemPrompt}

## 🧠 SUBCONSCIOUS ACTIONS & STREAMING (CRITICAL FORMAT)
You are capable of generating a conversational reply AND taking background actions simultaneously.
You MUST format your EXACT output using these two XML tags:

<reply>
Your conversational text response here. Max 1-2 sentences. Use natural Hinglish if that's the user's style.
</reply>
<subconscious_actions>
[
  { "tool": "MomentEngine", "action": "extract", "data": { "moment": "...", "emotion": "..." } }
]
</subconscious_actions>

Available Tools for Subconscious Actions:
1. "MomentEngine" -> "extract": Extract a core life event or emotional moment from the text.
   - data: { "moment": "brief description", "emotion": "happy/sad/etc", "importance": 1-10 }
2. "ReminderEngine" -> "schedule": Set a reminder ONLY IF EXPLICITLY ASKED.
   - data: { "time_phrase": "tomorrow at 10am", "description": "what to remind" }
3. "NovaFollowupService" -> "queue": Queue a follow-up if you ask a question or want to keep the chat going. If they leave you on read, this fires to double-text them (e.g. "hey?", "busy?").
   - data: { "question": "the follow-up text", "delay_hours": 0.1 } (Use 0.1 for 6 mins, 0.25 for 15 mins)
4. "MemoryRepository" -> "save": Save a factual detail about the user.
   - data: { "key": "category_name", "value": "detail" }
5. "LifeEventExtractor" -> "event": Log an upcoming event, meeting, or time-sensitive thing the user mentioned.
   - data: { "description": "Short description", "expected_time": "ISO 8601 timestamp", "follow_up_question": "What to ask later", "follow_up_after_minutes": 60, "urgency": "high|medium|low", "is_recurring": false }
6. "LifeEventExtractor" -> "routine": Extract a recurring routine or habit the user mentioned.
   - data: { "routineType": "sleep | diet | activity | general", "description": "Short description of the routine" }
7. "AgendaManager" -> "update_status": Mark a previously discussed agenda item or task as completed, cancelled, or snoozed. Use this when the user says they finished a task or asks you to forget it.
   - data: { "task_description": "the task they finished", "status": "completed|cancelled|snoozed" }

If no tools need to be called, leave the JSON array empty: []
`;

    const messages = [
      { role: 'system' as const, content: fullPrompt },
      ...(context.recentMessages || []).map((m: any) => ({ role: m.role, content: m.content })),
      { role: 'user' as const, content: message }
    ];

    const { chatCompletionStream } = await import('../lib/nvidia');
    const stream = chatCompletionStream(messages, {
      temperature: 0.85,
      maxTokens: 1024
    });

    let fullText = '';
    let isInsideReply = false;
    let replyStreamed = '';

    for await (const chunk of stream) {
      fullText += chunk;

      // Start streaming once we see the open tag
      if (!isInsideReply && fullText.includes('<reply>')) {
        isInsideReply = true;
        // Output whatever came after <reply>
        const afterTag = fullText.split('<reply>')[1];
        if (afterTag) {
          replyStreamed += afterTag;
          yield afterTag;
        }
        continue;
      }

      if (isInsideReply) {
        // Stop streaming once we see the close tag
        if (fullText.includes('</reply>')) {
          const newContent = chunk.split('</reply>')[0];
          if (newContent) {
            replyStreamed += newContent;
            yield newContent;
          }
          isInsideReply = false;
        } else {
          replyStreamed += chunk;
          yield chunk;
        }
      }
    }

    let subconscious_actions: any[] = [];
    const subMatch = fullText.match(/<subconscious_actions>([\s\S]*?)<\/subconscious_actions>/);
    if (subMatch) {
      try {
        subconscious_actions = JSON.parse(subMatch[1].trim());
      } catch (e) {
        logger.warn('[NOVA BRAIN] Failed to parse subconscious actions JSON', { error: e });
      }
    }

    logger.info(`[NOVA BRAIN] Stream finished. Generated ${subconscious_actions.length} subconscious actions.`);
    return { subconscious_actions };
  }

  // ── Engine Extractors (Background / CRON jobs) ──────────────

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
