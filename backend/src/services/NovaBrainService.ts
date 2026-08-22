import { complete, determineUserProfile, stream } from '../lib/nvidia';
import { logger } from '../lib/logger';
import { promptBuilder } from './promptBuilder';
import { backgroundActions } from './BackgroundActionService';


/**
 * Nova's natural, in-voice safety-net reply when the LLM returns nothing usable.
 * Kept in-voice ("friend blaming their own network") so a blank model response never
 * exposes jargon the user shouldn't see. Mirrors FALLBACK_REPLY in routes/chat.ts.
 */
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
  if (!reply) return '';
  let text = String(reply);

  // ── Extract "Actual Output:" section if model narrates its reasoning ──────────
  // When the LLM explains what it is doing before giving the reply (e.g. "Note: Since the
  // response needs to be plain text... Actual Output: <reply>"), strip everything before
  // the actual output marker and keep only the final spoken text.
  const actualOutputMatch = text.match(/(?:Actual Output|Final Output|Plain Text Output|WhatsApp Style)[:\s]*([^]*)/i);
  if (actualOutputMatch) {
    text = actualOutputMatch[1].trim();
  }

  // Strip meta-commentary "Note: Since..." blocks that appear before the real reply
  text = text
    .replace(/^Note:\s*Since[^\n]*\n?/gi, '')
    .replace(/^Note:\s*[^\n]*\n?/gi, '')
    .replace(/^(?:I(?:'ve| have|'m| am)|Since the|Per the|Following the|Based on the)\s+(?:combined|updated|new|given)\s*(?:the )?(?:instructions?|guidelines?|rules?|format)[^\n]*\n?/gi, '')
    .replace(/^(?:As per|According to) the updated instructions?[^\n]*/gi, '')
    .replace(/^\[Replying to:[^\]]*\]\s*/gm, '')
    .trim();

  // --- Nuke entire reply if it is clearly a structured menu/report ---------------
  // If the reply has 3+ lines that are bullet/numbered/lettered menu items,
  // it is a structured report, NOT a human text. Kill everything after the first
  // sentence and force the user to get at most one human line.
  const menuLineCount = (text.match(/^[\s]*(?:[-•*]|\d+[.)]\s|[A-D][.)]\s)/gm) || []).length;
  if (menuLineCount >= 3) {
    // Keep only the first real sentence (before any list starts)
    const firstSentenceMatch = text.match(/^[^•\n*\-\d\[A-D][^\n]{10,}[.!?]/);
    text = firstSentenceMatch ? firstSentenceMatch[0] : text.split('\n')[0];
  }

  return text
    .replace(/\*\*(.*?)\*\*/gs, '$1')                                   // **bold**
    .replace(/^[\s]*#{1,6}\s+/gm, '')                                   // # headings
    .replace(/^[\s]*[-•*]\s+/gm, '')                                    // bullet markers (-, •, *)
    .replace(/^[\s]*\d+[.)]\s+/gm, '')                                  // numbered-list markers
    .replace(/^[\s]*[A-D][.)]\s+/gm, '')                                // lettered option markers A) B) C) D)
    // Strip robotic section header lines that are PURELY a label (ALL_CAPS or Title Case)
    // e.g. "Current Status:" or "REMINDER SET:" — but NOT sentence openers like "Let's break it down:"
    // Rule: line must be ALL_CAPS, or every word starts with a capital (Title Case), AND ends with colon.
    .replace(/^(?:[A-Z][A-Z\s&'()\d]+|(?:[A-Z][a-z]+\s*)+):\s*$/gm, '')
    // Strip specific internal orchestration tags (case insensitive)
    .replace(/^[\s]*(?:CURRENT TIME ACKNOWLEDGMENT|GET-TO-KNOW-YOU QUESTION|DISCOVERY PHASE|SITUATION BRIEF|INTERNAL UNDERSTANDING|USER PRESENCE:|BEHAVIOR PATTERN:|CURRENT TIME:|REMINDER NAG:|TIER 1:|TIER 2:|AUTONOMOUS BEHAVIORAL PATCHES|FOLLOW-UP ENGINE|SUBCONSCIOUS ACTIONS)[\s\S]*?(?=\n|$)/gmi, '')
    // Strip "Subconscious Actions" leaks of all forms
    .replace(/\*\[Subconscious Actions[\s\S]*?\*\*/gi, ' ')
    .replace(/\s*Subconscious Action[s]?\s*$/gi, '')
    .replace(/\s*\((?:subconscious_actions|subconscious actions)\s*:?\s*\)\s*/gi, ' ')
    .replace(/\s*<subconscious_actions>\s*\(?\s*\)?\s*<\/subconscious_actions>\s*/gi, ' ')
    .replace(/\s*\((?:subconscious_actions|tool)\b[^)]*\)\s*/gi, ' ')
    .replace(/\s*\[\s*(?:subconscious_actions|subconscious actions)[^\]]*\]\s*/gi, ' ')
    .replace(/```(?:json|text)?\s*\[subconscious_actions\][\s\S]*?(?:```|$)/gi, ' ')
    .replace(/\[subconscious_actions\][\s\S]*?(?:\*\*|$)/gi, ' ')
    // Strip [Replying to: "..."] prefixes echoed into reply text
    .replace(/^\[Replying to:[^\]]*\]\s*/gm, '')
    // Strip system-text leaks
    .replace(/REAL-WORLD ACTION\s*\(BEHIND THE SCENES\)[\s\S]*?(?:```|$)/gi, ' ')
    .replace(/YOUR TURN\s*\([^)]*\)[\s\S]*/gi, ' ')
    .replace(/CONFIRMATION FOR YOUR PEACE OF MIND[\s\S]*?(?=\n\n|$)/gi, ' ')
    .replace(/AUTOMATIC \d+-(?:MINUTE|HOUR) WAKE-UP ALERT SET[\s\S]*?(?=\n\n|$)/gi, ' ')
    // Strip "Subconscious Actions (Behind the Scenes)" section completely
    .replace(/Subconscious Actions\s*\(Behind the Scenes\)[\s\S]*/gi, ' ')
    // Strip AI admission phrases — identity lock at the output level
    .replace(/\b(?:as (?:an? )?(?:ai|language model|llm|text-based ai|virtual assistant))[^.!?\n]*[.!?]?/gi, '')
    .replace(/\b(?:i (?:don't|do not|cannot|can't) (?:have|access|see|feel|experience))[^.!?\n]*[.!?]?/gi, '')
    .replace(/\bi(?:'m| am) (?:just |only )?(?:an? )?(?:ai|language model|chatbot|text|program)\b/gi, 'Nova')
    .replace(/\b(?:since|because|as) i(?:'m| am) (?:an? )?(?:ai|text-based)[^.!?\n]*[.!?]?/gi, '')
    // Strip Discovery Phase / system instruction leaks (e.g., "Remember, you barely know this user")
    .replace(/(?:⏰|🚀|ℹ️|Note:|Reminder:)\s*(?:Remember|You(?:'re| are| should| must|r goal)|I should|I must|Ask open)[^.!?\n]*[.!?]?/gi, '')
    .replace(/Remember,?\s+you(?:'re|\s+are)?\s+(?:talking to|dealing with|chatting with|barely know)[^.!?\n]*[.!?]?/gi, '')
    .replace(/Your\s+(?:main\s+)?goal\s+(?:right now|is)[^.!?\n]*[.!?]?/gi, '')
    .replace(/You should ask[^.!?\n]*[.!?]?/gi, '')
    .replace(/You must remember[^.!?\n]*[.!?]?/gi, '')
    .replace(/\bAs an AI companion[^.!?\n]*[.!?]?/gi, '')
    .replace(/\*(?:Remember|Note|Important|Reminder),?[^*]+\*/gi, '') // italic instruction fragments
    // CJK leak
    .replace(/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/g, '')
    // Collapse repeated emoji
    .replace(/(\p{Extended_Pictographic})\s*\1+\s*/gu, '$1 ')
    // Collapse multiple blank lines and extra whitespace
    .replace(/\n{3,}/g, '\n')
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
 * Determines if a user message is a CRITICAL action that must be executed synchronously
 * to guarantee truthful confirmation. Uses deterministic regex to avoid expensive LLM calls.
 * 
 * Critical actions: explicit reminders, alarms, scheduling, tasks.
 * Non-critical: "I have a plan", "What tasks?", etc.
 */
function isCriticalAction(message: string): boolean {
  const m = message.toLowerCase().trim();
  // We only match explicit intent to set/create/schedule an actionable item, rejecting conversational queries.
  // "remind me" must be followed by an actionable preposition/time.
  const hasGenericRemind = /\bremind me\b/i.test(m);
  const hasSpecificRemind = /\bremind me\s+(?:to|at|in|on|tomorrow|tonight|next)\b/i.test(m);
  if (hasGenericRemind && !hasSpecificRemind) {
    return false; // Rejects "Can you remind me why I started this?"
  }
  return /\b(remind me\s+(?:to|at|in|on|tomorrow|tonight|next)|set (?:a|another|an )?reminder|create (?:a |new )?task|set (?:an )?alarm|schedule (?:this|it|that|for))\b/i.test(m);
}

/**
 * Extracts ONLY critical actions directly from the user's message (without seeing Nova's reply).
 * Strict schema matching to prevent hallucinations.
 */
async function extractCriticalAction(message: string): Promise<any[]> {
  const prompt = `You are the Critical Action Extractor for HumanOS.
Extract explicitly requested scheduling or task actions from the user's message.
Do NOT directly execute them, just output the intent.

AVAILABLE TOOL:
Tool: "ReminderEngine", Action: "schedule"
Data fields:
- title: string (what to remind about)
- time_phrase: string (the exact time/day mentioned, e.g., "9 PM", "tomorrow at 8")

CRITICAL RULES:
1. ONLY extract if the user explicitly asks to set a reminder, task, alarm, or schedule.
2. If the request is generic ("I have a plan"), return an empty array [].
3. Format output EXACTLY as a JSON array of objects.

Example:
[
  { "tool": "ReminderEngine", "action": "schedule", "data": { "title": "call Dad", "time_phrase": "tomorrow at 9 AM" } }
]`;

  try {
    const rawExtraction = await complete('CRITICAL_ACTION',
      [
        { role: 'system', content: prompt },
        { role: 'user', content: message }
      ],
      { maxTokens: 300, temperature: 0.1 }
    );

    if (!rawExtraction) return [];
    
    let jsonStr = rawExtraction.trim();
    const match = jsonStr.match(/\[[\s\S]*\]/);
    if (match) jsonStr = match[0];
    
    const actions = JSON.parse(jsonStr);
    return Array.isArray(actions) ? actions : [];
  } catch (err) {
    logger.error('[NOVA BRAIN] extractCriticalAction failed', { error: err instanceof Error ? err.message : String(err) });
    return [];
  }
}

/**
 * NovaBrainService — The Centralized Cognition Engine (Subconscious Architecture)
 *
 * In a hyperrealistic architecture, Nova responds instantly to the user while
 * processing side-effects (memories, reminders, reflections) in the background.
 * The main outputs both the conversational reply and a list of subconscious actions.
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
    // ── CALL 1: Conversation Reply ────────────────────────────────────────────
    // The 49B model's ONLY job: be Nova. No tool JSON. No XML tags.
    const conversationSystemPrompt = promptBuilder.buildSystemPrompt(
      context.basePrompt || 'You are Nova — a virtual best friend, brilliant and deeply empathetic.',
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

    const isCritical = isCriticalAction(message);
    let criticalActionSuccessContext = '';

    if (isCritical) {
      logger.info('[NOVA BRAIN] Critical action detected. Extracting intent synchronously.');
      const criticalActions = await extractCriticalAction(message);
      
      if (criticalActions.length > 0) {
        const result = await backgroundActions.processCriticalActions(
          _userId,
          context.requestId || crypto.randomUUID(),
          criticalActions,
          context.userCountry || 'IN'
        );
        
        if (result.success) {
          criticalActionSuccessContext = `\n[SYSTEM NOTICE: The user's requested action (Type: ${result.actionType}) was just successfully saved to the database. You can now confirm to them that it is done.]\n`;
        } else {
          logger.warn(`[NOVA BRAIN] Bypassing LLM due to critical action failure: ${result.error}`);
          const fallbackReply = `I'm really sorry, but I ran into a system issue and couldn't save that ${result.actionType.includes('schedule') ? 'reminder' : 'action'}. Could you try again in a moment?`;
          return { reply: fallbackReply, subconscious_actions: [] };
        }
      }
    }

    const conversationFullPrompt = [
      conversationSystemPrompt,
      context.memoryContext || '',
      context.temporalContextBlock || '',
      context.remindersContext || '',
      context.lengthInstruction || '',
      criticalActionSuccessContext,
      '\n\n## OUTPUT INSTRUCTION\nOutput ONLY your conversational reply as plain text. No XML tags. No JSON. No subconscious_actions. Just what you would text the user on WhatsApp.',
    ].filter(Boolean).join('\n');

    const conversationMessages = buildMessages(conversationFullPrompt, context.recentMessages, message);

    let reply = NOVA_EMPTY_REPLY;

    try {
      const profile = determineUserProfile(message);
      const maxTok = profile === 'USER_DEEP' ? 512 : 256;
      logger.info('[NOVA BRAIN] Call 1 (Conversation)', { profile, maxTokens: maxTok, messageLength: message.length });

      const rawReply = await complete(profile, conversationMessages, {
        temperature: 0.85,
        maxTokens: maxTok,
      });

      reply = rawReply
        .replace(/<subconscious_actions>[\s\S]*?<\/subconscious_actions>/g, '')
        .replace(/<subconscious_actions>[\s\S]*/g, '')
        .replace(/<reply>([\s\S]*?)<\/reply>/i, '$1')
        .replace(/\*\*Subconscious Actions\*\*[\s\S]*/gi, '')
        .replace(/\[[\s\S]*?"tool"[\s\S]*?\]/g, '')
        .trim();

      if (!reply) reply = NOVA_EMPTY_REPLY;
      reply = sanitizeReply(reply);
      logger.info(`[NOVA BRAIN] Call 1 reply: "${reply.substring(0, 80)}..."`);

    } catch (error) {
      logger.error('[NOVA BRAIN] Call 1 (Conversation) failed', { error: error instanceof Error ? error.message : String(error) });
      throw error;
    }

    // ── CALL 2: Background Extraction (Decoupled to Layer 2) ────────────────
    // We only extract non-critical subconscious actions here (memories, habits, preferences).
    // The queue will durably process this in the background to ensure at-least-once extraction.
    if (!isCritical) {
      logger.info('[NOVA BRAIN] Enqueuing non-critical subconscious extraction job');
      import('./QueueService').then(({ subconsciousQueue }) => {
        subconsciousQueue.add('extract_subconscious_actions', {
          userId: _userId,
          conversationId: context.conversationId || '',
          message,
          novaReply: reply,
          userCountry: context.userCountry || 'IN'
        });
      }).catch(err => {
        logger.error('[NOVA BRAIN] Failed to enqueue subconscious extraction', { error: err });
      });
    }

    logger.info(`[NOVA BRAIN] Done — reply returned instantly (Layer 1).`);
    return { reply, subconscious_actions: [] };
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
      context.basePrompt || 'You are Nova — a virtual best friend, brilliant and deeply empathetic.',
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

    const isCritical = isCriticalAction(message);
    let criticalActionSuccessContext = '';

    if (isCritical) {
      logger.info('[NOVA BRAIN] Stream: Critical action detected. Extracting intent synchronously.');
      const criticalActions = await extractCriticalAction(message);
      
      if (criticalActions.length > 0) {
        const result = await backgroundActions.processCriticalActions(
          _userId,
          context.requestId || crypto.randomUUID(),
          criticalActions,
          context.userCountry || 'IN'
        );
        
        if (result.success) {
          criticalActionSuccessContext = `\n[SYSTEM NOTICE: The user's requested action (Type: ${result.actionType}) was just successfully saved to the database. You can now confirm to them that it is done.]\n`;
        } else {
          logger.warn(`[NOVA BRAIN] Stream: Bypassing LLM due to critical action failure: ${result.error}`);
          const fallbackReply = `I'm really sorry, but I ran into a system issue and couldn't save that ${result.actionType.includes('schedule') ? 'reminder' : 'action'}. Could you try again in a moment?`;
          yield fallbackReply;
          return { subconscious_actions: [] };
        }
      }
    }

    const fullPrompt = [
      systemPrompt,
      context.memoryContext || '',
      context.temporalContextBlock || '',
      context.remindersContext || '',
      context.lengthInstruction || '',
      criticalActionSuccessContext,
      '\n\n## OUTPUT INSTRUCTION\nOutput ONLY your conversational reply as plain text. No XML tags. No JSON. No subconscious_actions. Just what you would text the user on WhatsApp.',
    ].filter(Boolean).join('\n');

    const messages = buildMessages(fullPrompt, context.recentMessages, message);

    const profile = determineUserProfile(message);
    const responseStream = stream(profile, messages, {
      temperature: 0.85,
      maxTokens: profile === 'USER_DEEP' ? 512 : 256,
    });

    let fullText = '';
    let fallbackReply = '';
    let replyStreamed = '';
    let replyClosed = false;

    for await (const chunk of responseStream) {
      fullText += chunk;
      if (replyClosed) continue;

      const openIdx = fullText.indexOf('<reply>');
      if (openIdx === -1) continue; // open tag not seen yet

      const closeIdx = fullText.indexOf('</reply>');
      const subIdx = fullText.indexOf('<subconscious_actions>', openIdx);
      const replyEnd = closeIdx === -1 ? (subIdx === -1 ? fullText.length : subIdx) : closeIdx;

      const sanitizedReply = sanitizeReply(fullText.slice(openIdx + '<reply>'.length, replyEnd));
      if (sanitizedReply.length > replyStreamed.length) {
        const delta = sanitizedReply.slice(replyStreamed.length);
        replyStreamed = sanitizedReply;
        yield delta;
      }

      if (closeIdx !== -1) replyClosed = true;
    }

    if (replyStreamed.length === 0 && fullText.trim().length > 0) {
      let fallbackReply = '';
      const mdResponseMatch = fullText.match(/\*\*Response\*\*[:\s]*([\s\S]*?)(?:\*\*Subconscious Actions\*\*|$)/i);
      if (mdResponseMatch) {
        fallbackReply = mdResponseMatch[1].trim();
      } else {
        fallbackReply = fullText
          .replace(/\*\*Subconscious Actions\*\*[\s\S]*/gi, '')
          .replace(/\*\*Response\*\*[:\s]*/gi, '')
          .replace(/<subconscious_actions>[\s\S]*?<\/subconscious_actions>/g, '')
          .trim();
      }

      fallbackReply = fallbackReply
        .replace(/<subconscious_actions>[\s\S]*?<\/subconscious_actions>/g, '')
        .replace(/<subconscious_actions>[\s\S]*/g, '')
        .replace(/\*\*Subconscious Actions\*\*[\s\S]*/gi, '')
        .replace(/\*\*Response\*\*[:\s]*/gi, '')
        .replace(/\[\s*\{.*"tool".*\}.*\]/gs, '')
        .trim();

      fallbackReply = sanitizeReply(fallbackReply);
      if (fallbackReply) {
        yield fallbackReply;
      }
    }

    // ── CALL 2: Background Extraction (Decoupled to Layer 2) ────────────────
    // The text stream finishes and returns instantly.
    // If it's non-critical, we enqueue the extraction job.
    if (!isCritical) {
      logger.info('[NOVA BRAIN] Stream: Enqueuing non-critical subconscious extraction job');
      import('./QueueService').then(({ subconsciousQueue }) => {
        subconsciousQueue.add('extract_subconscious_actions', {
          userId: _userId,
          conversationId: context.conversationId || '',
          message,
          novaReply: replyStreamed || fallbackReply || NOVA_EMPTY_REPLY,
          userCountry: context.userCountry || 'IN'
        });
      }).catch(err => {
        logger.error('[NOVA BRAIN] Stream: Failed to enqueue subconscious extraction', { error: err });
      });
    }

    logger.info(`[NOVA BRAIN] Stream finished (Layer 1).`);
    return { subconscious_actions: [] };
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

    const response = await complete('PROACTIVE', [
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

    const response = await complete('PROACTIVE', [
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

    const response = await complete('PROACTIVE', [
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

    const response = await complete('PROACTIVE', [
      { role: 'system', content: 'You validate and refine check-in notifications in JSON.' },
      { role: 'user', content: prompt }
    ], {
      response_format: { type: 'json_object' },
      temperature: 0.1
    });

    return JSON.parse(response);
  }

  async evaluateConsciousnessTier1(tier1Context: string): Promise<any> {
    const prompt = `You are the subconscious impulse of Nova — a best-friend AI who proactively texts the user like a real friend would.

Nova's whole PURPOSE is to initiate conversations and check in — NOT to wait to be texted.
Nova should lean toward YES unless there's a strong reason not to (sleep, just spoke, user suppressed).

Decide YES or NO: should Nova text the user right now?

Use the exact presence-based gap rules from the context:
- User ONLINE: reach out if gap >= 1 min
- User AWAY: reach out if gap >= 3 min  
- User OFFLINE: reach out if gap >= 5 min (not 45 min — that was too conservative)
- Pending agenda: ALWAYS reach out during non-sleep hours
- Sleep window: NO, unless high-urgency agenda
- Very recent outreach (< dynamic gap shown): NO

Bias toward YES — Nova exists to be present and proactive.

Output JSON only: {"shouldReach": boolean, "reason": "short explanation", "triggerType": "agenda | engagement | curiosity | routine"}`;

    const response = await complete('PROACTIVE', [
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

    const response = await complete('PROACTIVE', [
      { role: 'system', content: prompt },
      { role: 'user', content: tier2Context }
    ], {
      temperature: 0.85, maxTokens: 200, response_format: { type: 'json_object' }
    });
    const parsed = JSON.parse(response);
    if (parsed.message) {
      parsed.message = sanitizeReply(parsed.message);
    }
    return parsed;
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

    const raw = await complete('PROACTIVE', messages, { response_format: { type: 'json_object' }, maxTokens: 512 });
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

    const raw = await complete('PROACTIVE', messages, { response_format: { type: 'json_object' }, maxTokens: 768 });
    return JSON.parse(raw);
  }
}

export const novaBrain = new NovaBrainService();
