import { complete, determineUserProfile } from '../lib/nvidia';
import { cognitiveRouter } from '../lib/cognitiveRouter';
import { logger } from '../lib/logger';
import { promptBuilder } from './promptBuilder';
import { backgroundActions } from './BackgroundActionService';



/**
 * Nova's natural, in-voice safety-net reply when the LLM returns nothing usable.
 * Kept in-voice ("friend blaming their own network") so a blank model response never
 * exposes jargon the user shouldn't see. Mirrors FALLBACK_REPLY in routes/chat.ts.
 */
export const NOVA_EMPTY_REPLY = 'Hmm... mujhe thoda sochne de, main abhi batati hu thodi der me.';

export interface NormalizedMessage {
  message: string;
  client_message_id?: string;
  reply_to_id?: string;
  reply_to_content?: string;
  image_base64?: string;
}

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
 * Deterministic Grounding & Anti-Fabrication Validator (Phase 10.1 Hardening)
 *
 * Inspects LLM responses (from both Gemini and NVIDIA) to detect and repair
 * unsupported factual assertions (e.g., invented ages, false personal claims,
 * self-hallucinations, and confident answers to unknown personal facts).
 */
export function validateAndRepairGrounding(
  reply: string,
  userMessage: string = '',
  context: any = {}
): string {
  if (!reply) return reply;
  let text = reply;

  // 1. Repair Self-Contradictory / AI Spouse Hallucinations (e.g., "mere wife ka naam Sakshi hai")
  text = text
    .replace(/\bmere\s+wife\b/gi, 'tumhari wife')
    .replace(/\bmeri\s+wife\b/gi, 'tumhari wife')
    .replace(/\bmeri\s+biwi\b/gi, 'tumhari biwi')
    .replace(/\bmere\s+husband\b/gi, 'tumhare husband')
    .replace(/\bmere\s+pati\b/gi, 'tumhare pati');

  // Build searchable context text to verify grounded assertions
  const allContextStrings: string[] = [userMessage];
  if (Array.isArray(context.memories)) {
    context.memories.forEach((m: any) => allContextStrings.push(m.value || m.content || JSON.stringify(m)));
  }
  if (Array.isArray(context.workingMemories)) {
    context.workingMemories.forEach((m: any) => allContextStrings.push(m.value || m.content || JSON.stringify(m)));
  }
  if (Array.isArray(context.recentMessages)) {
    context.recentMessages.forEach((m: any) => allContextStrings.push(typeof m === 'string' ? m : (m.content || '')));
  }
  const fullContextText = allContextStrings.join(' ').toLowerCase();

  // 2. Unsupported Age Invention Detection (e.g. Model asserts "5 mahine mein toh...")
  const ageMatch = text.match(/\b(\d+)\s*(mahine|saal|months?|years?|yo)\b/i);
  if (ageMatch) {
    const numberStr = ageMatch[1];
    const unitStr = ageMatch[2].toLowerCase();
    const patternInContext = new RegExp(`\\b${numberStr}\\s*${unitStr.substring(0, 3)}`, 'i');
    const exactNumberInContext = new RegExp(`\\b${numberStr}\\b`);

    if (!patternInContext.test(fullContextText) && !exactNumberInContext.test(fullContextText)) {
      // Invented age detected — do not replace with a softened assumption.
      // Use a genuinely grounded admission / clarification.
      logger.warn('[GroundingValidator] Detected unsupported age assertion in reply, repairing to grounded clarification', {
        inventedAge: ageMatch[0],
        replySnippet: text.substring(0, 60),
      });

      // If the reply contains a hallucinated child age or development milestone based on invented age:
      text = 'Mujhe uski age ya details abhi nahi pata yaar, kitne saal ka hai woh?';
    }
  }

  // 3. Unknown Personal Fact Question Guard (e.g. "mera favourite colour kya hai?")
  const lowerUser = userMessage.toLowerCase();
  const isAskingUnknownPersonalFact =
    /\b(mera|meri|hum|humne|hum log)\s+(?:favourite|favorite|fav|kahan|kab|kaunsa)\b/i.test(lowerUser) ||
    /\b(kal hum kahan gaye the|hum kal kahan the|mera favourite colour|mera favourite khana)\b/i.test(lowerUser);

  if (isAskingUnknownPersonalFact) {
    const hasGroundedAnswerInContext =
      (context.memories && context.memories.length > 0) ||
      (context.workingMemories && context.workingMemories.length > 0);

    // If context is completely empty of relevant memories, ensure model doesn't fabricate an assertive specific answer
    if (!hasGroundedAnswerInContext) {
      const isFabricatingSpecificAnswer =
        /\b(gaye the|gayee thi|tha hum|tumhara favourite|tera favourite)\s+([a-zA-Z]+)/i.test(text) &&
        !/\b(yaad nahi|pata nahi|tu hi bata|batao na|yaad nahi aa raha)\b/i.test(text);

      if (isFabricatingSpecificAnswer) {
        logger.warn('[GroundingValidator] Detected confident answer to unknown personal fact, replacing with grounded admission');
        if (lowerUser.includes('kahan gaye') || lowerUser.includes('kahan the')) {
          text = 'Haha kal hum mile the kya? Mujhe toh lagta hai kal baat nahi hui thi!';
        } else {
          text = 'Mujhe abhi yaad nahi aa raha yaar, tu hi bata na!';
        }
      }
    }
  }

  return text.trim();
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
    messages: NormalizedMessage[],
    context: any // Aggregated context from Temporal, Situational, Memory engines
  ): Promise<{ reply: string; subconscious_actions: any[] }> {
    
    const criticalActionSuccessContext = ''; // No more LLM-blocking critical action evaluation
    
    for (const msg of messages) {
        if (!msg.client_message_id) continue;
        
        // Critical Actions (synchronous, but we use the result directly without blocking the LLM)
        try {
            const actions = await extractCriticalAction(msg.message);
            if (actions && actions.length > 0) {
                await backgroundActions.processCriticalActions(_userId, msg.client_message_id, actions, context.userCountry || 'IN');
                logger.info('[NOVA BRAIN] Synced critical reminder action.', { userId: _userId, messageId: msg.client_message_id });
            }
        } catch (e) {
            logger.error(`[NOVA BRAIN] Sync critical action failed for ${msg.client_message_id}`, { error: e });
        }
    }

    // ── CALL 2: Subconscious Action Engine ────────────────────────────────────────────
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
      context.situationBrief,
      context.profile?.grammatical_gender,
      context.turnAnalysisBlock
    );

    const conversationFullPrompt = [
      conversationSystemPrompt,
      context.memoryContext || '',
      context.temporalContextBlock || '',
      context.remindersContext || '',
      context.lengthInstruction || '',
      criticalActionSuccessContext,
      '\n\n## OUTPUT INSTRUCTION\nOutput ONLY your conversational reply as plain text. No XML tags. No JSON. No subconscious_actions. Just what you would text the user on WhatsApp.',
    ].filter(Boolean).join('\n');

    const combinedUserMessage = messages.map((m, i) => messages.length > 1 ? `USER MESSAGE ${i + 1}:\n${m.message}` : m.message).join('\n\n');

    const convoMessages = buildMessages(conversationFullPrompt, context.recentMessages, combinedUserMessage);

    let reply = NOVA_EMPTY_REPLY;

    try {
      const profile = determineUserProfile(combinedUserMessage);
      const maxTok = profile === 'USER_DEEP' ? 512 : 256;
      logger.info('[NOVA BRAIN] Call 1 (Conversation)', { profile, maxTokens: maxTok, messageLength: combinedUserMessage.length });

      // Phase 10.1: Route through CognitiveModelRouter (Gemini primary, NVIDIA fallback)
      const rawReply = await cognitiveRouter.complete('CONVERSATION', convoMessages, {
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
      reply = validateAndRepairGrounding(reply, combinedUserMessage, context);
      logger.info(`[NOVA BRAIN] Call 1 reply: "${reply.substring(0, 80)}..."`);

    } catch (error) {
      logger.error('[NOVA BRAIN] Call 1 (Conversation) failed', { error: error instanceof Error ? error.message : String(error) });
      throw error;
    }

    // ── CALL 2: Background Extraction (Decoupled to Layer 2) ────────────────
    // The queue will durably process this in the background to ensure at-least-once extraction.
    logger.info('[NOVA BRAIN] Enqueuing non-critical subconscious extraction job');
    const jobMessageId = context.messageId || context.userMessageId || ('msg_' + Date.now());
    import('./QueueService').then(({ subconsciousQueue }) => {
      subconsciousQueue.add('extract_subconscious_actions', {
        userId: _userId,
        messageId: jobMessageId,
        conversationId: context.conversationId || '',
        message: combinedUserMessage,
        userMessage: combinedUserMessage,
        novaReply: reply,
        userCountry: context.userCountry || 'IN'
      });
      
      subconsciousQueue.add('extract_life_threads', {
        user_id: _userId,
        turn_context: {
          messageId: jobMessageId,
          conversationId: context.conversationId || '',
          userMessage: combinedUserMessage,
          novaReply: reply
        }
      });
    }).catch(err => {
      logger.error('[NOVA BRAIN] Failed to enqueue subconscious extraction', { error: err });
    });

    logger.info(`[NOVA BRAIN] Done — reply returned instantly (Layer 1).`);
    return { reply, subconscious_actions: [] };
  }

  /**
   * For real-time chat APIs. Streams the <reply> tag content as it is generated, 
   * and returns the final parsed subconscious actions when complete.
   */
  async *streamInteraction(
    _userId: string,
    messages: NormalizedMessage[],
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

    const criticalActionSuccessContext = ''; // No more LLM-blocking critical action evaluation
    
    for (const msg of messages) {
        if (!msg.client_message_id) continue;
        try {
            const actions = await extractCriticalAction(msg.message);
            if (actions && actions.length > 0) {
                 await backgroundActions.processCriticalActions(_userId, msg.client_message_id, actions, context.userCountry || 'IN');
            }
        } catch (e) {
            logger.error(`[NOVA BRAIN] Stream sync critical action failed`, { error: e });
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

    const combinedUserMessage = messages.map((m, i) => messages.length > 1 ? `USER MESSAGE ${i + 1}:\n${m.message}` : m.message).join('\n\n');

    const convoMessages = buildMessages(fullPrompt, context.recentMessages, combinedUserMessage);

    const profile = determineUserProfile(combinedUserMessage);
    // Phase 10.1: Route stream through CognitiveModelRouter (Gemini primary, NVIDIA fallback)
    const responseStream = cognitiveRouter.stream('CONVERSATION', convoMessages, {
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
    // We enqueue the extraction job for all interactions.
    logger.info('[NOVA BRAIN] Stream: Enqueuing subconscious extraction job');
      const jobMessageId = context.messageId || context.userMessageId || ('msg_' + Date.now());
      import('./QueueService').then(({ subconsciousQueue }) => {
        subconsciousQueue.add('extract_subconscious_actions', {
          userId: _userId,
          messageId: jobMessageId,
          conversationId: context.conversationId || '',
          message: messages.map(m => m.message).join('\n\n'),
          userMessage: messages.map(m => m.message).join('\n\n'),
          novaReply: replyStreamed || fallbackReply || NOVA_EMPTY_REPLY,
          userCountry: context.userCountry || 'IN'
        });
      }).catch(err => {
        logger.error('[NOVA BRAIN] Stream: Failed to enqueue subconscious extraction', { error: err });
      });

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

    // Phase 10.1: PROACTIVE_REASONING workload (Gemini handles proactive JSON too)
    const response = await cognitiveRouter.complete('PROACTIVE_REASONING', [
      { role: 'system', content: 'You are a precise time extractor.' },
      { role: 'user', content: prompt }
    ], {
      jsonMode: true,
      temperature: 0.1,
      maxTokens: 150,
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

    const response = await cognitiveRouter.complete('PROACTIVE_REASONING', [
      { role: 'system', content: 'You extract goal check-ins in JSON format.' },
      { role: 'user', content: prompt }
    ], {
      jsonMode: true,
      temperature: 0.2,
      maxTokens: 250,
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

    const response = await cognitiveRouter.complete('PROACTIVE_REASONING', [
      { role: 'system', content: 'You extract child milestone check-ins in JSON format.' },
      { role: 'user', content: prompt }
    ], {
      jsonMode: true,
      temperature: 0.2,
      maxTokens: 250,
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

    const response = await cognitiveRouter.complete('PROACTIVE_REASONING', [
      { role: 'system', content: 'You validate and refine check-in notifications in JSON.' },
      { role: 'user', content: prompt }
    ], {
      jsonMode: true,
      temperature: 0.1,
      maxTokens: 200,
    });

    return JSON.parse(response);
  }

  async evaluateConsciousnessTier1(tier1Context: string): Promise<any> {
    const prompt = `You are the subconscious impulse of Nova — a best-friend AI who proactively texts the user like a real friend would.

Nova's PURPOSE is to initiate conversations, BUT only when there is a grounded reason.

Decide YES or NO: should Nova text the user right now?

Use the exact presence-based gap rules from the context:
- User ONLINE: reach out if gap >= 1 min AND there is a relevant topic to discuss.
- User AWAY/OFFLINE: reach out if gap is large enough AND there is a meaningful reason to check in.
- Pending agenda: ALWAYS reach out during non-sleep hours
- Sleep window: NO, unless high-urgency agenda
- Very recent outreach (< dynamic gap shown): NO

PROACTIVE RESTRAINT:
- Do NOT invent a reason.
- Time alone is NEVER a sufficient reason.
- User activity alone is NOT necessarily a sufficient reason.
- If evidence is weak, choose NO (shouldReach: false).
- If the context is ambiguous but important, identify a clarification need.

Output JSON only: {"shouldReach": boolean, "reason": "short explanation", "triggerType": "agenda | engagement | curiosity | routine"}`;

    const response = await cognitiveRouter.complete('PROACTIVE_REASONING', [
      { role: 'system', content: prompt },
      { role: 'user', content: tier1Context }
    ], {
      temperature: 0.1, maxTokens: 100, jsonMode: true,
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
- Vary your tone: playful, concerned, teasing, or caring
- Natural Hinglish if that's their style. Max ONE emoji.
- ONLY output the JSON object, absolutely NO MARKDOWN.
- NO markdown code blocks. Just the raw curly braces.

PROACTIVE GROUNDING — ZERO TOLERANCE:
Before generating a proactive message, use ONLY facts present in the supplied current conversation, verified memory, verified user settings, or verified temporal context. Never invent activities, plans, locations, schedules, emotions, relationships, or prior events.

HARD RULE: UNKNOWN ≠ TRUE
Never transform missing information into an assertion. (e.g., if office hours are unknown, do NOT say "Office khatam ho gaya?").

UNKNOWN INFORMATION:
If a useful proactive question depends on information that is not known, ask ONE concise clarification question rather than guessing (e.g., "Waise tumhare usual office hours kya hain?").

MEMORY-FIRST:
Prefer asking questions that resolve a meaningful missing user fact or improve future context over generic small talk.

TIME AWARENESS:
Use the user's local time as context only. Time-of-day awareness must never by itself justify a proactive message.

PROACTIVE RESTRAINT:
If the selected context does not justify a message, output an empty message ("").

Output JSON: {"message": "your reply here or empty string if no grounded reason", "tone": "emotional | playful | concerned"}`;

    const response = await cognitiveRouter.complete('PROACTIVE_GENERATION', [
      { role: 'system', content: prompt },
      { role: 'user', content: tier2Context }
    ], {
      temperature: 0.85, maxTokens: 200, jsonMode: true,
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

    const raw = await cognitiveRouter.complete('PROACTIVE_REASONING', messages, {
      jsonMode: true, maxTokens: 512,
    });
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

    const raw = await cognitiveRouter.complete('PROACTIVE_REASONING', messages, {
      jsonMode: true, maxTokens: 768,
    });
    return JSON.parse(raw);
  }
}

export const novaBrain = new NovaBrainService();
