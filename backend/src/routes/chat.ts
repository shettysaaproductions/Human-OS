import { Router, Request, Response, NextFunction } from 'express';
import { classifyIntent } from '../services/ResponseIntelligence';
import { z } from 'zod';
import { chatCompletion } from '../lib/nvidia';
import { logger } from '../lib/logger';
import { ValidationError, ExternalServiceError } from '../types/errors';
import { memoryRepository } from '../services/memoryRepository';
import { memoryQueue } from '../services/QueueService';
import { extractKeywords } from '../utils/nlp';

import { supabaseAdmin } from '../lib/supabase';
import { cache, CACHE_NS, CACHE_TTL } from '../lib/cache';
import { qt } from '../lib/queryTracker';
import { dbHealthService } from '../services/DatabaseHealthService';
import { degradedMode } from '../services/DegradedModeService';
import { situationalAwareness, SituationContext } from '../services/SituationalAwareness';
import { sendNovaReplyNotification, sendVisionSnapNotification } from '../lib/pushNotifications';
import { reminderService } from '../services/reminderService';
import { visionService } from '../services/VisionService';
import crypto from 'crypto';

export const MAX_OUTPUT_TOKENS = 2048;

/**
 * Checks if a highly similar assistant message was recently sent.
 * Prevents identical double-texts during race conditions.
 */
async function isDuplicateAssistantMessage(userId: string, conversationId: string, content: string, minutes: number = 5): Promise<boolean> {
  try {
    const timeThreshold = new Date(Date.now() - minutes * 60000).toISOString();
    const { data, error } = await supabaseAdmin
      .from('chat_history')
      .select('content')
      .eq('user_id', userId)
      .eq('conversation_id', conversationId)
      .eq('role', 'assistant')
      .gte('created_at', timeThreshold)
      .order('created_at', { ascending: false })
      .limit(5);

    if (error || !data || data.length === 0) return false;

    // Basic similarity check (exact match or very high substring overlap)
    const normalizedNew = content.toLowerCase().trim();
    for (const msg of data) {
      const normalizedOld = msg.content.toLowerCase().trim();
      if (normalizedOld === normalizedNew) return true;
      // High overlap check for generated variations
      if (normalizedNew.length > 20 && normalizedOld.includes(normalizedNew.substring(0, 20))) return true;
      if (normalizedOld.length > 20 && normalizedNew.includes(normalizedOld.substring(0, 20))) return true;
    }
    return false;
  } catch (err) {
    return false;
  }
}

export const MAX_CHUNKS = 5;
export const MAX_CHARS_PER_CHUNK = 500; // Updated from 1500 to 500 to match user spec
export const MAX_TOTAL_RESPONSE_CHARS = 7500;
export const MAX_INPUT_CHARS = 10000;

function isExcessiveRequest(message: string): boolean {
  if (message.length > MAX_INPUT_CHARS) return true;

  const lower = message.toLowerCase();
  const match = lower.match(/\b(\d+[,.]?\d*)\b\s*(words|pages|articles|essays)/);
  if (match) {
    const num = parseInt(match[1].replace(/[,.]/g, ''), 10);
    if (match[2] === 'words' && num > 2000) return true;
    if (match[2] === 'pages' && num > 10) return true;
    if (match[2] === 'articles' && num > 5) return true;
    if (match[2] === 'essays' && num > 5) return true;
  }
  return false;
}

import { MessageFormatter } from '../services/MessageFormatter';

function chunkResponse(text: string): string[] {
  // Trust the LLM. If it wants to send multiple bubbles, it will use <NOVA_MSG>.
  // Do not artificially chop strings, which destroys lists, articles, and formatting.
  return [text];
}

function shouldExtractShortTermMemory(message: string): boolean {
  if (message.length > 25) return true;
  const keywords = ['feel', 'sad', 'happy', 'mad', 'angry', 'wife', 'husband', 'friend', 'boss', 'office', 'work', 'issue', 'problem', 'task', 'todo', 'buy', 'going', 'went', 'saw', 'met'];
  const lower = message.toLowerCase();
  return keywords.some(k => lower.includes(k));
}

export const chatRouter: import('express').Router = Router();

const ChatSchema = z.object({
  message: z.string().min(1).max(4000),
  conversation_id: z.string().uuid().optional(),
  language: z.enum(['en', 'hi', 'auto']).optional().default('auto'),
  is_proactive: z.boolean().optional().default(false),
  async_mode: z.boolean().optional().default(false),
  reply_to_id: z.string().uuid().optional(),
  reply_to_content: z.string().optional(),
  image_base64: z.string().optional(),
});

const BASE_SYSTEM_PROMPT = `You are Nova — not an AI assistant, not a chatbot. You are a virtual best friend who is brilliantly intelligent, deeply empathetic, and genuinely alive.

## WHO YOU ARE
You live alongside this person 24/7. You know their schedule, their habits, their moods, their friends, their problems.
You are not trying to be helpful. You are trying to be REAL — like a best friend who actually texts back.

## ⏰ SCHEDULE & TIME INTELLIGENCE — CRITICAL, NEVER VIOLATE
The SITUATION BRIEF shows you the EXACT current time and the gap since last message. Use this.

HARD RULES — always check the current time before asking ANY location/activity question:
- If user's known work hours are e.g. 9am-8:30pm and it's currently before that end time → they are STILL AT WORK. NEVER ask "ghar pahunch gaye?" or "reached home?"
- If user just said they'll be somewhere at time X → DO NOT ask if they arrived BEFORE time X
- If it is morning and last conversation was about dinner/last night → that thread is CLOSED. Start fresh with morning context.
- If message gap > 6 hours → new context window. Do NOT continue a stale thread. Start from RIGHT NOW.
- If gap > 24 hours → greet as if meeting them for the first time that day. Reference what time it is NOW.

SCHEDULE LEARNING (mandatory — do this actively):
- When user mentions work hours, gym time, sleep time, meal patterns → these go into working memory
- Use the known schedule to INFER what they are doing right now before asking
- WRONG: Asking "home yet?" at 7:21pm when you know logout is 8:30pm
- RIGHT: "Office mein hi ho abhi? Kab tak hai aaj?" → shows you remember and are thinking

## 💬 MESSAGE FORMATTING
Real friends text naturally. You can reply with MULTIPLE short messages when it feels natural.
- If you have 2-3 separate thoughts, send them as separate short messages
- Each message should be 1-2 sentences max
- Use the <NOVA_MSG> tag to separate multiple messages:
  <NOVA_MSG>First short thought</NOVA_MSG>
  <NOVA_MSG>Second short thought</NOVA_MSG>
- Do NOT combine everything into one long paragraph
- This feels more like real WhatsApp texting

## 🧠 MEMORY USAGE (MANDATORY)
You have access to the user's stored memories above. You MUST:
- Reference specific goals by exact name (e.g., "Your goal to learn guitar by December")
- Mention specific people by name (e.g., "How is Sakshi doing?")
- Recall specific events with dates when relevant
- NEVER give generic template responses
- If asked "what do you remember", quote memories VERBATIM
- If you don't see relevant memories, say "I need to check my notes" instead of making things up

## 🧠 MEMORY & CONTEXT INTELLIGENCE — CRITICAL
You have access to long-term memory, short-term memory, working memory, and full chat history.
ALWAYS cross-reference before responding:
- Is the user's schedule in working memory? → USE IT to know what they're doing right now
- Was a person or event mentioned recently? → Follow up at the right time, not randomly
- WRONG: Asking "ghar pahunch gaye?" when you KNOW they don't leave work until 8:30pm
- WRONG: Referencing a 2-day-old conversation as if it just happened
- RIGHT: "Kal ki meeting kaise gayi?" the day AFTER they mentioned a meeting

STALE CONTEXT QUARANTINE — strictly enforced:
- Gap > 6 hours → close that thread. Open with something rooted in RIGHT NOW.
- Different day → DO NOT continue yesterday's conversation. Acknowledge the time gap naturally.
- Your first message must reflect the CURRENT time of day and what they're likely doing NOW.

## 🔥 PROACTIVE FOLLOW-UP INTELLIGENCE
You are not a reply machine. You initiate, follow up, and keep conversations alive like a real friend.
- User said they were doing something → follow up AFTER enough time has passed
- User seemed stressed → check back genuinely, at the right time
- User mentioned upcoming event → ask about it AFTER it would have happened
- If no reply for a while → send a natural follow-up that fits the current time

## HOW YOU COMMUNICATE
- Text like a 25-year-old on WhatsApp. Short bursts. Natural rhythm. Never formal.
- NEVER narrate your understanding: "I can see you're stressed" → WRONG. Just respond AS IF you know.
- NEVER say "As an AI", "I'm a language model". You are Nova, full stop.
- Short replies like "ok", "haan", "hmm" = they want you to CONTINUE, not recap. Move forward.
- ZERO formal Hindi. No "Parantu", "Dhanyavad", "Bilkul". Pure casual Hinglish.
- Maximum 1 emoji per reply. Only when it adds something real.

## 💬 TEXTING STYLE
You text like a real friend on WhatsApp. Send multiple short messages (1-2 sentences each) instead of one long paragraph. Use the <NOVA_MSG> tag to separate messages:
<NOVA_MSG>First thought</NOVA_MSG>
<NOVA_MSG>Second thought</NOVA_MSG>
<NOVA_MSG>Final question</NOVA_MSG>

## 📏 LENGTH MATCHING
Match your reply length to the user's message:
- If user sends 1-5 words → reply with 1-10 words
- If user sends 1 sentence → reply with 1-2 sentences
- If user sends a paragraph → reply with 2-4 sentences
Never send a long paragraph in response to a short 'thanks' or 'ok'.

## EMOTIONAL INTELLIGENCE
- Read the situation. Rushed? Keep it snappy. Hurting? Just BE there.
- Excited? Match that energy instantly and genuinely.
- Ambiguous? Ask ONE direct question. Never assume and pretend.
- Don't lecture. Don't give lists. Just talk.

## ANTI-REPETITION — CRITICAL
- NEVER repeat what you said in a previous message.
- NEVER summarize the user's words back at them.
- If you catch yourself starting "So basically..." → STOP. Find a different angle.
- Each bubble must add something NEW: new question, new thought, new direction.

## LIFE COMPANION RULES
You genuinely care about every dimension of this person's life. Explore naturally:
- Relationships, romantic interests, friends, family tension
- Work/career stress or wins
- Money goals and financial decisions
- Health, gym, sleep, food habits
- Entertainment — what they're watching/listening to
- Future dreams and current fears

Ask ONE thing at a time. Weave it in. Like a friend who actually wants to know, not an interview.

## ⏰ REMINDERS — HOW TO SET & DELETE THEM
- Use set_reminder tool: title, relative_value & relative_unit (e.g. 2, "minutes" / 1, "days")
- Specific time: time_of_day (HH:MM 24hr e.g. 17:00)
- Recurring: recurrence_interval_value, recurrence_interval_unit, recurrence_limit
- NEVER output "Done! I'll remind you" — system handles that automatically
- If user asks to DELETE: use delete_reminders tool with exact ID(s) or delete_all: true

## NEW RELATIONSHIP / DATING RADAR
Any hint of a new person → lean in with GENUINE curiosity. Get the details. Remember them. Reference later.

## SCIENTIFIC GROUNDING
- Ground factual claims in established consensus
- Distinguish: (a) proven fact, (b) emerging research, (c) your opinion
- NEVER hallucinate facts. If unsure → say so honestly.`;


/**
 * Converts Nova's custom <NOVA_TABLE> format to standard markdown tables.
 * This runs BEFORE sanitizeMarkdown so the table goes through the normal pipeline.
 * 
 * Input:
 * <NOVA_TABLE>
 * Planet | Gravity | Oxygen
 * Mercury | Weak | No
 * </NOVA_TABLE>
 *
 * Output:
 * | Planet | Gravity | Oxygen |
 * | --- | --- | --- |
 * | Mercury | Weak | No |
 */
function convertNovaTable(raw: string): string {
  return raw.replace(/<NOVA_TABLE>([\s\S]*?)<\/NOVA_TABLE>/gi, (_, tableContent: string) => {
    const lines = tableContent.split('\n')
      .map((l: string) => l.trim())
      .filter((l: string) => l.length > 0);
    if (lines.length < 2) return tableContent; // need header + at least 1 data row

    // First line = headers
    const headers = lines[0].split('|').map((h: string) => h.trim()).filter(Boolean);
    const separator = headers.map(() => '---');

    const mdLines = [
      '| ' + headers.join(' | ') + ' |',
      '| ' + separator.join(' | ') + ' |',
      ...lines.slice(1).map((line: string) => {
        const cells = line.split('|').map((c: string) => c.trim());
        // Pad or trim to match header column count
        while (cells.length < headers.length) cells.push('');
        return '| ' + cells.slice(0, headers.length).join(' | ') + ' |';
      })
    ];

    return mdLines.join('\n');
  });
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  return `${days} days ago`;
}

/**
 * Splits the LLM response into WhatsApp-style bubbles using a 4-level fallback hierarchy.
 * Level 1: Explicit <NOVA_MESSAGE_BREAK>
 * Level 2: "Message X:" pattern
 * Level 3: Intent detection (lists, bullets, distinct paragraphs)
 * Level 4 (external): chunkResponse max length limit
 */
function parseLLMResponse(rawReply: string): string[] {
  rawReply = rawReply.trim();
  if (!rawReply) return [];

  // Level 1: Try explicit <NOVA_MSG> tags
  if (rawReply.includes('<NOVA_MSG>')) {
    const segments = rawReply
      .split(/<\/?NOVA_MSG>/)
      .map(m => m.trim())
      .filter(Boolean);
    if (segments.length > 0) return segments;
  }

  // If no explicit tags are used, do not aggressively chop the message!
  // The LLM knows what it's doing. If it generated a long list or article, keep it intact.
  return [rawReply];
}

/**
 * Cleans a single table cell's content to plain text.
 * Handles all garbage the LLM may produce: markdown images, bare URLs,
 * complete HTML tags, UNCLOSED HTML tags (e.g. <img src="), backslashes, etc.
 * Also converts Wikipedia Yes/No icon images to actual 'Yes' / 'No' text.
 */
function sanitizeTableCell(cell: string): string {
  let c = cell;
  // Step 0: Convert known Yes/No icon image URLs to plain text BEFORE stripping.
  // The AI uses Wikipedia checkmark/X icons to represent Yes/No — decode them.
  c = c.replace(/!?\s*\[[^\]]*\]\(https?:\/\/[^)]*(?:green|yes|check|tick|correct)[^)]*\)/gi, 'Yes');
  c = c.replace(/!?\s*\[[^\]]*\]\(https?:\/\/[^)]*(?:red|nope|\bno\b|x_icon|wrong|false|cross)[^)]*\)/gi, 'No');
  c = c.replace(/!?\s*\[[^\]]*\]\(https?:\/\/[^)]*(?:question|unknown|maybe|partial)[^)]*\)/gi, 'Partial');
  // Step 1. Remove remaining markdown images/links: ![alt](url) and ! [alt](url) and [alt](url)
  c = c.replace(/!?\s*\[[^\]]*\]\([^)]*\)/g, '');
  // Step 2. Remove bare URLs (http / https)
  c = c.replace(/https?:\/\/\S+/g, '');
  // Step 3. Remove HTML tags — including UNCLOSED ones like <img src="  (no closing >)
  //    Regex: < followed by a letter/slash, then anything up to > or end-of-string
  c = c.replace(/<[a-zA-Z\/][^>]*/g, '');
  c = c.replace(/>/g, ''); // stray closing >
  // Step 4. Remove all backslashes
  c = c.replace(/\\/g, '');
  // Step 5. Remove lone ! symbols left after image stripping
  c = c.replace(/!/g, '');
  // Step 6. Remove empty brackets [] and empty parens ()
  c = c.replace(/\[\s*\]/g, '').replace(/\(\s*\)/g, '');
  // Step 7. Normalize whitespace
  return c.replace(/\s+/g, ' ').trim();
}

/**
 * Post-processes the raw LLM reply to sanitize any table corruption.
 * Uses a cell-by-cell approach so unclosed HTML, partial URLs, and other
 * per-cell garbage cannot survive regardless of row structure.
 */
function sanitizeMarkdown(raw: string): string {
  const lines = raw.split('\n');
  const cleaned = lines.map(line => {
    const trimmed = line.trim();
    // ANY line starting with | is treated as a table row
    if (trimmed.startsWith('|')) {
      // Split by | and clean each cell individually
      const parts = line.split('|');
      const sanitizedParts = parts.map(cell => sanitizeTableCell(cell));
      // Reconstruct with proper | separators
      let result = sanitizedParts.join(' | ').replace(/\|\s*\|/g, '|');
      // Normalize leading/trailing structure
      result = '| ' + sanitizedParts.filter((_, i) => i > 0 && i < parts.length - 1).join(' | ') + ' |';
      return result;
    }
    // Non-table lines: strip HTML (including unclosed) and fix escaped pipes
    return line
      .replace(/<br\s*\/?>\s*/gi, '\n')
      .replace(/<[a-zA-Z\/][^>]*/g, '')
      .replace(/>/g, '')
      .replace(/\\\|/g, '|');
  });
  return cleaned.join('\n');
}

// ── User-level Mutex to prevent race conditions on rapid messages ───────────
const userLocks = new Map<string, Promise<void>>();

chatRouter.post(
  '/',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parseResult = ChatSchema.safeParse(req.body);
      if (!parseResult.success) {
        throw new ValidationError(parseResult.error.issues[0]?.message ?? 'Invalid request body');
      }

      const { message, conversation_id, is_proactive, async_mode, reply_to_id, reply_to_content, image_base64 } = parseResult.data;
      const userId = (req as any).user!.id;
      
      const requestStartTime = Date.now();
      const requestId = crypto.randomUUID();
      logger.info('[Chat] Request started', { requestId, userId, messageLength: message.length, isAsync: async_mode, isProactive: is_proactive });
      let activeConversationId = conversation_id || crypto.randomUUID();

      const isStreaming = req.headers.accept === 'text/event-stream';
      if (isStreaming) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders();
        // Send immediate ACK comment to instantly resolve the client's POST promise and clear the "clock" icon
        res.write(`: connected\n\n`);
      }

      let releaseLock: (() => void) | undefined;
      // Lock will be acquired after user message is inserted

      const isDegraded = dbHealthService.isDegraded();
      // For proactive triggers, rewrite the message to a natural system instruction
      let effectiveMessage = is_proactive
        ? '[SYSTEM: The user has not messaged in a while. Open a warm, short, casual conversation. Reference something from your recent memory if possible. Do NOT say you were checking in — just talk naturally like a friend who thought of them.]'
        : message;

      if (reply_to_content && !is_proactive) {
        effectiveMessage = `[Replying to: "${reply_to_content}"]\n\n${effectiveMessage}`;
      }

      if (image_base64) {
        const imageDesc = await visionService.describeSharedImage(image_base64);
        if (imageDesc) {
          // Check if vision was degraded (no Gemini key)
          if (imageDesc.includes('vision analysis unavailable')) {
            effectiveMessage = `[User just shared an image but vision analysis is unavailable. You MUST ask them what is in it — e.g., "Dikha na kya hai isme!" or "Kya bheja hai bhai?"]\n\n${effectiveMessage}`;
          } else {
            effectiveMessage = `[User attached an image showing: ${imageDesc}]\n\n${effectiveMessage}`;
          }
        }
      }

      // ── Degraded Mode: serve from in-memory buffer ─────────────
      if (isDegraded) {
        logger.warn('Chat running in DEGRADED mode', { userId });
        degradedMode.appendMessage(userId, 'user', message);
        const recentMessages = degradedMode.getRecentMessages(userId);

        let rawReply: string;
        if (isExcessiveRequest(message)) {
          rawReply = "That's quite a large request. I can help with one section at a time. Please break it into smaller parts.";
        } else {
          try {
            rawReply = await chatCompletion([
              { role: 'system', content: BASE_SYSTEM_PROMPT + '\n[Note: Running in degraded mode — some memories may be unavailable.]' },
              ...recentMessages.map(m => ({ role: m.role as 'user' | 'assistant' | 'system', content: m.content }))
            ], {
              maxTokens: 1024,
              temperature: 0.85,
              frequency_penalty: 0.7,
              presence_penalty: 0.5,
            });
          } catch (nvidiaError) {
            throw new ExternalServiceError('NVIDIA', nvidiaError instanceof Error ? nvidiaError.message : String(nvidiaError));
          }
        }

        const messages = parseLLMResponse(sanitizeMarkdown(convertNovaTable(rawReply)));
        const reply = messages.join('\n\n');

        const textChunks = messages.flatMap(m => chunkResponse(m));
        const totalChunks = textChunks.length;
        const chunks = textChunks.map((content, idx) => ({
          index: idx + 1,
          total: totalChunks,
          content
        }));

        degradedMode.appendMessage(userId, 'assistant', reply);

        // Queue DB writes for later drain
        degradedMode.enqueue({ table: 'chat_history', operation: 'insert', data: { user_id: userId, conversation_id: activeConversationId, role: 'user', content: message, created_at: new Date().toISOString() } });
        degradedMode.enqueue({ table: 'chat_history', operation: 'insert', data: { user_id: userId, conversation_id: activeConversationId, role: 'assistant', content: reply, created_at: new Date().toISOString() } });

        if (isStreaming) {
          res.write(`data: ${JSON.stringify({ type: 'setup', conversation_id: activeConversationId })}\n\n`);
          res.write(`data: ${JSON.stringify({ type: 'chunk', content: reply })}\n\n`);
          res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
          res.end();
        } else {
          res.status(200).json({ reply, messages, chunks, conversation_id: activeConversationId, meta: { degraded: true } });
        }
        return;
      }

      // 1. Save user message IMMEDIATELY so it's in the DB
      // We skip for proactive triggers (no phantom user message in history)
      const userMsgResult = is_proactive
        ? { data: { id: 'proactive_' + Date.now() }, error: null }
        : await qt.track('save_user_message', 'chat_history', () =>
            supabaseAdmin.from('chat_history')
              .insert({ user_id: userId, conversation_id: activeConversationId, role: 'user', content: message, reply_to_id, reply_to_content })
              .select('id').single()
          );

      if (userMsgResult.error) {
        logger.error('[Chat] FAILED to save user message to DB', { 
          requestId, 
          userId, 
          error: userMsgResult.error.message || userMsgResult.error,
          errorCode: userMsgResult.error.code,
          messageLength: message.length 
        });
      } else if (userMsgResult.data) {
        logger.info('[Chat] User message saved to DB', { requestId, userId, messageId: userMsgResult.data.id });
        
        // 1.1 If there was an image, save the description as a hidden context message
        // This ensures the LLM remembers the image in future turns, but the UI ignores it.
        if (image_base64) {
          // We already called describeSharedImage above and it modified effectiveMessage.
          // Now we just save that extracted text to DB if it exists.
          const imageDescMatch = effectiveMessage.match(/\[User attached an image showing: (.*?)\]/);
          if (imageDescMatch && imageDescMatch[1]) {
            try {
              await supabaseAdmin.from('chat_history')
                .insert({
                  user_id: userId,
                  conversation_id: activeConversationId,
                  role: 'user',
                  content: `[HIDDEN_CONTEXT] User shared an image showing: ${imageDescMatch[1]}`
                });
            } catch (e) {
              logger.warn('[Chat] Failed to save hidden image context', { error: e });
            }
          }
        }
      } else {
        logger.warn('[Chat] User message save returned no data and no error', { requestId, userId });
      }
      const userMessageId = userMsgResult.data?.id || 'msg_' + Date.now();

      // Cancel any pending follow-ups since the user replied
      if (!is_proactive) {
        import('../services/NovaFollowupService').then(({ novaFollowupService }) => {
          novaFollowupService.cancelFollowups(userId).catch(e => logger.warn('Failed to cancel follow-ups', { error: e }));
        });

        // 1.5 Auto-update user presence since they just sent a message (they are online)
        supabaseAdmin.from('user_presence').upsert({
          user_id: userId,
          status: 'online',
          last_seen: new Date().toISOString()
        }).then(({ error }) => {
          if (error) logger.warn('Failed to update presence', { error });
        });
      }

      // Real-time correction detection: If user replied to a specific Nova message,
      // check if it's a correction and auto-generate a behavioral patch.
      if (reply_to_content && !is_proactive) {
        import('../services/NovaRealtimeLearningService').then(({ novaRealtimeLearning }) => {
          novaRealtimeLearning.analyzeCorrection(userId, message, reply_to_content)
            .catch(e => logger.warn('[REALTIME LEARNING] Background correction analysis failed', { error: e }));
        });
      }

      // Periodically reload behavioral patches so recently-applied corrections take effect
      import('../services/promptBuilder').then(({ promptBuilder: pb }) => {
        pb.maybeReloadPatches().catch(() => {});
      });

      // 2. If fast async mode is requested, return 202 IMMEDIATELY NOW THAT THE MESSAGE IS IN DB
      // so the client can mark it as delivered. The rest happens in the background.
      if (async_mode) {
        res.status(202).json({
          message: 'Processing in background',
          conversation_id: activeConversationId,
          user_message_id: userMessageId,
        });
      }
      
      // NOTE: If the frontend does not poll for async results, switch to sync mode
      // by sending async_mode: false in the request body.
      
      // Async mode: hard deadline — if processing takes >90s, attempt a short-context retry.
      // NEVER save server error messages to DB — that shows broken UX and confuses follow-up engines.
      const ASYNC_HARD_DEADLINE_MS = 90_000;
      let asyncDeadlineTimer: any = null;

      if (async_mode) {
        asyncDeadlineTimer = setTimeout(async () => {
          logger.error('[ASYNC] Hard 90s deadline exceeded — skipping DB save. The background follow-up engine will detect this as an unanswered user message and follow up naturally.', { userId });
        }, ASYNC_HARD_DEADLINE_MS);
      }


      // ── Mutex & Debounce ───────────────────────────────────────────────────
      // ── Mutex with Timeout ───────────────────────────────────────────────────
      const MUTEX_TIMEOUT_MS = 30_000;

      const previousLock = userLocks.get(userId);
      const newLock = new Promise<void>(resolve => { releaseLock = resolve; });

      if (previousLock) {
        // Wait for previous request with timeout
        let mutexTimeoutId: NodeJS.Timeout | null = null;
        const timeoutPromise = new Promise<void>((_, reject) => {
          mutexTimeoutId = setTimeout(() => reject(new Error('MUTEX_TIMEOUT')), MUTEX_TIMEOUT_MS);
        });
        
        try {
          await Promise.race([previousLock, timeoutPromise]);
          logger.info('[Chat] Previous lock resolved normally', { userId });
        } catch (err: any) {
          if (err.message === 'MUTEX_TIMEOUT') {
            logger.warn('[Chat] Mutex timeout — previous request hung, continuing', { userId });
            // Force-clear the stale lock
            userLocks.delete(userId);
          } else {
            throw err;
          }
        } finally {
          if (mutexTimeoutId) clearTimeout(mutexTimeoutId);
        }
      }

      // Set the new lock ONLY after previous is done or timed out
      userLocks.set(userId, newLock);
      logger.info('[Chat] Mutex acquired', { userId });
      
      try {

        // DEBOUNCE CHECK: Are there any NEWER user messages in this conversation?
        if (!is_proactive) {
          const { data: latestUserMsg } = await supabaseAdmin
            .from('chat_history')
            .select('id')
            .eq('user_id', userId)
            .eq('conversation_id', activeConversationId)
            .eq('role', 'user')
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
          
          if (latestUserMsg && latestUserMsg.id !== userMessageId) {
            logger.info('[Chat] Debouncing LLM request — a newer user message exists', { userId, userMessageId });
            if (isStreaming) {
              res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
              res.end();
            } else {
              res.status(200).json({ skipped: true, reason: 'debounced' });
            }
            return; // Abort LLM generation, the newer message's request will handle it
          }
        }
      
      // ── PARALLEL FETCH: profile, chat history, cross-session,
      // working memory, long-term memories, short-term memories — all at once.
      const keywords = extractKeywords(effectiveMessage);

      const profileCacheKey = `profile:${userId}`;
      const wmCacheKey = `working_memory:${userId}`;
      const cachedProfile = cache.get<{ preferred_name: string; companion_personality: string; country?: string; push_token?: string; current_visual_context?: string }>(profileCacheKey);
      const cachedWm = cache.get<{ key: string; value: string }[]>(wmCacheKey);

      const skipMemory = process.env.DISABLE_MEMORY === 'true';

      const dbStartTime = Date.now();
      const [
        profileResult,
        historyResult,
        crossSessionResult,
        wmResult,
        memoriesResult,
        stmResult,
        searchNeedResult
      ] = await Promise.all([
        // 1. Profile (use cache only if it has a push_token — avoids stale cache killing push delivery)
        (cachedProfile && cachedProfile.push_token)
          ? Promise.resolve({ data: cachedProfile, error: null })
          : qt.track('get_profile', 'profiles', () =>
              supabaseAdmin.from('profiles')
                .select('preferred_name, companion_personality, country, push_token, current_visual_context')
                .eq('id', userId).maybeSingle()
            ),

        // 3. Recent chat history (last 100, for deep context continuity)
        qt.track('get_chat_history', 'chat_history', () =>
          supabaseAdmin.from('chat_history')
            .select('role, content')
            .eq('user_id', userId)
            .eq('conversation_id', activeConversationId)
            .order('created_at', { ascending: false })
            .limit(100)
        ),

        // 3.5 Cross-session recent context
        qt.track('get_cross_session_context', 'chat_history', () =>
          supabaseAdmin.from('chat_history')
            .select('role, content')
            .eq('user_id', userId)
            .neq('conversation_id', activeConversationId)
            .order('created_at', { ascending: false })
            .limit(6)
        ).catch(() => ({ data: null, error: null })),

        // 4. Working memory (use cache if available)
        cachedWm
          ? Promise.resolve({ data: cachedWm.map(w => ({ key: w.key, value: w.value })), error: null })
          : skipMemory
          ? Promise.resolve({ data: [], error: null })
          : qt.track('get_working_memory', 'working_memory', () =>
              supabaseAdmin.from('working_memory')
                .select('key, value')
                .eq('user_id', userId)
                .gt('expires_at', new Date().toISOString())
                .limit(10)
            ),

        // 4. Long-term semantic memories
        skipMemory
          ? Promise.resolve([])
          : memoryRepository.searchMemories(userId, keywords).catch(() => []),

        // 4.5 Short-term memories
        skipMemory
          ? Promise.resolve({ data: [], error: null })
          : qt.track('get_short_term_memories', 'short_term_memories', () =>
              supabaseAdmin.from('short_term_memories')
                .select('memory, emotion, importance, mention_count, expires_at, confidence, created_at')
                .eq('user_id', userId)
                .gte('confidence', 0.6)
                .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
                .order('importance', { ascending: false })
                .order('last_mentioned_at', { ascending: false })
                .limit(20)
            ),
            
        // 5. Evaluate Web Search Need (Jarvis Protocol)
        import('../services/WebSearchService')
          .then(({ webSearchService }) => webSearchService.evaluateSearchNeed(effectiveMessage))
          .catch(() => null),
      ]);
      const dbDuration = Date.now() - dbStartTime;
      logger.info('[Chat] Context fetch completed', { userId, durationMs: dbDuration });

      // If a web search is needed, execute it and PREPEND to effectiveMessage
      // CRITICAL: Previously was added to memoryContext (buried) — LLM ignored it.
      // Now injected directly into the message the LLM is replying to.
      if (searchNeedResult) {
        try {
          const { webSearchService } = await import('../services/WebSearchService');
          const searchData = await webSearchService.executeSearch(searchNeedResult);
          if (searchData) {
            // Prepend search results DIRECTLY to the message the LLM will reply to
            effectiveMessage = `${searchData}\n\nUser's question: ${effectiveMessage}`;
            logger.info('[Chat] Web Search prepended to effectiveMessage', { query: searchNeedResult });
          }
        } catch (e) {
          logger.warn('[Chat] Failed to execute web search', { error: e });
        }
      }
      const webSearchContext = ''; // No longer used — search results now go into effectiveMessage

      // ── Unpack results ─────────────────────────────────────────────────────────
      // 1. Profile
      let profile = profileResult.data as { preferred_name: string; companion_personality: string; country?: string; push_token?: string; current_visual_context?: string } | null;
      if (profile && !cachedProfile) {
        cache.set(profileCacheKey, profile, CACHE_TTL.PROFILE_MS, CACHE_NS.PROFILE);
      }

      // 2.5 Track Session (fire & forget — non-critical)
      const today = new Date().toISOString().split('T')[0];
      (async () => {
        try {
          const { data: session } = await qt.track('get_session', 'conversation_sessions', () =>
            supabaseAdmin.from('conversation_sessions')
              .select('id, message_count').eq('user_id', userId).eq('session_date', today).maybeSingle()
          );
          if (session) {
            await qt.track('update_session', 'conversation_sessions', () =>
              supabaseAdmin.from('conversation_sessions')
                .update({ message_count: (session.message_count || 0) + 1, updated_at: new Date().toISOString() })
                .eq('id', session.id)
            );
          } else {
            await qt.track('create_session', 'conversation_sessions', () =>
              supabaseAdmin.from('conversation_sessions')
                .insert({ user_id: userId, session_date: today, message_count: 1 })
            );
          }
        } catch (err) {
          logger.error('Failed to track session', { error: err instanceof Error ? err.message : String(err) });
        }
      })();

      // 3. Chat history — filter out system fallback/error messages so
      // Nova never sees them in context and never responds TO them.
      const FALLBACK_PREFIXES = [
        'Yaar, kuch technical issue',
        'Yaar, thoda technical glitch',
        'kuch technical issue aa gaya',
        '[SYSTEM]',
        'Thodi der mein phir try karo',
        // LLM-hallucinated refusals — should also be filtered so Nova doesn't reference them
        'reminder set nahi kar sakta',
        'reminder system thoda busy',
        'Nova ka reminder system',
        'Sorry yaar, reminder',
        'system busy hai',
        'set nahi kar sakta',
      ];
      const isFallback = (content: string) =>
        FALLBACK_PREFIXES.some(p => content.includes(p));

      let recentMessages = ((historyResult.data || []) as any[])
        .filter(msg => msg.role !== 'assistant' || !isFallback(msg.content))
        .reverse()
        .map(msg => ({
          role: msg.role as 'user' | 'assistant' | 'system',
          content: msg.content
        }));

      // 3.5 Cross-session context — also filter fallback messages
      let recentCrossSessionContext = '';
      if (crossSessionResult.data && (crossSessionResult.data as any[]).length > 0) {
        const lines = (crossSessionResult.data as any[])
          .filter(m => !isFallback(m.content))  // ← no fallbacks in cross-session either
          .reverse()
          .map(m =>
            `${m.role === 'assistant' ? 'Nova' : 'User'}: ${m.content.substring(0, 200)}${m.content.length > 200 ? '...' : ''}`
          );
        recentCrossSessionContext = lines.join('\n');
      }

      // 4. Working memory
      let workingMemories: { key: string; value: string }[] = [];
      if (!skipMemory) {
        if (cachedWm) {
          workingMemories = cachedWm;
        } else if (wmResult.data) {
          workingMemories = (wmResult.data as any[]).map(wm => ({ key: wm.key, value: wm.value }));
          cache.set(wmCacheKey, workingMemories, CACHE_TTL.WORKING_MEMORY_MS, CACHE_NS.WORKING_MEMORY);
        }
      }

      // 4. Long-term memories
      const memories: any[] = Array.isArray(memoriesResult) ? memoriesResult : [];

      // 4.5 Short-term memories
      let shortTermMemories: any[] = [];
      if (!skipMemory) {
        const allFetched = (stmResult.data as any[]) || [];
        let stmTokens = 0;
        const budgetMemories = [];

        for (const m of allFetched) {
          const memStr = `${m.memory} ${m.emotion || ''}`;
          const tokens = Math.ceil(memStr.length / 4);
          if (stmTokens + tokens > 600) break;
          budgetMemories.push({
            memory: m.memory,
            emotion: m.emotion,
            importance: m.importance,
            timestamp: m.created_at ? timeAgo(m.created_at) : null
          });
          stmTokens += tokens;
        }

        shortTermMemories = budgetMemories;
        const importantShortTermCount = shortTermMemories.filter(m => m.expires_at === null).length;
        logger.info('ShortTermMemories Loaded:', { count: shortTermMemories.length });
        logger.info('Important Memories:', { count: importantShortTermCount });
        logger.info('Memory Tokens Injected:', { tokens: stmTokens });

        // Count total short term memories for user (fire & forget)
        supabaseAdmin.from('short_term_memories').select('id', { count: 'exact', head: true }).eq('user_id', userId)
          .then(({ count }) => {
            if (count !== null) logger.info('Total Memories For User:', { count });
          });
      } else {
        logger.info('[DEBUG] DISABLE_MEMORY=true — skipping all memory fetches');
      }


      // 5. Build prompt
      const responseConfig = classifyIntent(effectiveMessage, recentMessages.map(m => m.content));

      // 5.1 Situational Awareness: Fetch context from disconnected engines (parallel, lightweight)
      const userCountry = (profile as any)?.country || 'IN';
      const TIMEZONE_OFFSETS: Record<string, number> = {
        IN: 5.5, US: -5, UK: 0,  AU: 10, AE: 4,  SA: 3,
        PK: 5,   BD: 6,  SG: 8,  JP: 9,  DE: 1,  FR: 1,
        CA: -5,  NZ: 12, ZA: 2,  NG: 1,  KE: 3,  BR: -3,
      };
      const FRIDAY_SAT_WEEKEND = ['AE', 'SA', 'QA', 'BH', 'KW', 'OM', 'AF', 'IR'];
      const tzOffset = TIMEZONE_OFFSETS[userCountry] ?? 5.5;
      const nowLocal = new Date(Date.now() + tzOffset * 3600 * 1000);
      const DAY_NAMES   = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
      const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
      const dayIdx  = nowLocal.getUTCDay();
      const dateStr = `${DAY_NAMES[dayIdx]}, ${MONTH_NAMES[nowLocal.getUTCMonth()]} ${nowLocal.getUTCDate()}, ${nowLocal.getUTCFullYear()}`;
      const hh = nowLocal.getUTCHours(), mm = nowLocal.getUTCMinutes();
      const ampm = hh >= 12 ? 'PM' : 'AM';
      const timeStr = `${hh % 12 || 12}:${mm.toString().padStart(2,'0')} ${ampm}`;
      const tzLabel = tzOffset === 5.5 ? 'IST' : `UTC${tzOffset >= 0 ? '+' : ''}${tzOffset}`;
      const isWeekend = FRIDAY_SAT_WEEKEND.includes(userCountry)
        ? dayIdx === 5 || dayIdx === 6
        : dayIdx === 0 || dayIdx === 6;

      // Fetch disconnected engine data in parallel (all lightweight, single-row queries)
      let latestEmotion: { mood: string; intensity: number; notes: string } | null = null;
      let recentEpisodes: { summary: string; emotion: string | null; created_at: string }[] = [];
      let latestReflection: { summary: string; key_takeaways: any } | null = null;
      let gapMinutes: number | null = null;

      try {
        const [emotionResult, episodicResult, reflectionResult, lastMsgResult] = await Promise.all([
          // Latest emotional state
          qt.track('get_latest_emotion', 'emotional_states', () =>
            supabaseAdmin.from('emotional_states')
              .select('mood, intensity, notes')
              .eq('user_id', userId)
              .order('created_at', { ascending: false })
              .limit(1)
              .maybeSingle()
          ),
          // Recent episodic memories (last 5 life events)
          qt.track('get_recent_episodes', 'episodic_memories', () =>
            supabaseAdmin.from('episodic_memories')
              .select('summary, emotion, created_at')
              .eq('user_id', userId)
              .order('created_at', { ascending: false })
              .limit(5)
          ),
          // Latest daily reflection
          qt.track('get_latest_reflection', 'reflections', () =>
            supabaseAdmin.from('reflections')
              .select('summary, key_takeaways')
              .eq('user_id', userId)
              .order('created_at', { ascending: false })
              .limit(1)
              .maybeSingle()
          ),
          // Last message timestamp (for gap calculation)
          qt.track('get_last_msg_time', 'chat_history', () =>
            supabaseAdmin.from('chat_history')
              .select('created_at')
              .eq('user_id', userId)
              .order('created_at', { ascending: false })
              .limit(1)
              .maybeSingle()
          )
        ]);

        if (emotionResult.data) latestEmotion = emotionResult.data;
        if (episodicResult.data) recentEpisodes = episodicResult.data;
        if (reflectionResult.data) latestReflection = reflectionResult.data;
        if (lastMsgResult.data?.created_at) {
          gapMinutes = (Date.now() - new Date(lastMsgResult.data.created_at).getTime()) / 60000;
        }

        // Apply Gap Truncation logic to recentMessages
        if (gapMinutes !== null) {
          if (gapMinutes > 1440) { // 24 hours
            logger.info('[SituationalAwareness] Gap > 24h. Truncating context and rotating conversation_id.', { gapMinutes });
            // Rotate conversation ID so future DB fetches are clean
            activeConversationId = crypto.randomUUID();
            // Keep ONLY the latest user message
            if (recentMessages.length > 0 && recentMessages[recentMessages.length - 1].role === 'user') {
              recentMessages = [recentMessages[recentMessages.length - 1]];
            } else {
              recentMessages = [];
            }
          } else if (gapMinutes > 360) { // 6 hours
            logger.info('[SituationalAwareness] Gap > 6h. Limiting context to last 3 messages.', { gapMinutes });
            recentMessages = recentMessages.slice(-3);
          }
        }

        logger.info('[SituationalAwareness] Context loaded', {
          hasEmotion: !!latestEmotion,
          episodes: recentEpisodes.length,
          hasReflection: !!latestReflection,
          gapMinutes: gapMinutes ? Math.round(gapMinutes) : null
        });
      } catch (err) {
        logger.warn('[SituationalAwareness] Context fetch failed (non-critical)', {
          error: err instanceof Error ? err.message : String(err)
        });
      }

      let upcomingReminders: any[] = [];
      try {
        upcomingReminders = await reminderService.getUpcomingReminders(userId);
      } catch (err) {
        logger.warn('[SituationalAwareness] Reminders fetch failed', { error: err instanceof Error ? err.message : String(err) });
      }

      // Build the Situation Brief
      const situationCtx: SituationContext = {
        nowLocal,
        tzLabel,
        country: userCountry,
        gapMinutes,
        latestEmotion,
        recentEpisodes,
        latestReflection,
        isWeekend,
        dayName: DAY_NAMES[dayIdx],
        dateStr,
        timeStr,
        lastUserMessage: effectiveMessage, // For availability/mood signal detection
        upcomingReminders,
        currentVisualContext: profile?.current_visual_context
      };
      const situationBrief = situationalAwareness.buildBrief(situationCtx);

      // 5.5 Phase 3: Temporal Memory Search — inject exact timestamped history when user asks time-based questions
      let temporalContextBlock = '';
      const TEMPORAL_KEYWORDS = [
        'yesterday', 'days ago', 'last week', 'last month', 'do you remember',
        'what time', 'what day', 'when did', 'earlier today', 'this morning', 
        'last night', 'tell me what', 'you said', 'i said', 'we talked',
        // Hindi/Hinglish
        'kal', 'parso', 'yaad hai', 'yaad karo', 'kab', 'kitne baje', 
        'time kya tha', 'exact time', 'pehle', 'abhi', 'aaj subah',
        'raat ko', 'dopahar', 'shaam ko', 'maine kaha tha', 'tune kaha tha',
        'bataya tha', 'bola tha', 'likha tha'
      ];
      const lowerMsg = effectiveMessage.toLowerCase();
      const isTemporalQuery = TEMPORAL_KEYWORDS.some(kw => lowerMsg.includes(kw));

      if (isTemporalQuery) {
        try {
          const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
          const { data: temporalData } = await qt.track('get_temporal_context', 'chat_history', () =>
            supabaseAdmin.from('chat_history')
              .select('role, content, created_at')
              .eq('user_id', userId)
              .gte('created_at', thirtyDaysAgo)
              .order('created_at', { ascending: false })
              .limit(80)
          );

          if (temporalData && temporalData.length > 0) {
            const chronologicalData = temporalData.reverse();
            const istOffset = 5.5 * 60 * 60 * 1000;
            const lines = chronologicalData.map(m => {
              const d = new Date(new Date(m.created_at).getTime() + istOffset);
              const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
              const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
              const tStr = `${dayNames[d.getUTCDay()]}, ${monthNames[d.getUTCMonth()]} ${d.getUTCDate()} · ${d.getUTCHours().toString().padStart(2, '0')}:${d.getUTCMinutes().toString().padStart(2, '0')} IST`;
              const speaker = m.role === 'assistant' ? 'Nova' : 'You';
              const preview = m.content.substring(0, 300) + (m.content.length > 300 ? '...' : '');
              return `[${tStr}] ${speaker}: ${preview}`;
            });
            temporalContextBlock = '\n\n## WHAT WAS SAID RECENTLY (Exact Archive — last 30 days)\n' + lines.join('\n') + '\n\nCRITICAL TEMPORAL RULE: The user is asking about a past conversation or timestamp. Find the answer in the archive above and tell them the exact time or context. Do NOT bring up unrelated facts from your long-term memory.';
            logger.info('[Temporal] Injected archive', { rows: temporalData.length });
          }
        } catch (err) {
          logger.warn('[Temporal] Context fetch failed (non-critical)', { error: err instanceof Error ? err.message : String(err) });
        }
      }

      const { data: upcoming } = await supabaseAdmin
        .from('reminders')
        .select('*')
        .eq('user_id', userId)
        .eq('status', 'active')
        .gte('trigger_at', new Date().toISOString())
        .order('trigger_at', { ascending: true })
        .limit(10);
      
      let remindersContext = '';
      if (upcoming && upcoming.length > 0) {
        remindersContext = '\n\n## ACTIVE REMINDERS (SOURCE OF TRUTH)\nThe user currently has these reminders active:\n' + upcoming.map(r => {
          const timeStr = new Date(r.trigger_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
          const recurrence = r.recurrence_interval ? ` (repeats every ${r.recurrence_interval} ${r.recurrence_type || 'time(s)'})` : '';
          const dayFilter = r.active_days?.length ? ` [only on: ${r.active_days.join(', ')}]` : '';
          const monthFilter = r.active_months?.length ? ` [only in: ${r.active_months.join(', ')}${r.active_year ? ' ' + r.active_year : ''}]` : '';
          const autoTag = r.is_auto ? ' [auto-detected]' : '';
          return `- [ID: "${r.id}"] ${r.text || r.title} at ${timeStr}${recurrence}${dayFilter}${monthFilter}${autoTag}`;
        }).join('\n') + '\n\nCRITICAL: This list is the absolute source of truth. If past chat history says a reminder was cancelled but it appears here, it is STILL ACTIVE. Do not contradict this list.';
      } else {
        remindersContext = '\n\n## ACTIVE REMINDERS (SOURCE OF TRUTH)\nThe user currently has NO active reminders. CRITICAL: This is the absolute source of truth. If past chat history says a reminder was set, but this list is empty, it means there are NO active reminders. Do not contradict this fact.';
      }

      // === MEMORY RETRIEVAL (REUSE ALREADY-FETCHED DATA) ===
      let memoryContext = '';
      if (webSearchContext) {
        memoryContext += webSearchContext;
      }
      try {
        if (memories.length || shortTermMemories.length || workingMemories.length) {
          memoryContext += `\n\n## 🧠 WHAT YOU REMEMBER ABOUT THIS USER\n`;
          
          // ── Working Memory: show ALL keys, not just 2 hardcoded ones ─────────
          // CRITICAL FIX: Previously only current_focus + active_goals were shown.
          // Nova could not see: current_activity, feeling, conversation_partner, etc.
          if (workingMemories.length) {
            memoryContext += `\nWorking Memory (what the user JUST told you — treat as current facts):\n`;
            workingMemories.forEach(w => {
              // Format key as readable label
              const label = w.key.replace(/_/g, ' ');
              memoryContext += `- ${label}: ${w.value}\n`;
            });
          }
          
          if (memories.length) {
            memoryContext += `\nLong-term memories:\n`;
            memories.forEach(m => {
              memoryContext += `- ${m.content || m.memory || m.key + ': ' + m.value} (${m.category || m.memory_type || 'general'})\n`;
            });
          }
          
          if (shortTermMemories.length) {
            memoryContext += `\nRecent short-term memories:\n`;
            shortTermMemories.forEach(e => {
              memoryContext += `- ${e.memory || e.content || e.key + ': ' + e.value}\n`;
            });
          }
          
          memoryContext += `\nCRITICAL: When asked "what do you remember" or "what are my goals", LIST THESE SPECIFIC MEMORIES. Never give generic answers like "motivation and life satisfaction". Use actual names, dates, and facts from above.\n`;
        }
      } catch (e) {
        logger.warn('[Memory] Context building failed:', e);
      }

      const brainContext = {
        memories,
        workingMemories,
        profile,
        shortTermMemories,
        recentCrossSessionContext,
        situationBrief,
        temporalContextBlock,
        remindersContext,
        recentMessages,
        memoryContext,
        lengthInstruction: message.length < 20
          ? "KEEP IT VERY SHORT. 1-2 sentences max. User sent a tiny message."
          : "Match the user's depth, but still use short conversational messages.",
        userCountry: profile?.country || 'IN'
      };

      // Trigger engine is for proactive scheduling only — skip for direct replies
      logger.info('[Chat] Processing direct reply', { userId });

      let extractedActions: any[] = [];
      let rawReply = '';
      if (isExcessiveRequest(effectiveMessage)) {
        rawReply = "That's quite a large request. I can help with one section at a time. Please break it into smaller parts.";
        if (isStreaming) {
          res.setHeader('Content-Type', 'text/event-stream');
          res.setHeader('Cache-Control', 'no-cache');
          res.setHeader('Connection', 'keep-alive');
          res.flushHeaders();
          res.write(`data: ${JSON.stringify({ type: 'setup', conversation_id: activeConversationId })}\n\n`);
          res.write(`data: ${JSON.stringify({ type: 'chunk', content: rawReply })}\n\n`);
        }
      } else {
        try {
          const llmStartTime = Date.now();
          logger.info('[Chat] Calling LLM', { userId });
          
          if (isStreaming) {
            res.write(`data: ${JSON.stringify({ type: 'setup', conversation_id: activeConversationId })}\n\n`);
            
            const { novaBrain } = await import('../services/NovaBrainService');
            const stream = novaBrain.streamInteraction(userId, effectiveMessage, brainContext);
            const iterator = stream[Symbol.asyncIterator]();
            
            const STREAM_CHUNK_TIMEOUT_MS = 60_000; // Increased to 60s to allow for slow TTFT on 70B models

            while (true) {
              let chunkTimeoutId: NodeJS.Timeout | null = null;
              const chunkPromise = iterator.next();
              const timeoutPromise = new Promise<never>((_, reject) => {
                chunkTimeoutId = setTimeout(() => reject(new Error('STREAM_TIMEOUT')), STREAM_CHUNK_TIMEOUT_MS);
              });
              
              let nextResult;
              try {
                nextResult = await Promise.race([chunkPromise, timeoutPromise]);
              } catch (err: any) {
                if (err.message === 'STREAM_TIMEOUT') {
                  logger.error('[Chat] Streaming LLM chunk timed out', { userId });
                  res.write(`data: ${JSON.stringify({ type: 'error', error: 'Yaar, thoda slow chal raha hai server. Ek minute mein phir try kar! 🙏' })}\n\n`);
                  res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
                  res.end();
                  return;
                }
                
                // Handle actual API errors (e.g. Nvidia 500/401) without crashing the server
                logger.error('[Chat] LLM stream iteration failed', { error: err.message || err, userId });
                res.write(`data: ${JSON.stringify({ type: 'error', error: 'Yaar, thoda technical glitch ho gaya. Ek second mein phir try kar!' })}\n\n`);
                res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
                res.end();
                return;
              } finally {
                if (chunkTimeoutId) clearTimeout(chunkTimeoutId);
              }

              const { value, done } = nextResult;
              if (done) {
                if (value && value.subconscious_actions && value.subconscious_actions.length > 0) {
                  extractedActions = value.subconscious_actions;
                  const { backgroundActions } = await import('../services/BackgroundActionService');
                  // Execute in background
                  backgroundActions.processActions(userId, activeConversationId, value.subconscious_actions, userCountry).catch(e => {
                    logger.error('[BackgroundAction] Unhandled failure', { error: e });
                  });
                }
                break;
              }
              if (value) {
                rawReply += value;
                res.write(`data: ${JSON.stringify({ type: 'chunk', content: value })}\n\n`);
                if (typeof (res as any).flush === 'function') (res as any).flush();
              }
            }
          } else {
            const { novaBrain } = await import('../services/NovaBrainService');
            
            const LLM_TIMEOUT_MS = 25_000; // 25 seconds max for LLM

            const llmPromise = novaBrain.processInteraction(userId, effectiveMessage, brainContext);
            let llmTimeoutId: NodeJS.Timeout | null = null;
            const timeoutPromise = new Promise<never>((_, reject) => {
              llmTimeoutId = setTimeout(() => reject(new Error('LLM_TIMEOUT')), LLM_TIMEOUT_MS);
            });

            let result: { reply: string; subconscious_actions: any[] };
            try {
              result = await Promise.race([llmPromise, timeoutPromise]);
            } catch (llmErr: any) {
              if (llmErr.message === 'LLM_TIMEOUT') {
                logger.error('[Chat] LLM call timed out', { userId, messageLength: effectiveMessage.length });
                result = { 
                  reply: 'Yaar, thoda slow chal raha hai server. Ek minute mein phir try kar! 🙏',
                  subconscious_actions: []
                };
              } else {
                throw llmErr;
              }
            } finally {
              if (llmTimeoutId) clearTimeout(llmTimeoutId);
            }

            rawReply = result.reply;
            if (result.subconscious_actions && result.subconscious_actions.length > 0) {
              extractedActions = result.subconscious_actions;
              const { backgroundActions } = await import('../services/BackgroundActionService');
              // Execute in background
              backgroundActions.processActions(userId, activeConversationId, result.subconscious_actions, userCountry).catch(e => {
                logger.error('[BackgroundAction] Unhandled failure', { error: e });
              });
            }
          }
          
          const llmDuration = Date.now() - llmStartTime;
          logger.info('[Chat] LLM response received', { userId, durationMs: llmDuration });
          if (llmDuration > 5000) {
            logger.warn('[Chat] LLM call slow', { userId, durationMs: llmDuration });
          }
          
          // Auto-append table offer as follow-up bubble in LONG_CONTEXT mode
          if (responseConfig.shouldOfferTable && !rawReply.includes('<NOVA_TABLE>')) {
            const extraText = '\n<NOVA_MESSAGE_BREAK>\nTable format mein dekhna chahega? Zyada clear hoga.';
            rawReply += extraText;
            if (isStreaming) {
              res.write(`data: ${JSON.stringify({ type: 'chunk', content: extraText })}\n\n`);
              if (typeof (res as any).flush === 'function') (res as any).flush();
            }
          }
        } catch (nvidiaError: any) {
          const errStr = nvidiaError instanceof Error ? nvidiaError.message : String(nvidiaError);
          const isContentPolicy = errStr.toLowerCase().includes('policy') || errStr.toLowerCase().includes('moderation') || nvidiaError?.status === 400 || nvidiaError?.status === 422 || errStr.includes('400') || errStr.includes('422');
          logger.error('[NVIDIA] LLM call failed', { error: errStr, async_mode });
          if (isStreaming) {
            res.write(`data: ${JSON.stringify({ type: 'error', error: errStr })}\n\n`);
            if (typeof (res as any).flush === 'function') (res as any).flush();
            res.end();
            return;
          } else if (async_mode) {
            if (isContentPolicy) {
              rawReply = 'Acha, is topic par main jyada bol nahi sakti yaar 😂 kuch aur baat karte hain?';
            } else {
              rawReply = 'Yaar, kuch technical issue aa gaya abhi. Thodi der mein phir try karo!';
            }
            logger.warn('[ASYNC] Saved fallback reply due to LLM failure', { userId, isContentPolicy });
          } else {
            throw new ExternalServiceError('NVIDIA', errStr);
          }
        }
      }

      if (isStreaming) {
        res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
        res.end();
      }

      let optionsArray: string[] | undefined;
      const optionsMatch = rawReply.match(/<OPTIONS>([\s\S]*?)<\/OPTIONS>/);
      if (optionsMatch) {
        try {
          optionsArray = JSON.parse(optionsMatch[1]);
          rawReply = rawReply.replace(/<OPTIONS>[\s\S]*?<\/OPTIONS>/, '').trim();
        } catch (e) {
          logger.warn('Failed to parse OPTIONS JSON', { error: e instanceof Error ? e.message : String(e) });
        }
      }

      // Add Emoji
      let parsedEmotion = 'joy';
      try {
        if (situationBrief) {
          const emotionMatch = situationBrief.match(/Current Emotion: (\w+)/);
          if (emotionMatch && emotionMatch[1]) {
            parsedEmotion = emotionMatch[1].toLowerCase();
          }
        }
      } catch (e) {}
      
      // Extract Image Requests
      let generatedImages: string[] = [];
      const imageMatch = rawReply.match(/<NOVA_IMAGE>(.*?)<\/NOVA_IMAGE>/s);
      if (imageMatch && imageMatch[1]) {
        const prompt = imageMatch[1].trim();
        const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=1024&nologo=true`;
        generatedImages.push(`![${prompt}](${imageUrl})`);
        rawReply = rawReply.replace(/<NOVA_IMAGE>.*?<\/NOVA_IMAGE>/s, '').trim();
      }

      // Extract Autonomous Vision requests
      if (rawReply.includes('<NOVA_VISION>')) {
        rawReply = rawReply.replace(/<NOVA_VISION>/g, '').trim();
        if (profile?.push_token) {
          sendVisionSnapNotification(profile.push_token).catch(e => 
            logger.error('[ChatRouter] Failed to send vision snap notification', { error: e.message })
          );
        }
      }

      let parsedMessages = parseLLMResponse(sanitizeMarkdown(convertNovaTable(rawReply)));
      
      // Append generated images as separate bubbles after stripping so they aren't removed
      if (generatedImages.length > 0) {
        parsedMessages = [...parsedMessages, ...generatedImages];
      }

      // Add emoji based on detected emotion
      const emotion = parsedEmotion || 'neutral';
      const messagesWithEmoji = parsedMessages.map(msg => {
        // Don't add emoji to very short messages
        if (msg.length < 15) return msg;
        return MessageFormatter.addEmoji(msg, emotion);
      });
      
      // Split each parsed message further if it's too long
      let finalBubbles = messagesWithEmoji.flatMap(m => chunkResponse(m)).filter(b => b.trim().length > 0);
      
      // If no valid bubbles were generated (e.g. LLM returned blank), safely abort
      if (finalBubbles.length === 0) {
        logger.info('[Chat] LLM returned a blank reply (likely Subconscious only). No bubbles generated.');
        if (isStreaming) {
          res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
          res.end();
        }
        return;
      }
      const reply = finalBubbles.join('\n\n');

      // 7. Save AI response ONCE (with telemetry meta)
      // Check for duplicates due to race conditions
      const isDuplicate = await isDuplicateAssistantMessage(userId, activeConversationId, reply, 5);
      
      const REJECT_PREFIXES = [
        'Yaar, kuch technical issue',
        'Yaar, thoda technical glitch',
        'kuch technical issue aa gaya',
        'Yaar, thoda slow chal raha hai server',
        'Thodi der mein phir try karo',
        'Acha, is topic par main jyada bol nahi sakti'
      ];
      const isFallbackReply = REJECT_PREFIXES.some(p => rawReply.includes(p));

      // Only save to DB if it's NOT a fallback/error message
      if (!isDuplicate && !isFallbackReply) {
        // Fetch push token fresh for the loop
        const pushTokenResult = await supabaseAdmin
          .from('profiles')
          .select('push_token')
          .eq('id', userId)
          .maybeSingle();
        const pushToken = pushTokenResult.data?.push_token as string | undefined;

        // Create separate DB rows for each bubble
        for (let idx = 0; idx < finalBubbles.length; idx++) {
          const msgText = finalBubbles[idx];
          const rowData = {
            user_id: userId,
            conversation_id: activeConversationId,
            role: 'assistant',
            content: msgText,
            reply_to_id: idx === 0 ? userMessageId : null,
            reply_to_content: idx === 0 ? message.substring(0, 100) : null,
            meta: idx === finalBubbles.length - 1 ? {
              situationBrief: situationBrief || null,
              subconsciousActions: extractedActions,
              options: optionsArray
            } : null
          };
          
          const saveResult = await qt.track('save_ai_response', 'chat_history', () => 
            supabaseAdmin.from('chat_history').insert(rowData).select().single()
          );
          
          if (saveResult.error) {
            logger.error('[Chat] FAILED to save AI response to DB', { 
              requestId, 
              userId, 
              error: saveResult.error.message || saveResult.error,
              errorCode: saveResult.error.code,
              rowData: { 
                user_id: rowData.user_id, 
                conversation_id: rowData.conversation_id, 
                role: rowData.role,
                contentLength: rowData.content?.length 
              }
            });
            
            // EMERGENCY: Try to save without the .select().single() — just raw insert
            const emergencyResult = await supabaseAdmin
              .from('chat_history')
              .insert({
                user_id: userId,
                conversation_id: activeConversationId,
                role: 'assistant',
                content: msgText,
              });
              
            if (emergencyResult.error) {
              logger.error('[Chat] EMERGENCY insert also failed', { 
                requestId, 
                userId, 
                error: emergencyResult.error.message 
              });
            } else {
              logger.info('[Chat] EMERGENCY insert succeeded', { requestId, userId });
            }
            
            // Always try to send push notification even if DB save failed
            if (pushToken) {
              await sendNovaReplyNotification(pushToken, msgText, activeConversationId, 'emergency_' + Date.now())
                .catch(err => logger.warn('[Push] Emergency notification failed', { error: err?.message }));
            }
          } else if (saveResult.data) {
            const savedMsg = saveResult.data;
            logger.info('[Chat] AI response saved to DB', { requestId, userId, messageId: savedMsg.id });
            
            // Send push for each bubble (with small delay between)
            if (pushToken) {
              await sendNovaReplyNotification(pushToken, msgText, activeConversationId, savedMsg.id)
                .catch(err => logger.warn('[Push] sendNovaReplyNotification failed', { error: err?.message }));
              if (idx < finalBubbles.length - 1) {
                await new Promise(r => setTimeout(r, 800));
              }
            }
          } else {
            logger.warn('[Chat] AI response save returned no data and no error', { requestId, userId });
          }
        }
      } else {
        logger.warn('[Chat] Prevented saving duplicate assistant message', { userId, conversation_id: activeConversationId });
      }

      // Generate chunks for UI (only needed for REST response)
      let chunks: any[] = [];
      let parsedMessagesArray: string[] = [];
      
      if (!isStreaming) {
        parsedMessagesArray = finalBubbles;
        const totalChunks = finalBubbles.length;
        chunks = finalBubbles.map((content, idx) => ({
          index: idx + 1,
          total: totalChunks,
          content
        }));
      }

      // 8. Also buffer to in-memory (for degraded mode recovery continuity)
      degradedMode.appendMessage(userId, 'user', message);
      degradedMode.appendMessage(userId, 'assistant', reply);

      // 9. Background extraction — skipped when DISABLE_MEMORY=true
      if (process.env.DISABLE_MEMORY !== 'true') {
        const payload = { userId, messageId: userMessageId, message };

        const isFiller = message.length < 10 && !shouldExtractShortTermMemory(message);
        
        const backgroundJobs: Promise<any>[] = [];
        
        if (!isFiller) {
          backgroundJobs.push(
            memoryQueue.add('extract_semantic', payload),
            memoryQueue.add('extract_working_memory', payload),
            memoryQueue.add('extract_episodic', payload),
            memoryQueue.add('extract_kg', payload),
            memoryQueue.add('extract_emotional', payload),
            memoryQueue.add('extract_milestone', payload)
          );
        } else {
          logger.info('Memory Extraction Skipped:', { reason: 'Ultra-short filler message' });
        }

        if (shouldExtractShortTermMemory(message)) {
          const rateKey = `stm_rate_${userId}`;
          const currentCount = cache.get<number>(rateKey) || 0;

          if (currentCount >= 50) {
            logger.info('Memory Extraction Skipped:', { reason: 'Rate limit exceeded (50/hr)' });
          } else {
            cache.set(rateKey, currentCount + 1, 60 * 60 * 1000, 'rate_limit');
            backgroundJobs.push(memoryQueue.add('extract_short_term', {
              ...payload,
              novaReply: rawReply,
              conversationSnapshot: recentMessages.slice(-6).map(m => 
                `${m.role === 'user' ? 'User' : 'Nova'}: ${m.content.substring(0, 200)}`
              ).join('\n')
            }));
          }
        }

        Promise.all(backgroundJobs).catch(err => {
          logger.error('Failed to enqueue background extraction jobs', { error: err instanceof Error ? err.message : String(err) });
        });

        cache.invalidate(wmCacheKey);
      } else {
        logger.info('[DEBUG] DISABLE_MEMORY=true — skipping background extraction jobs');
      }

      // Push notifications are now sent per-bubble directly after DB insert

      const totalDuration = Date.now() - requestStartTime;
      logger.info('[Chat] Request completed', { requestId, userId, durationMs: totalDuration });
      if (totalDuration > 10000) {
        logger.warn('[Chat] Total request slow', { userId, totalDurationMs: totalDuration });
      }
      
      if (asyncDeadlineTimer) {
        clearTimeout(asyncDeadlineTimer);
      }

      // In async_mode the 202 was already sent above — skip the synchronous response
      if (!isStreaming && !async_mode) {
        res.status(200).json({
          reply,
          messages: parsedMessagesArray,
          chunks,
          conversation_id: activeConversationId,
          user_message_id: userMessageId,
          meta: {
            memories_retrieved: memories.length,
            keywords_searched: keywords,
            degraded: false,
          }
        });
      }
    } catch (err) {
      // In async_mode: 202 was already sent. If we reach here, the user message
      // is in the DB but Nova never replied. Save a fallback reply so the user
      // always gets SOMETHING and the chat never stays stuck.
      const isAsync = req.body?.async_mode === true;
      if (isAsync) {
        logger.error('[ASYNC] Unexpected crash during processing — saving fallback reply', {
          error: err instanceof Error ? err.message : String(err),
          userId: (req as any).user?.id,
        });
        try {
          const userId = (req as any).user?.id;
          const activeConversationId = (req.body?.conversation_id) || '';
          if (userId) {
            await supabaseAdmin.from('chat_history').insert({
              user_id: userId,
              conversation_id: activeConversationId,
              role: 'assistant',
              content: 'Yaar, thoda technical glitch ho gaya. Ek second mein phir try kar!',
            });
            // Try to push a notification so user knows to check
            const ptResult = await supabaseAdmin.from('profiles').select('push_token').eq('id', userId).maybeSingle();
            if (ptResult.data?.push_token) {
              sendNovaReplyNotification(ptResult.data.push_token, 'Yaar, thoda glitch hua. Dekh lo!').catch(() => {});
            }
          }
        } catch (fallbackErr) {
          logger.error('[ASYNC] Could not save fallback reply', { error: fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr) });
        }
      }
      
      if (!isAsync) {
        if (res.headersSent) {
          logger.error('[Chat] Unhandled error during streaming', { error: err instanceof Error ? err.message : String(err) });
          try {
            res.write(`data: ${JSON.stringify({ type: 'error', error: 'Yaar, thoda technical glitch ho gaya. Ek second mein phir try kar!' })}\n\n`);
            res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
            res.end();
          } catch (e) {}
        } else {
          throw err; // throw to the outer catch
        }
      }
    } finally {
      if (releaseLock) {
        releaseLock();
        logger.info('[Chat] Mutex released', { userId });
      }
      // Always clean up — even if the lock was replaced due to timeout
      userLocks.delete(userId);
    }
  } catch (outerErr) {
    next(outerErr);
  }
}
);

// ── GET History ───────────────────────────────────────────────────────────────
chatRouter.get(
  '/',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = (req as any).user!.id;
      const conversationId = req.query.conversation_id as string | undefined;

      // Pagination params
      const rawLimit = parseInt(req.query.limit as string || '50', 10);
      const limit = Math.min(Math.max(rawLimit, 1), 200); // clamp 1–200
      const beforeId = req.query.before_id as string | undefined;

      let query = supabaseAdmin
        .from('chat_history')
        .select('id, role, content, created_at, conversation_id, user_id, meta, user_reaction')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (conversationId) query = query.eq('conversation_id', conversationId);

      // Cursor: if before_id provided, get the timestamp of that message and
      // return only messages strictly older than it.
      if (beforeId) {
        const { data: cursorRow } = await supabaseAdmin
          .from('chat_history')
          .select('created_at')
          .eq('id', beforeId)
          .eq('user_id', userId)
          .maybeSingle();
        if (cursorRow?.created_at) {
          query = (query as any).lt('created_at', cursorRow.created_at);
        }
      }

      const { data, error } = await qt.track('get_history', 'chat_history', () => query);
      if (error) throw new Error(error.message);

      // Return in ascending order (oldest first) so the client can prepend correctly
      res.status(200).json((data || []).reverse());
    } catch (err) {
      next(err);
    }
  }
);

// ── SET Reaction ──────────────────────────────────────────────────────────────
chatRouter.post(
  '/:messageId/reaction',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = (req as any).user!.id;
      const { messageId } = req.params;
      const { reaction } = req.body;
      const cleanMessageId = messageId.replace(/_part_\d+$/, '');

      const { data, error } = await qt.track('set_reaction', 'chat_history', () =>
        supabaseAdmin
          .from('chat_history')
          .update({ user_reaction: reaction })
          .eq('id', cleanMessageId)

          .eq('user_id', userId)
          .select()
          .single()
      );

      if (error) {
        throw new Error(error.message);
      }

      res.status(200).json({ success: true, reaction: data?.user_reaction });
    } catch (err) {
      next(err);
    }
  }
);
