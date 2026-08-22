import { chatCompletion, chatCompletionBackground } from '../lib/nvidia';
import { config } from '../config';
import { logger } from '../lib/logger';
import { promptBuilder } from './promptBuilder';

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
    // Strip "Subconscious Actions" leaks of all forms
    .replace(/\*\[Subconscious Actions[\s\S]*?\*\*/gi, ' ')
    .replace(/\s*Subconscious Action[s]?\s*$/gi, '')
    .replace(/\s*\((?:subconscious_actions|subconscious actions)\s*:?\s*\)\s*/gi, ' ')
    .replace(/\s*<subconscious_actions>\s*\(?\s*\)?\s*<\/subconscious_actions>\s*/gi, ' ')
    .replace(/\s*\((?:subconscious_actions|tool)\b[^)]*\)\s*/gi, ' ')
    .replace(/\s*\[\s*(?:subconscious_actions|subconscious actions)[^\]]*\]\s*/gi, ' ')
    .replace(/```(?:json|text)?\s*\[subconscious_actions\][\s\S]*?(?:```|$)/gi, ' ')
    .replace(/\[subconscious_actions\][\s\S]*?(?:\*\*|$)/gi, ' ')
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
 * Classifies whether a user message needs the deep model (49B) or the fast model (8B).
 *
 * STRATEGY: Default to 8B (fast, ~5-8s). Only escalate to 49B for:
 *   - Long/complex messages that need real reasoning
 *   - Reminders (need precise time parsing)
 *   - Emotional depth (need empathetic phrasing)
 *   - Explicit questions needing accurate answers
 *
 * Short greetings / casual chat / acknowledgments ALWAYS use 8B.
 */
function needsDeepModel(message: string): boolean {
  const lower = message.toLowerCase();
  const trimmed = message.trim();

  const EMOTIONAL_ALWAYS_DEEP = [
    'pareshan', 'thaka hua', 'thaki hui', 'dukhi', 'akela', 'akeli',
    'rone wala', 'rone wali', 'rona aa raha', 'sad hoon', 'stressed',
    'anxious', 'frustrated', 'help me', 'mujhe dar', 'scared', 'heartbreak',
    'lonely', 'upset', 'bura lag raha', 'bahut bura', 'bahut pareshan',
    'galat ho gaya', 'depressed', 'crying', 'ro raha', 'ro rahi'
  ];
  if (EMOTIONAL_ALWAYS_DEEP.some(t => lower.includes(t))) return true;

  // ── Fast-path short-circuit: NEVER use 49B for these ────────────────────────
  // Single-word greetings, acknowledgments, reactions → always 8B
  const FAST_ONLY = [
    'hi', 'hello', 'hey', 'hii', 'heyy', 'sup', 'yo', 'ok', 'okay',
    'haha', 'lol', 'hmm', 'hm', 'nice', 'cool', 'great', 'wow',
    'thanks', 'thx', 'ty', 'np', 'yes', 'no', 'yep', 'nope',
    'bye', 'gn', 'tc', 'cya', 'later',
    'ha', 'lmao', 'xd', '😂', '👍', '❤️',
  ];
  if (FAST_ONLY.includes(trimmed.toLowerCase())) return false;
  if (trimmed.length < 8) return false; // Very short message → always 8B

  // ── Deep triggers: these NEED 49B for quality ────────────────────────────────
  const DEEP_TRIGGERS = [
    // Reminders (need precise time parsing)
    'remind', 'yaad dila', 'timer', 'alarm', 'set kar',
    // Memory operations
    'remember', 'yaad rakho', 'bhool mat', 'save this',
    // Emotional depth
    'stressed', 'depressed', 'anxious', 'pareshan', 'tension', 'dukhi',
    'crying', 'breakup', 'fight', 'lonely', 'akela',
    // Explicit explanation requests
    'explain', 'samjhao', 'bata na', 'kyun hua', 'why did', 'how does',
    'compare', 'difference between', 'analysis', 'suggest karo', 'recommend',
    // Life events
    'interview', 'exam', 'result', 'meeting', 'doctor', 'hospital',
    // Planning
    'plan banao', 'goal', 'todo', 'task list',
    // Schedule / work context — user's actual life situation needs 49B for accuracy
    'schedule', 'weekoff', 'week off', 'working day', 'shift', 'office hours',
    // Universal career / professional context (any profession)
    'target', 'deadline', 'joining', 'onboard', 'appraisal', 'increment',
    'promotion', 'salary', 'raise', 'bonus', 'layoff', 'resign', 'quit job',
    'new job', 'job offer', 'offer letter', 'notice period',
    // Client / project / work output (developer, designer, freelancer, sales, any)
    'client', 'customer', 'project', 'task', 'sprint', 'milestone', 'launch',
    'release', 'demo', 'pitch', 'presentation', 'proposal', 'contract',
    // Academic (student, teacher, researcher)
    'exam', 'test', 'assignment', 'submission', 'result', 'marks', 'grade',
    // Business (entrepreneur, startup, shop owner)
    'revenue', 'profit', 'loss', 'investor', 'funding', 'startup',
  ];

  // Long messages (>150 chars) likely need deeper reasoning
  if (trimmed.length > 150) return true;

  // Check for trigger keywords
  return DEEP_TRIGGERS.some(t => lower.includes(t));
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
    
    // Build the system prompt using the existing robust promptBuilder
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
CRITICAL: STRICTLY 1-2 sentences MAX. OUTCOME ONLY. NO bullet points. NO care packages. NO summaries. Keep it casual like a WhatsApp text.
</reply>

Available Tools for Subconscious Actions:
1. "MomentEngine" -> "extract": Extract a core life event or emotional moment from the text.
   - data: { "moment": "brief description", "emotion": "happy/sad/etc", "importance": 1-10 }
2. "ReminderEngine" -> "schedule": Set a reminder.
   - data (use simple time_phrase OR structured recurrence):
     * ONE-TIME: { "title": "what to remind", "time_phrase": "in 10 minutes" | "at 7pm tomorrow", "purpose": "why it matters" }
     * RECURRING (CRITICAL - DO NOT USE time_phrase): { "title": "...", "time_of_day": "08:30" (or 24hr time), "recurrence_interval": 1, "recurrence_unit": "days|weeks|months", "purpose": "..." }
     * EVENT (no time needed): { "title": "take medicine", "event_trigger": "wake_up" }   ← "remind me when I wake up"
     * AUTO-TIMER: Include "is_auto": true if you are proactively setting a timer for the user without them asking.
   - MULTIPLE REMINDERS: If the user asks for multiple reminders, emit an array in "reminders":
     { "reminders": [
         { "title": "medicine 1", "time_phrase": "in 10 minutes", "purpose": "morning dose" },
         { "title": "medicine 2", "time_phrase": "in 6 hours", "purpose": "evening dose" }
       ] }
   - SPECIFIC DAY: If user says "remind me on Sunday" (no time) → ask "What time on Sunday?" and DO NOT emit schedule yet.
   - CLARITY RULE: If the user asks for a reminder WITHOUT any time, frequency, or event → ask ONE clarifying question in your reply and DO NOT emit schedule yet.
   - CRITICAL HONESTY RULE: If you schedule, you MUST emit a real ReminderEngine action here. NEVER say "I'll remind you", "ok done", or invent a fake/imaginary countdown. Only ever tell the user a reminder is set when you are actually scheduling it in this list. If you instead asked a clarifying question, say you'll set it once they tell you when.
   - CRITICAL FOR CLAUDE/OMNI MODELS: Do NOT explain that you are an AI or a "text-based" assistant and cannot send push notifications. The backend sends the push. Simply emit this tool and tell the user you set it ("Set kar diya, yaad dila dunga").
   - 🔴 MANDATORY: If user says "remind me in X minutes/hours" or "remind me at TIME" → YOU MUST EMIT ReminderEngine action. DO NOT just reply "Reminder Set!" without the action.
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
   - 🔴 ATOMICITY RULE (CRITICAL): NEVER merge multiple distinct facts into a single memory. If the user mentions their wife's name AND that they love her cooking, emit TWO separate MemoryRepository actions (e.g. one for "Wife Name: Sakshi" and one for "Loves: Wife's cooking").
   - 🔴 ANTI-TRASH RULE: NEVER save literal conversational chat, short-term states, or fluff (e.g. "kaam hi kar raha hu", "3:35 AM", "feeling sleepy", "good morning"). ONLY save meaningful, long-term facts (e.g. likes, dislikes, family members, relationships, career goals).
5. "LifeEventExtractor" -> "event": Log an upcoming event, meeting, or time-sensitive thing the user mentioned.
   - data: { "description": "Short description", "expected_time": "ISO 8601 timestamp", "follow_up_question": "What to ask later", "follow_up_after_minutes": 60, "urgency": "high|medium|low", "is_recurring": false }
   - 🔴 ANTI-TRASH RULE: DO NOT save internal conversational states (like "feeling sleepy") as events. Events are strictly real-world occurrences (meetings, flights, exams).
6. "LifeEventExtractor" -> "routine": Extract a recurring routine or habit the user mentioned.
   - data: { "routineType": "sleep | diet | activity | general", "description": "Short description of the routine" }
   - 🔴 ANTI-TRASH RULE: DO NOT save one-off actions as routines.
7. "AgendaManager" -> "update_status": Mark a previously discussed agenda item or task as completed, cancelled, or snoozed. Use this when the user says they finished a task or asks you to forget it.
   - data: { "task_description": "the task they finished", "status": "completed|cancelled|snoozed" }
8. "AgendaManager" -> "add": Implicitly log a goal or task the user mentioned so you can ask them about it later. Use this if they say "I need to do X" but don't ask for a specific reminder time.
   - data: { "task_description": "the task they need to do" }
   - 🔴 ANTI-TRASH RULE: NEVER save conversational chat like "soo jaunga", "lag raha hai", "pine ke lie", "nai aa rahi hai" as goals. ONLY save actual, actionable tasks (e.g. "Buy groceries", "Finish project"). If it is not an actionable task, do not use this tool.
9. "ExternalApiEngine" -> "webhook": Trigger a real-world webhook or external action IF the user asks you to control something (like lights, notion, etc).
   - data: { "url": "the webhook url", "method": "POST|GET", "body": { "any": "data" } }
9. "ReminderEngine" -> "delete": Cancel an active reminder when the user says "stop", "cancel", "hata de", "band kar do", etc.
   - data: { "id": "the EXACT id string from the ACTIVE REMINDERS (SOURCE OF TRUTH) block, e.g. <uuid>" }
   - Only delete a reminder actually listed there. If unclear which one, ask.
10. "EventDetector" -> "fire": When the user signals a life event that has an ACTIVE event-triggered reminder (listed in your ACTIVE REMINDERS block as: on event "..."), fire it now. E.g. user says "I'm awake" → fire reminders with event_trigger "wake_up"; "office se nikal gaya" → "left_the_office".
    - data: { "event": "the event string exactly as listed (e.g. wake_up, left_the_office)" }
11. "WorkingMemory" -> "set": Use when user mentions they're doing something time-bound (bathing, eating, gym, meeting, sleeping). Calculate estimated free time:
    - data: { "key": "user_busy_until", "value": "<ISO 8601 timestamp>" }
    - Estimates: bathing=20m, eating=30m, gym=60m, meeting=45m, sleep=8hrs, office=until 7pm.
    - Example: if user says "bathing", set value to NOW + 20 mins.

If no tools need to be called, leave the JSON array empty: []
`;

    const messages = buildMessages(fullPrompt, context.recentMessages, message);

    try {
      const useDeep = needsDeepModel(message);
      const modelToUse = useDeep ? config.nvidia.deepModel : config.nvidia.chatModel;
      // 8B: cap at 512 tokens (fast casual reply budget), 49B: 1024 (needs space for reasoning)
      const maxTok = useDeep ? 1024 : 512;
      logger.info(`[NOVA BRAIN] Model: ${useDeep ? 'DEEP/49B' : 'FAST/8B'} | tokens: ${maxTok} | msgLen: ${message.length}`);

      const rawRes = await chatCompletion(messages, {
        temperature: useDeep ? 0.80 : 0.90, // 8B slightly more creative/casual, 49B more precise
        maxTokens: maxTok,
        model: modelToUse,
      });

      let reply = "Hmm, I lost my train of thought.";
      let subconscious_actions: any[] = [];

      const replyMatch = rawRes.match(/<reply>([\s\S]*?)(?:<\/reply>|$)/);
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
          let jsonStr = subMatch[1].trim();
          if (jsonStr.startsWith('```json')) {
            jsonStr = jsonStr.replace(/^```json/, '').replace(/```$/, '').trim();
          } else if (jsonStr.startsWith('```')) {
            jsonStr = jsonStr.replace(/^```/, '').replace(/```$/, '').trim();
          }
          const parsed = JSON.parse(jsonStr);
          subconscious_actions = Array.isArray(parsed) ? parsed : [parsed];
        } catch (e) {
          logger.warn('[NOVA BRAIN] Failed to parse subconscious actions JSON', { error: e });
        }
      }

      // Fallback: If no subconscious_actions XML tag was parsed, search rawRes for any code block or inline JSON tool call
      if (subconscious_actions.length === 0) {
        const fallbackMatch = rawRes.match(/(?:```(?:json)?\s*)?(\[\s*\{\s*"tool"[\s\S]*?\}\s*\]|\{\s*"tool"[\s\S]*?\}\s*\})(?:```)?/i);
        if (fallbackMatch) {
          try {
            const parsed = JSON.parse(fallbackMatch[1].trim());
            const arr = Array.isArray(parsed) ? parsed : [parsed];
            if (arr.length > 0 && arr[0].tool) {
              subconscious_actions = arr;
              logger.info(`[NOVA BRAIN] Fallback-extracted ${subconscious_actions.length} tool actions from raw response block.`);
            }
          } catch (e) {
            // Ignore fallback parse error
          }
        }
      }

      // Sanitize formatting/leak leftovers (bold, menus, "(subconscious_actions: )" labels)
      // so a model that ignored the anti-robot prompt rules still renders as a friend.
      reply = sanitizeReply(reply);

      // POST-PROCESS: If using fast model and the reply mentions actions but none were extracted,
      // do a targeted extraction call with the 8B model to recover the tool actions the
      // small model skipped (it often ignores the XML instruction block).
      if (subconscious_actions.length === 0 && reply) {
        const lowerReply = reply.toLowerCase();
        const lowerMsg = message.toLowerCase();
        const shouldHaveActions =
          (lowerMsg.includes('remind') || lowerMsg.includes('yaad') || lowerMsg.includes('timer')) ||
          (lowerReply.includes('remind') || lowerReply.includes('yaad dila') || lowerReply.includes('set kar'));

        if (shouldHaveActions) {
          try {
            const extractionPrompt = `Based on this conversation, extract any actions that should be taken.

User said: "${message}"
Nova replied: "${reply}"

If a reminder was discussed, output EXACTLY this JSON (fill in the values):
[{"tool": "ReminderEngine", "action": "schedule", "data": {"title": "WHAT", "time_phrase": "WHEN", "purpose": "WHY"}}]

If a memory should be saved, output:
[{"tool": "MemoryRepository", "action": "save", "data": {"key": "CATEGORY", "value": "DETAIL"}}]

If no actions needed, output: []

Output ONLY the JSON array, nothing else.`;

            const extractionResult = await chatCompletionBackground([
              { role: 'system', content: 'You extract structured actions from conversations. Output only JSON.' },
              { role: 'user', content: extractionPrompt }
            ], {
              model: 'meta/llama-3.1-8b-instruct',
              maxTokens: 256,
              temperature: 0.1
            });

            const cleaned = extractionResult.trim().replace(/^```json?\s*/, '').replace(/```$/, '').trim();
            if (cleaned.startsWith('[')) {
              const parsed = JSON.parse(cleaned);
              if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].tool) {
                subconscious_actions = parsed;
                logger.info(`[NOVA BRAIN] Post-extraction recovered ${subconscious_actions.length} actions from fast model reply.`);
              }
            }
          } catch (e) {
            logger.warn('[NOVA BRAIN] Post-extraction failed (non-critical)', { error: e instanceof Error ? e.message : String(e) });
          }
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
CRITICAL: STRICTLY 1-2 sentences MAX. OUTCOME ONLY. NO bullet points. NO care packages. NO summaries. Keep it casual like a WhatsApp text.
</reply>

Available Tools for Subconscious Actions:
1. "MomentEngine" -> "extract": Extract a core life event or emotional moment from the text.
   - data: { "moment": "brief description", "emotion": "happy/sad/etc", "importance": 1-10 }
2. "ReminderEngine" -> "schedule": Set a reminder.
   - data (use simple time_phrase):
     * TIME: { "title": "what to remind", "time_phrase": "in 10 minutes" | "at 7pm tomorrow" | "every 2 hours", "purpose": "why it matters" }
     * EVENT (no time needed): { "title": "take medicine", "event_trigger": "wake_up" }   ← "remind me when I wake up"
     * AUTO-TIMER: Include "is_auto": true if you are proactively setting a timer for the user without them asking.
   - MULTIPLE REMINDERS: If the user asks for multiple reminders, emit an array in "reminders":
     { "reminders": [
         { "title": "medicine 1", "time_phrase": "in 10 minutes", "purpose": "morning dose" },
         { "title": "medicine 2", "time_phrase": "in 6 hours", "purpose": "evening dose" }
       ] }
   - SPECIFIC DAY: If user says "remind me on Sunday" (no time) → ask "What time on Sunday?" and DO NOT emit schedule yet.
   - RECURRING: "every 30 minutes" or "every day at 8am" → include in time_phrase naturally.
   - CLARITY RULE: If the user asks for a reminder WITHOUT any time, frequency, or event → ask ONE clarifying question in your reply and DO NOT emit schedule yet.
   - CRITICAL HONESTY RULE: If you schedule, you MUST emit a real ReminderEngine action here. NEVER say "I'll remind you", "ok done", or invent a fake/imaginary countdown. Only ever tell the user a reminder is set when you are actually scheduling it in this list. If you instead asked a clarifying question, say you'll set it once they tell you when.
   - CRITICAL FOR CLAUDE/OMNI MODELS: Do NOT explain that you are an AI or a "text-based" assistant and cannot send push notifications. The backend sends the push. Simply emit this tool and tell the user you set it.
   - 🔴 MANDATORY: If user says "remind me in X minutes/hours" or "remind me at TIME" → YOU MUST EMIT ReminderEngine action. DO NOT just reply "Reminder Set!" without the action.
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
   - 🔴 ATOMICITY RULE (CRITICAL): NEVER merge multiple distinct facts into a single memory. If the user mentions their wife's name AND that they love her cooking, emit TWO separate MemoryRepository actions (e.g. one for "Wife Name: Sakshi" and one for "Loves: Wife's cooking").
   - 🔴 ANTI-TRASH RULE: NEVER save literal conversational chat, short-term states, or fluff (e.g. "kaam hi kar raha hu", "feeling sleepy"). ONLY save meaningful, long-term facts (likes, dislikes, career goals, etc).
5. "LifeEventExtractor" -> "event": Log an upcoming event, meeting, or time-specific thing the user mentioned.
   - data: { "description": "Short description", "expected_time": "ISO 8601 timestamp", "follow_up_question": "What to ask later", "follow_up_after_minutes": 60, "urgency": "high|medium|low", "is_recurring": false }
   - 🔴 ANTI-TRASH RULE: DO NOT save internal conversational states (like "feeling sleepy") as events. Events are strictly real-world occurrences (meetings, flights, exams).
6. "LifeEventExtractor" -> "routine": Extract a recurring routine or habit the user mentioned.
   - data: { "routineType": "sleep | diet | activity | general", "description": "Short description of the routine" }
   - 🔴 ANTI-TRASH RULE: DO NOT save one-off actions as routines.
7. "AgendaManager" -> "update_status": Mark a previously discussed agenda item or task as completed, cancelled, or snoozed. Use this when the user says they finished a task or asks you to forget it.
   - data: { "task_description": "the task they finished", "status": "completed|cancelled|snoozed" }
8. "AgendaManager" -> "add": Implicitly log a goal or task the user mentioned so you can ask them about it later. Use this if they say "I need to do X" but don't ask for a specific reminder time.
   - data: { "task_description": "the task they need to do" }
   - 🔴 ANTI-TRASH RULE: NEVER save conversational chat like "soo jaunga", "lag raha hai", "pine ke lie" as goals. ONLY save actual, actionable tasks (e.g. "Buy groceries", "Finish project"). If it is not an actionable task, do not use this tool.

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

    if (subconscious_actions.length === 0) {
      const fallbackMatch = fullText.match(/(?:```(?:json)?\s*)?(\[\s*\{\s*"tool"[\s\S]*?\}\s*\]|\{\s*"tool"[\s\S]*?\}\s*\})(?:```)?/i);
      if (fallbackMatch) {
        try {
          const parsed = JSON.parse(fallbackMatch[1].trim());
          const arr = Array.isArray(parsed) ? parsed : [parsed];
          if (arr.length > 0 && arr[0].tool) {
            subconscious_actions = arr;
            logger.info(`[NOVA BRAIN] Stream fallback-extracted ${subconscious_actions.length} tool actions from full text.`);
          }
        } catch (e) {
          // Ignore fallback parse error
        }
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
