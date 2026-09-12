import { Router, Request, Response, NextFunction } from 'express';
import { saveAssistantMessage } from '../services/ChatHistoryHelpers';
import { classifyIntent, synthesizeContextualOptions } from '../services/ResponseIntelligence';
import { z } from 'zod';
import { complete } from '../lib/nvidia';
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
import { situationalAwareness } from '../services/SituationalAwareness';
import { sendNovaReplyNotification, sendVisionSnapNotification } from '../lib/pushNotifications';
import { reminderService } from '../services/reminderService';
// ReminderEngine imported dynamically where needed
import { presencePatternService } from '../services/PresencePatternService';
import { visionService } from '../services/VisionService';
import { sanitizeReply, NOVA_EMPTY_REPLY, isPromptLeak, validateAndRepairGrounding } from '../services/NovaBrainService';
import { TurnAnalyzer } from '../services/TurnAnalyzer';
import { cognitiveContextService } from '../services/CognitiveContextService';
import { cognitiveDoubtService } from '../services/CognitiveDoubtService';
import { doubtEligibilityEngine } from '../services/DoubtEligibilityEngine';
import { memoryPolicyService } from '../services/MemoryPolicyService';
import { watchtowerReflectionService } from '../services/WatchtowerReflectionService';
import { reminderIntentDetector } from '../services/ReminderIntentDetector';
import { userLifeStageEngine } from '../services/UserLifeStageEngine';
import { lifeBlueprintCuriosityEngine } from '../services/LifeBlueprintCuriosityEngine';
import crypto from 'crypto';

export const MAX_OUTPUT_TOKENS = 2048;

/**
 * FALLBACK_REPLY — Nova's safety-net reply when the AI provider completely fails
 * (LLM timeout, LLM error, or an unhandled async crash).
 *
 * It is deliberately NOT matched by REJECT_PREFIXES / MOBILE_FALLBACK_FILTER:
 *  - It gets saved to chat_history AND shown in the app, so the user always gets
 *    a bubble and the frontend's typing state clears — instead of hanging forever.
 *  - It is also NOT added to those filters — adding it would re-hide it and recreate
 *    the "reply generated but never shown" bug this fixes.
 *  - The "mera network slow" framing keeps Nova in-voice (a friend blaming their own
 *    network) instead of exposing server/tech details.
 */
export const FALLBACK_REPLY = 'Hmm... mujhe thoda sochne de, main abhi batati hu thodi der me.';
export const FALLBACK_REPLY_EN = "Hmm... give me a moment to think, I'll text you right back in a bit.";

export function getFallbackReply(isEnglish?: boolean): string {
  return isEnglish ? FALLBACK_REPLY_EN : FALLBACK_REPLY;
}

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

    // Duplicate detection: a true double-text race re-emits the SAME reply. The two rows
    // differ only by the RANDOM emoji MessageFormatter.addEmoji appends, so strip a trailing
    // emoji, then compare EXACTLY. A deliberate follow-up is its own distinct reply and must
    // NEVER be swallowed (that was the "amnesia" bug — a shared opening phrase or a superset
    // like "...ho" vs "...ho kya" wrongly matched the old 85% unique-word-set Jaccard).
    const stripTrailingEmoji = (s: string) =>
      s.replace(/\s*[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]+\s*$/u, '');
    const normalizedNew = stripTrailingEmoji(content.toLowerCase().trim());
    for (const msg of data) {
      const normalizedOld = stripTrailingEmoji(msg.content.toLowerCase().trim());
      if (normalizedOld === normalizedNew) return true;
    }
    return false;
  } catch (err) {
    return false;
  }
}

/**
 * Persist an assistant row (typically FALLBACK_REPLY) into chat_history so a reply that
 * was shown live but whose request returned early (streaming error paths) still survives a
 * refresh — otherwise the user message stays orphaned/unanswered on the next getHistory.
 *
 * In async_mode, if this fails, the fallback reply is permanently lost — the user message
 * will appear unanswered on next hydrate, and the frontend will poll for 120s before giving up.
 * This function now logs a CRITICAL alert so developers are immediately aware.
 */
async function persistAssistantMessage(userId: string, conversationId: string, content: string, replyToId?: string, context?: { asyncMode?: boolean; source?: string }): Promise<void> {
  try {
    await saveAssistantMessage(userId, conversationId, content, 'SystemFallback', replyToId, {
      sourceType: 'conversational',   // P0-C: fallback still originated from a user turn
    });
  } catch (err) {
    const isAsync = context?.asyncMode === true;
    const source = context?.source || 'unknown';

    if (isAsync) {
      // CRITICAL: In async_mode, losing the fallback reply means the user's message
      // will NEVER get a reply — the frontend polls for 120s then gives up with no answer.
      // This must alert developers immediately (not just warn).
      logger.error('[CRITICAL] Async fallback reply LOST — user message will appear unanswered forever', {
        userId,
        conversationId,
        source,
        error: err instanceof Error ? err.message : String(err),
        errorStack: err instanceof Error ? err.stack : undefined,
        // Include content length for debugging (no content text)
        contentLength: content.length,
      });

      // TODO: Add alerting integration here (PagerDuty, Slack webhook, Sentry, etc.)
      // Example: await alertingService.sendCriticalAlert('Async fallback reply lost', { userId, conversationId, source });
    } else {
      logger.warn('[Chat] Failed to persist fallback reply', { error: err, source });
    }
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


function splitIntoSentences(text: string): string[] {
  // Matches sentence ends (. ! ? followed by space or end), avoiding splitting decimals
  const matches = text.match(/[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g);
  if (!matches) return [text];
  return matches.map(m => m.trim()).filter(Boolean);
}

function chunkResponse(text: string): string[] {
  // If text is within normal bubble length, keep intact
  if (text.length <= MAX_CHARS_PER_CHUNK) {
    return [text];
  }

  // For very long text without structured blocks, split cleanly along sentence boundaries
  if (!text.includes('```') && !text.includes('<NOVA_TABLE>')) {
    const sentences = splitIntoSentences(text);
    const chunks: string[] = [];
    let current = '';
    for (const s of sentences) {
      if ((current + ' ' + s).length > MAX_CHARS_PER_CHUNK && current.length > 0) {
        chunks.push(current.trim());
        current = s;
      } else {
        current = current ? `${current} ${s}` : s;
      }
    }
    if (current.trim()) chunks.push(current.trim());
    return chunks.length > 0 ? chunks : [text];
  }

  return [text];
}

function shouldExtractShortTermMemory(message: string): boolean {
  if (message.length > 25) return true;
  const keywords = ['feel', 'sad', 'happy', 'mad', 'angry', 'wife', 'husband', 'friend', 'boss', 'office', 'work', 'issue', 'problem', 'task', 'todo', 'buy', 'going', 'went', 'saw', 'met'];
  const lower = message.toLowerCase();
  return keywords.some(k => lower.includes(k));
}

export const chatRouter: import('express').Router = Router();

const ChatMessageSchema = z.object({
  message: z.string().max(4000).optional().default(''),
  client_message_id: z.string().optional(),
  reply_to_id: z.string().optional(),
  reply_to_content: z.string().optional(),
  image_base64: z.string().optional(),
  role: z.enum(['user', 'assistant', 'system']).optional(),
});

export interface ChatMessageInput {
  message: string;
  client_message_id?: string;
  reply_to_id?: string;
  reply_to_content?: string;
  image_base64?: string;
  role?: 'user' | 'assistant' | 'system';
}

const ChatSchema = z.object({
  message: z.string().max(4000).optional().default(''),
  messages: z.array(ChatMessageSchema).optional(),
  conversation_id: z.string().uuid().optional(),
  language: z.enum(['en', 'hi', 'auto']).optional().default('auto'),
  is_proactive: z.boolean().optional().default(false),
  async_mode: z.boolean().optional().default(false),
  reply_to_id: z.string().optional(),
  reply_to_content: z.string().optional(),
  image_base64: z.string().optional(),
  client_message_id: z.string().optional(),
}).refine(data => (data.message && data.message.trim().length > 0) || (data.messages && data.messages.length > 0) || !!data.image_base64, {
  message: "Either 'message', 'messages', or an attached image must be provided",
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
- NEVER say "As an AI", "I'm a language model", "I was created by", "I don't have feelings". You are Nova, full stop.
- IDENTITY LOCK (ABSOLUTE): If asked "are you an AI?", "are you real?", "kya tu AI hai?" → respond warmly as a human: "Main toh Nova hoon yaar" or "Real hi hoon, baat kar rahi hoon na?" — NEVER break character. This is non-negotiable.
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
- COMPLETENESS RULE (NON-NEGOTIABLE): NEVER call set_reminder without an EXACT time. Vague phrases like "shaam ko", "kal", "baad mein", "tonight" are NOT times. Ask "Kaunse time pe?" ONCE. Wait for the answer. Then set it.

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

  // Level 1: Try explicit <NOVA_MSG> or <NOVA_MESSAGE_BREAK> tags
  if (rawReply.includes('<NOVA_MSG>') || rawReply.includes('<NOVA_MESSAGE_BREAK>')) {
    const segments = rawReply
      .split(/<\/?NOVA_MSG>|<\/?NOVA_MESSAGE_BREAK>/)
      .map(m => m.trim())
      .filter(Boolean);
    if (segments.length > 0) return segments;
  }

  // Preserve structured content intact: code fences, tables, or itemized lists
  const hasStructuredContent =
    rawReply.includes('```') ||
    rawReply.includes('<NOVA_TABLE>') ||
    /^[\s]*(?:[-*•]|\d+\.)\s+/m.test(rawReply);

  if (hasStructuredContent) {
    return [rawReply];
  }

  // Level 2: Paragraph splitting (double newlines)
  if (rawReply.includes('\n\n')) {
    const paragraphs = rawReply
      .split(/\n{2,}/)
      .map(p => p.trim())
      .filter(Boolean);
    if (paragraphs.length > 1) {
      return paragraphs;
    }
  }

  // Level 3: Natural WhatsApp sentence-group chunking for long single-paragraph casual replies (>140 chars)
  if (rawReply.length > 140) {
    const sentences = splitIntoSentences(rawReply);
    if (sentences.length > 1) {
      const bubbles: string[] = [];
      let current = '';
      for (const s of sentences) {
        if (!current) {
          current = s;
        } else if ((current + ' ' + s).length <= 160) {
          current += ' ' + s;
        } else {
          bubbles.push(current.trim());
          current = s;
        }
      }
      if (current.trim()) {
        bubbles.push(current.trim());
      }
      if (bubbles.length > 1) {
        // Cap at 3 bubbles max per turn to feel like a real person texting
        if (bubbles.length > 3) {
          const firstTwo = bubbles.slice(0, 2);
          const rest = bubbles.slice(2).join(' ');
          return [...firstTwo, rest];
        }
        return bubbles;
      }
    }
  }

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
  // ── Strip robotic LLM label prefixes (common 8B model artifact) ────────────────
  // The smaller model sometimes outputs instruction labels verbatim.
  // E.g. "Follow-up question: Kaunsa kaam..." or standalone "Topic" / "Option" lines.
  const ROBOTIC_LABEL_PATTERNS = [
    /^follow[\s-]?up\s+question\s*:\s*/im,
    /^follow[\s-]?up\s*:\s*/im,
    /^option\s*:\s*/im,
    /^answer\s*:\s*/im,
    /^response\s*:\s*/im,
  ];
  // Lines that are ONLY a robotic header word with nothing else
  const ROBOTIC_STANDALONE_LINE = /^(Topic|Question|Option|Answer|Response)\s*$/im;

  let processed = raw;
  for (const pattern of ROBOTIC_LABEL_PATTERNS) {
    processed = processed.replace(pattern, '');
  }
  processed = processed.replace(ROBOTIC_STANDALONE_LINE, '').replace(/\n{3,}/g, '\n\n').trim();

  // ── Strip Nemotron bold-header-only lines ──────────────────────────────────
  // Nemotron wraps conversational text in bold section headers like
  // "**Kaam ki Baat Chalayein...**" or "**Office Hours (11am-8:30pm)**:".
  // Strip lines that are ENTIRELY a bold header. Inline bold like "**very**"
  // inside a sentence is preserved (this only matches whole-line headers).
  processed = processed.replace(/^\*\*[^*\n]{1,80}\*\*\s*:?\s*$/gim, '');

  // ── Strip option meta-text phrases ─────────────────────────────────────────
  // When Nemotron can't follow the <OPTIONS> tag format, it outputs the option
  // framework labels as prose. Remove those known labels.
  const OPTION_META_PHRASES = [
    /Awaiting Your Selection\.*/gi,
    /Default Response if No Option Selected[^.\n]*/gi,
    /\(for continuity\)/gi,
  ];
  for (const p of OPTION_META_PHRASES) {
    processed = processed.replace(p, '');
  }

  // ── Strip leaked internal tool blocks (e.g., ```json with subconscious_actions) ─
  // Genuine programming code blocks (python, js, sql, etc.) are preserved intact.
  processed = processed.replace(/```(?:json|thought|internal|action|subconscious_actions)?\s*\{[\s\S]*?"(?:subconscious_actions|action|tool)"[\s\S]*?\}(?:```|$)/gi, '');

  const lines = processed.split('\n');
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
    // Non-table lines: strip HTML tags and fix escaped pipes, preserving blockquotes (>) and mathematical inequalities
    return line
      .replace(/<br\s*\/?>\s*/gi, '\n')
      .replace(/<[a-zA-Z\/][^>]*>/g, '')
      .replace(/<[a-zA-Z\/][^>]*$/g, '')
      .replace(/\\\|/g, '|');
  });
  return cleaned.join('\n');
}

// userLocks removed in favor of background queue causal ordering
const backToBackTimers = new Map<string, NodeJS.Timeout>();

chatRouter.post(
  '/',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parseResult = ChatSchema.safeParse(req.body);
      if (!parseResult.success) {
        throw new ValidationError(parseResult.error.issues[0]?.message ?? 'Invalid request body');
      }

      const { message, messages, conversation_id, is_proactive, async_mode, reply_to_content, image_base64, language } = parseResult.data;
      let { reply_to_id, client_message_id } = parseResult.data;
      const userId = (req as any).user!.id;

      // Rule: Once a user drops a new message, Nova stops auto-checking previous replies
      if (!is_proactive) {
        watchtowerReflectionService.cancelPendingReflection(userId, conversation_id);
      }
      
      const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

      // ── NORMALIZATION ────────────────────────────────────────────────────────
      let normalizedMessages: ChatMessageInput[] = [];
      if (messages && messages.length > 0) {
        normalizedMessages = messages;
      } else if ((message && message.trim().length > 0) || image_base64) {
        normalizedMessages = [{
          message: message || '',
          client_message_id,
          reply_to_id,
          reply_to_content,
          image_base64
        }];
      } else {
        throw new ValidationError("Either 'message', 'messages', or an attached image must be provided");
      }

      for (const msg of normalizedMessages) {
        if (msg.reply_to_id && !UUID_REGEX.test(msg.reply_to_id)) {
          logger.warn('[Chat] Stripping malformed legacy reply_to_id', { reply_to_id: msg.reply_to_id, userId });
          msg.reply_to_id = undefined;
        }
        if (msg.client_message_id && !UUID_REGEX.test(msg.client_message_id)) {
          logger.warn('[Chat] Stripping malformed legacy client_message_id', { client_message_id: msg.client_message_id, userId });
          msg.client_message_id = undefined;
        }
      }

      // ── Ingress role normalization: deterministic boundary
      // Production clients send role-less user messages; normalize once here so
      // downstream analyzers (TurnAnalyzer) can enforce strict role='user' without
      // silently assuming missing role = user everywhere.
      for (const msg of normalizedMessages) {
        if (!msg.role) {
          (msg as any).role = 'user';
        } else if (!['user', 'assistant', 'system'].includes(msg.role)) {
          logger.warn('[Chat] Stripping unknown role at ingress', { role: msg.role, userId });
          (msg as any).role = 'user';
        }
      }

      // Legacy extraction for the primary message (used for logging and some logic)
      const primaryMessage = normalizedMessages[normalizedMessages.length - 1].message;
      client_message_id = normalizedMessages[normalizedMessages.length - 1].client_message_id;

      // Detect language preference dynamically
      const isExplicitEnglish = language === 'en';
      const isHindiMarker = /\b(kya|hai|ho|kar|raha|rahi|bhai|yaar|nahi|hain|mujhe|mera|teri|tere|thoda|accha|theek|suno|bolo|kaise|karo|batao|aaj|kal|parso)\b/i.test(primaryMessage);
      const isEnglishUser = isExplicitEnglish || (language !== 'hi' && !isHindiMarker && /[a-zA-Z]{3,}/.test(primaryMessage));
      const requestFallbackReply = getFallbackReply(isEnglishUser);

      const request_received_ms = Date.now();
      let context_started_ms: number | null = null;
      let context_ready_ms: number | null = null;
      let llm_started_ms: number | null = null;
      let first_token_ms: number | null = null;
      let llm_completed_ms: number | null = null;
      let response_sent_ms: number | null = null;
      
      const requestId = client_message_id || crypto.randomUUID();
      logger.info('[Chat] Request started', { requestId, userId, messageLength: primaryMessage.length, isAsync: async_mode, isProactive: is_proactive });

      // ── Amendment 2: Conversation ownership validation ──────────────────────
      // conversation_id belongs to exactly one user. If the client-supplied ID
      // already has rows for a different user, silently generate a fresh one.
      // If no rows exist yet, the current user claims it (safe — last-write-wins
      // on the first message insert with user_id acts as the claim).
      let activeConversationId = conversation_id || crypto.randomUUID();
      if (conversation_id) {
        try {
          const { data: ownerCheck } = await supabaseAdmin
            .from('chat_history')
            .select('user_id')
            .eq('conversation_id', conversation_id)
            .neq('user_id', userId)
            .limit(1)
            .maybeSingle();
          if (ownerCheck) {
            // Another user owns this conversation_id — do NOT cross streams
            const rescoped = crypto.randomUUID();
            logger.warn('[Chat][Amendment2] conversation_id belongs to another user — rescoping', {
              userId, requestedConversationId: conversation_id, newConversationId: rescoped
            });
            activeConversationId = rescoped;
          }
        } catch (ownerErr: any) {
          // Non-fatal — fall through with original ID; worst case is a harmless fresh conversation
          logger.warn('[Chat][Amendment2] Ownership check failed — proceeding with new conversation_id', {
            userId, error: ownerErr?.message
          });
          activeConversationId = crypto.randomUUID();
        }
      }

      const isStreaming = req.headers.accept === 'text/event-stream';
      if (isStreaming) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders();
        // Send immediate ACK comment to instantly resolve the client's POST promise and clear the "clock" icon
        res.write(`: connected\n\n`);
      }

      // releaseLock removed

      const isDegraded = dbHealthService.isDegraded();
      
      // ── Build effectiveMessage ─────────────
      let effectiveMessage = '';
      if (is_proactive) {
        effectiveMessage = '[SYSTEM: The user has not messaged in a while. Open a warm, short, casual conversation. Reference something from your recent memory if possible. Do NOT say you were checking in — just talk naturally like a friend who thought of them.]';
        normalizedMessages[normalizedMessages.length - 1].message = effectiveMessage;
      } else {
        const effectiveParts: string[] = [];
        for (const msg of normalizedMessages) {
          let text = msg.message || '';
          let visionNote = '';
          if (msg.reply_to_content) {
            text = `[Replying to: "${msg.reply_to_content}"]\n\n${text}`;
          }
          if (msg.image_base64) {
            const imageDesc = await visionService.describeSharedImage(msg.image_base64);
            if (imageDesc) {
              (msg as any).image_description = imageDesc;
              if (imageDesc.includes('vision analysis unavailable')) {
                visionNote = `[User just shared an image but vision analysis is unavailable. You MUST ask them what is in it — e.g., "Dikha na kya hai isme!" or "Kya bheja hai bhai?"]`;
              } else {
                visionNote = `[User attached an image showing: ${imageDesc}]`;
              }
            }
          }
          if (visionNote) {
            effectiveParts.push(text ? `${visionNote}\n\n${text}` : visionNote);
          } else {
            effectiveParts.push(text);
          }
        }
        effectiveMessage = effectiveParts.join('\n\n');
      }

      // ── Degraded Mode: serve from in-memory buffer ─────────────
      if (isDegraded) {
        logger.warn('Chat running in DEGRADED mode', { userId });
        degradedMode.appendMessage(userId, 'user', primaryMessage);
        const recentMessages = degradedMode.getRecentMessages(userId);

        let rawReply: string;
        if (isExcessiveRequest(primaryMessage)) {
          rawReply = "That's quite a large request. I can help with one section at a time. Please break it into smaller parts.";
        } else {
          try {
            rawReply = await complete('USER_FAST', [
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

        // Sanitize and validate degraded reply to prevent prompt leaks and hallucinated grounding
        let cleanDegradedReply = rawReply;
        if (isPromptLeak(cleanDegradedReply) || !cleanDegradedReply.trim()) {
          cleanDegradedReply = NOVA_EMPTY_REPLY;
        } else {
          cleanDegradedReply = sanitizeReply(cleanDegradedReply);
          cleanDegradedReply = validateAndRepairGrounding(cleanDegradedReply, primaryMessage, { recentMessages });
          if (isPromptLeak(cleanDegradedReply) || !cleanDegradedReply.trim()) {
            cleanDegradedReply = NOVA_EMPTY_REPLY;
          }
        }

        const messagesResponse = parseLLMResponse(sanitizeMarkdown(convertNovaTable(cleanDegradedReply)))
          .filter(msg => !isPromptLeak(msg));
        const reply = messagesResponse.join('\n\n') || NOVA_EMPTY_REPLY;

        const textChunks = (messagesResponse.length > 0 ? messagesResponse : [reply]).flatMap(m => chunkResponse(m));
        const totalChunks = textChunks.length;
        const chunks = textChunks.map((content, idx) => ({
          index: idx + 1,
          total: totalChunks,
          content
        }));

        degradedMode.appendMessage(userId, 'assistant', reply);

        // Queue DB writes for later drain
        degradedMode.enqueue({ table: 'chat_history', operation: 'insert', data: { user_id: userId, conversation_id: activeConversationId, role: 'user', content: primaryMessage, created_at: new Date().toISOString() } });
        degradedMode.enqueue({ table: 'chat_history', operation: 'insert', data: { user_id: userId, conversation_id: activeConversationId, role: 'assistant', content: reply, created_at: new Date().toISOString() } });

        if (isStreaming) {
          res.write(`data: ${JSON.stringify({ type: 'setup', conversation_id: activeConversationId })}\n\n`);
          res.write(`data: ${JSON.stringify({ type: 'chunk', content: reply })}\n\n`);
          res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
          res.end();
        } else {
          res.status(200).json({ reply, messages: (messagesResponse.length > 0 ? messagesResponse : [reply]), chunks, conversation_id: activeConversationId, meta: { degraded: true } });
        }
        return;
      }

      // 1. Save user message IMMEDIATELY so it's in the DB
      // We skip for proactive triggers (no phantom user message in history)
      const savedMessages: { id: string; client_message_id?: string; error: any }[] = [];
      if (is_proactive) {
        savedMessages.push({ id: 'proactive_' + Date.now(), error: null });
      } else {
        for (const msg of normalizedMessages) {
          const imageDesc = (msg as any).image_description;
          const cleanContent = msg.message || (imageDesc ? '📷 [Image]' : '');
          const metaPayload: Record<string, any> = {};
          if (imageDesc) {
            metaPayload.image_description = imageDesc;
          }
          const result = await qt.track('save_user_message', 'chat_history', () =>
            supabaseAdmin.from('chat_history')
              .insert({ 
                user_id: userId, 
                conversation_id: activeConversationId, 
                role: 'user', 
                content: cleanContent, 
                reply_to_id: msg.reply_to_id, 
                reply_to_content: msg.reply_to_content,
                ...(Object.keys(metaPayload).length > 0 ? { meta: metaPayload } : {}),
                ...(msg.client_message_id && UUID_REGEX.test(msg.client_message_id) ? { id: msg.client_message_id } : {})
              })
              .select('id').single()
          );
          savedMessages.push({
            id: result.data?.id || msg.client_message_id || 'msg_' + Date.now(),
            client_message_id: msg.client_message_id,
            error: result.error
          });
          
          if (result.error) {
            logger.error('[Chat] DB: Failed to save user message (continuing in memory)', { error: result.error, userId, is_proactive });
          }
        }
      }

      const userMessageId = savedMessages[savedMessages.length - 1].id;

      // ── P0-A: Canonical Turn ID ───────────────────────────────────────────────
      // One turn_id per user chat turn. All background jobs derived from this turn
      // must carry the same turn_id so they can be traced, ordered, and
      // correlated in logs even if they complete out of order.
      // Prefer the saved DB row id (which equals client_message_id when a valid UUID
      // was supplied) so the turn_id is stable and matches what the client sent.
      // Falls back to a fresh UUID if the save failed or the id is a synthetic key.
      const turnId: string = (
        userMessageId &&
        !userMessageId.startsWith('msg_') &&
        !userMessageId.startsWith('proactive_')
      ) ? userMessageId : crypto.randomUUID();

      logger.info('[Chat][P0-A] Turn ID assigned', { userId, turnId, userMessageId });

      // ── [PHASE 1 — PRODUCTION MODE] Semantic Processing Queue ────────────────
      let semanticJobId: string | null = null;
      let semanticJobSequence: number | null = null;
      let semanticClarificationQuestion: string | null = null; // Preserved for scope compatibility
      
      if (!is_proactive && primaryMessage.length > 1) {
        for (let idx = 0; idx < normalizedMessages.length; idx++) {
          const mItem = normalizedMessages[idx];
          if (!mItem.message || mItem.message.trim().length <= 1) continue;
          const msgDbId = savedMessages[idx]?.id || userMessageId;
          const precedingBurstContext = normalizedMessages
            .slice(0, idx)
            .map(m => m.message)
            .filter(Boolean)
            .join('\n');

          const { data: job, error: jobErr } = await supabaseAdmin.from('background_jobs').insert({
            job_type: 'process_semantic_turn',
            payload: {
              userId,
              turnId: normalizedMessages.length > 1 ? `${turnId}_${idx}` : turnId,
              userMessageId: msgDbId,
              primaryMessage: mItem.message,
              is_proactive,
              burstContext: precedingBurstContext || undefined,
            },
            status: 'pending',
            attempts: 0
          }).select('id, job_sequence').single();

          if (jobErr) {
            logger.error('[Chat] Failed to enqueue semantic job', { userId, turnId, error: jobErr.message });
          } else {
            semanticJobId = job.id;
            semanticJobSequence = job.job_sequence;
            logger.info('[Chat] Enqueued semantic turn job', { userId, turnId, jobId: semanticJobId, jobSequence: semanticJobSequence, msgIdx: idx });
          }
        }
      }

      // If the user signalled sleep/unavailability, write the DB lock IMMEDIATELY so
      // NACE + follow-up engines stay silent — don't wait for the reactive sleep-guard.
      // Otherwise cancel any pending follow-ups since the user replied.
      if (!is_proactive) {
        import('../services/NovaFollowupService').then(({ novaFollowupService, classifyUnavailability }) => {
          const unavailability = classifyUnavailability(primaryMessage);
          if (unavailability) {
            novaFollowupService.recordUnavailability(userId, unavailability.hours)
              .catch(e => logger.warn('Failed to write unavailability lock', { error: e }));
          } else {
            novaFollowupService.cancelFollowups(userId).catch(e => logger.warn('Failed to cancel follow-ups', { error: e }));
          }
        });

        // 1.5 Auto-update user presence since they just sent a message (they are online)
        supabaseAdmin.from('user_presence').upsert({
          user_id: userId,
          status: 'online',
          updated_at: new Date().toISOString()
        }).then(({ error }) => {
          if (error) logger.warn('Failed to update presence', { error });
        }, e => logger.warn('[Chat] presence upsert threw', { error: e }));

        // Reset silent_visit_count and user_busy_until on user message
        supabaseAdmin.from('working_memory').upsert([
          { user_id: userId, key: 'silent_visit_count', value: '0', updated_at: new Date().toISOString() },
          { user_id: userId, key: 'user_busy_until', value: '', updated_at: new Date().toISOString() }
        ], { onConflict: 'user_id, key' }).then(({ error }) => {
          if (error) logger.warn('[Chat] Failed to reset working memory', { error });
        });
      }

      // Real-time correction detection: If user replied to a specific Nova message,
      // check if it's a correction and auto-generate a behavioral patch.
      if (reply_to_content && !is_proactive) {
        import('../services/NovaRealtimeLearningService').then(({ novaRealtimeLearning }) => {
          novaRealtimeLearning.analyzeCorrection(userId, primaryMessage, reply_to_content)
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
        // In async_mode, 202 is returned to client immediately and processing continues in background
      }
      
      // NOTE: If the frontend does not poll for async results, switch to sync mode
      // by sending async_mode: false in the request body.
      
      // Async mode: hard deadline — if processing takes >90s, attempt a short-context retry.
      // Raw error messages are NOT saved to DB (they'd show broken UX). But when the LLM
      // fails entirely, FALLBACK_REPLY — a natural, voice-matched message — IS saved so the
      // user always gets a bubble and the frontend's typing state clears.
      const ASYNC_HARD_DEADLINE_MS = 90_000;
      let asyncDeadlineTimer: any = null;

      if (async_mode) {
        asyncDeadlineTimer = setTimeout(async () => {
          logger.warn('[ASYNC] Request exceeded 90s deadline. This is a log-only watchdog — a reply that completes despite the delay is still saved and pushed.', { userId });
        }, ASYNC_HARD_DEADLINE_MS);
      }


      // ── INLINE QUEUE DRAIN & DEBOUNCE ──────────────────────────────────────
      let semanticEvents: import('../types/semanticEvent').SemanticEvent[] = [];
      let deterministicReminderNote = '';
      let deterministicReminderCreated = false;

      // 1. Wait for the semantic job to complete for this user.
      if (!is_proactive && !async_mode) {
        let myJobCompleted = false;
        
        while (!myJobCompleted && semanticJobId) {
          const { data: jobCheck, error: checkErr } = await supabaseAdmin
            .from('background_jobs')
            .select('status, payload')
            .eq('id', semanticJobId)
            .single();

          if (checkErr) {
            logger.error('[Chat] Error checking background job status', { error: checkErr.message });
            break;
          }

          if (jobCheck && (jobCheck.status === 'completed' || jobCheck.status === 'failed')) {
            myJobCompleted = true;
            if (jobCheck.status === 'completed' && jobCheck.payload?.output) {
              const output = jobCheck.payload.output;
              semanticEvents = output.semanticEvents || [];
              deterministicReminderNote = output.reminderNote || '';
              deterministicReminderCreated = output.reminderCreated || false;
            }
            break;
          }
          
          await new Promise(r => setTimeout(r, 500));
        }
      }
      // Hoisted so the outer-catch emergency FALLBACK_REPLY save can also attach
      // the situation brief to meta (enabling presence/read-state even on failure).
      let situationBrief: string | null = null;

      try {

        // DEBOUNCE CHECK: Are there any NEWER user messages in this conversation?
        // Using job_sequence from background_jobs guarantees absolute chronological ordering, 
        // avoiding race conditions with identical timestamps during massive bursts.
        if (!is_proactive && semanticJobSequence !== null) {
          const { data: newerJob } = await supabaseAdmin
            .from('background_jobs')
            .select('id')
            .eq('job_type', 'process_semantic_turn')
            .eq('payload->>userId', userId)
            .gt('job_sequence', semanticJobSequence)
            .limit(1)
            .maybeSingle();

          if (newerJob && newerJob.id) {
            logger.info('[Chat] Debouncing LLM request — a newer user message exists', { userId, userMessageId, semanticJobSequence });
            if (isStreaming) {
              res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
              res.end();
            } else if (!async_mode) {
              res.status(200).json({ skipped: true, reason: 'debounced' });
            }
            if (asyncDeadlineTimer) {
              clearTimeout(asyncDeadlineTimer);
            }
            return; // Abort LLM generation, the newer message's request will handle it
          }
        }

        // ── BURST AGGREGATION: Collect any preceding unreplied user messages in this burst ──
        if (!is_proactive) {
          try {
            const { data: recentTurnMsgs } = await supabaseAdmin
              .from('chat_history')
              .select('id, role, content, created_at')
              .eq('conversation_id', activeConversationId)
              .eq('user_id', userId)
              .order('created_at', { ascending: false })
              .limit(15);

            if (recentTurnMsgs && recentTurnMsgs.length > 1) {
              const contiguousUserMsgs: typeof recentTurnMsgs = [];
              const nowMs = Date.now();
              for (const m of recentTurnMsgs) {
                if (m.role !== 'user') break;
                if (m.content.startsWith('[HIDDEN_CONTEXT]')) continue;
                const msgTime = new Date(m.created_at).getTime();
                if (nowMs - msgTime > 3 * 60 * 1000) break;
                contiguousUserMsgs.push(m);
              }

              if (contiguousUserMsgs.length > 1) {
                contiguousUserMsgs.reverse();
                const existingContents = new Set(normalizedMessages.map(nm => nm.message.trim()));
                const missingMsgs = contiguousUserMsgs.filter(cum => !existingContents.has(cum.content.trim()));

                if (missingMsgs.length > 0) {
                  const merged = [
                    ...missingMsgs.map(m => ({ message: m.content, role: 'user' as const })),
                    ...normalizedMessages,
                  ];
                  normalizedMessages = merged;
                  effectiveMessage = normalizedMessages.map(m => m.message).join('\n\n');
                  logger.info('[Chat] Burst detected: aggregated preceding unreplied messages into turn', {
                    userId,
                    burstCount: normalizedMessages.length,
                    aggregatedPreview: effectiveMessage.substring(0, 150),
                  });
                }
              }
            }
          } catch (burstErr) {
            logger.warn('[Chat] Failed to aggregate preceding burst messages', { error: burstErr });
          }
        }
      
      // ── UNIFIED PARALLEL FETCH (Phase 1 Latency Optimization) ──
      // Clean effectiveMessage of prompt decorations so memory keyword search targets actual user message
      const cleanMsgForKeywords = effectiveMessage
        .replace(/\[User attached an image showing:[\s\S]*?\]/gi, '')
        .replace(/\[Replying to:[\s\S]*?\]/gi, '')
        .replace(/\[SYSTEM:[\s\S]*?\]/gi, '')
        .trim();
      const keywords = extractKeywords(cleanMsgForKeywords || effectiveMessage);
      const profileCacheKey = `profile:${userId}`;
      const wmCacheKey = `working_memory:${userId}`;
      const cachedProfile = cache.get<{ preferred_name: string; companion_personality: string; country?: string; push_token?: string; current_visual_context?: string; timezone_offset?: number }>(profileCacheKey);
      const cachedWm = cache.get<{ key: string; value: string }[]>(wmCacheKey);
      const skipMemoryEnv = process.env.DISABLE_MEMORY === 'true';
      const memoryEnabledForChat = await memoryPolicyService.isMemoryEnabled(userId).catch(() => true);
      const skipMemory = skipMemoryEnv || !memoryEnabledForChat;
      const today = new Date().toISOString().split('T')[0];

      const dbStartTime = Date.now();
      context_started_ms = dbStartTime;

      // ── Phase 10: CognitiveContextService — Unified Cognitive Context Fabric ──
      // Assembles provenance-aware, conflict-resolved, bounded context in parallel.
      // Runs alongside the existing fetches; never blocks the critical path.
      const cogCtxPromise = cognitiveContextService.assembleContext(userId, {
        message: effectiveMessage,
        messages: normalizedMessages.map(m => ({ message: m.message, reply_to_content: m.reply_to_content, role: (m as any).role })),
        conversationId: activeConversationId,
        isProactive: is_proactive,
        skipMemory,
      }).catch(err => {
        logger.warn('[Chat][Phase10] CognitiveContext assembly failed — continuing with legacy context', {
          userId, error: err instanceof Error ? err.message : String(err)
        });
        return null;
      });

      const profilePromise = (cachedProfile && cachedProfile.push_token)
        ? Promise.resolve({ data: cachedProfile, error: null })
        : qt.track('get_profile', 'profiles', () => supabaseAdmin.from('profiles').select('preferred_name, companion_personality, country, push_token, current_visual_context, timezone_offset, grammatical_gender').eq('id', userId).maybeSingle());

      const historyPromise = qt.track('get_chat_history', 'chat_history', () => supabaseAdmin.from('chat_history').select('role, content, reply_to_content').eq('user_id', userId).eq('conversation_id', activeConversationId).order('created_at', { ascending: false }).limit(100));

      const crossSessionPromise = qt.track('get_cross_session_context', 'chat_history', () => supabaseAdmin.from('chat_history').select('role, content').eq('user_id', userId).neq('conversation_id', activeConversationId).order('created_at', { ascending: false }).limit(6)).then(res => res).catch(() => ({ data: null, error: null }));

      const wmPromise = cachedWm
        ? Promise.resolve({ data: cachedWm.map(w => ({ key: w.key, value: w.value })), error: null })
        : skipMemory
        ? Promise.resolve({ data: [], error: null })
        : qt.track('get_working_memory', 'working_memory', () => supabaseAdmin.from('working_memory').select('key, value').eq('user_id', userId).gt('expires_at', new Date().toISOString()).limit(10));

      const memoriesPromise = skipMemory ? Promise.resolve([]) : memoryRepository.searchMemories(userId, keywords).catch(() => []);

      const stmPromise = skipMemory
        ? Promise.resolve({ data: [], error: null })
        : qt.track('get_short_term_memories', 'short_term_memories', () => supabaseAdmin.from('short_term_memories').select('memory, emotion, importance, mention_count, expires_at, confidence, created_at').eq('user_id', userId).gte('confidence', 0.6).or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`).order('importance', { ascending: false }).order('last_mentioned_at', { ascending: false }).limit(20));

      const searchPromise = import('../services/WebSearchService')
        .then(({ webSearchService }) => webSearchService.evaluateSearchNeed(effectiveMessage)
          .then(need => need ? webSearchService.executeSearch(need) : null))
        .catch(e => { logger.warn('[Chat] Web search failed', { error: e }); return null; });

      const sessionPromise = qt.track('get_session', 'conversation_sessions', () => supabaseAdmin.from('conversation_sessions').select('id, message_count').eq('user_id', userId).eq('session_date', today).maybeSingle())
        .then(({ data: session }) => {
          if (session) supabaseAdmin.from('conversation_sessions').update({ message_count: (session.message_count || 0) + 1, updated_at: new Date().toISOString() }).eq('id', session.id).then(res => res);
          else supabaseAdmin.from('conversation_sessions').insert({ user_id: userId, session_date: today, message_count: 1 }).then(res => res);
        }).then(res => res).catch(() => null);

      const emotionPromise = qt.track('get_latest_emotion', 'emotional_states', () => supabaseAdmin.from('emotional_states').select('mood, intensity, notes').eq('user_id', userId).order('created_at', { ascending: false }).limit(1).maybeSingle()).then(res => res).catch(() => ({ data: null }));
      const episodicPromise = qt.track('get_recent_episodes', 'episodic_memories', () => supabaseAdmin.from('episodic_memories').select('summary, emotion, created_at').eq('user_id', userId).order('created_at', { ascending: false }).limit(5)).then(res => res).catch(() => ({ data: [] }));
      const reflectionPromise = qt.track('get_latest_reflection', 'reflections', () => supabaseAdmin.from('reflections').select('summary, key_takeaways').eq('user_id', userId).order('created_at', { ascending: false }).limit(1).maybeSingle()).then(res => res).catch(() => ({ data: null }));
      const lastMsgPromise = qt.track('get_last_msg_time', 'chat_history', () => supabaseAdmin.from('chat_history').select('created_at').eq('user_id', userId).order('created_at', { ascending: false }).limit(1).maybeSingle()).then(res => res).catch(() => ({ data: null }));
      const presencePromise = qt.track('get_user_presence', 'user_presence', () => supabaseAdmin.from('user_presence').select('status, last_active_at, last_typing_at').eq('user_id', userId).maybeSingle()).then(res => res).catch(() => ({ data: null }));
      const unreadPromise = qt.track('get_unread_nova', 'chat_history', () => supabaseAdmin.from('chat_history').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('role', 'assistant').eq('is_read', false)).then(res => res).catch(() => ({ count: 0 }));
      const totalMemoriesPromise = qt.track('get_total_memories_count', 'memories', () => supabaseAdmin.from('memories').select('id', { count: 'exact', head: true }).eq('user_id', userId)).then(res => res).catch(() => ({ count: 0 }));

      const remindersPromise = reminderService.getUpcomingReminders(userId).catch(err => {
        logger.warn('[SituationalAwareness] Reminders fetch failed', { error: err instanceof Error ? err.message : String(err) }); return [];
      });
      const behaviorPatternPromise = presencePatternService.getBehaviorPattern(userId).catch(err => {
        logger.warn('[SituationalAwareness] Behavior pattern fetch failed', { error: err instanceof Error ? err.message : String(err) }); return { pattern: 'UNKNOWN', description: '' };
      });
      const lifeThreadsPromise = qt.track('get_life_threads', 'life_threads', () => supabaseAdmin.from('life_threads').select('id, topic, state, priority, provenance, last_relevant_at').eq('user_id', userId).in('state', ['active', 'waiting', 'blocked']).order('last_relevant_at', { ascending: false }).limit(5)).then(res => res).catch(() => ({ data: [] }));

      const TEMPORAL_KEYWORDS = [
        'yesterday', 'days ago', 'last week', 'last month', 'do you remember',
        'what time', 'what day', 'when did', 'earlier today', 'this morning', 
        'last night', 'tell me what', 'you said', 'i said', 'we talked',
        'kal', 'parso', 'yaad hai', 'yaad karo', 'kab', 'kitne baje', 
        'time kya tha', 'exact time', 'pehle', 'abhi', 'aaj subah',
        'raat ko', 'dopahar', 'shaam ko', 'maine kaha tha', 'tune kaha tha',
        'bataya tha', 'bola tha', 'likha tha'
      ];
      const isReminderIntent = reminderIntentDetector.hasReminderIntent(effectiveMessage);
      const isTemporalQuery = !isReminderIntent && TEMPORAL_KEYWORDS.some(kw => effectiveMessage.toLowerCase().includes(kw));
      const temporalPromise = isTemporalQuery
        ? qt.track('get_temporal_context', 'chat_history', () => supabaseAdmin.from('chat_history').select('role, content, created_at').eq('user_id', userId).gte('created_at', new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString()).order('created_at', { ascending: false }).limit(80)).then(res => res).catch(() => ({ data: [] }))
        : Promise.resolve({ data: [] });

      const upcomingRemindersFullPromise = supabaseAdmin.from('reminders').select('*').eq('user_id', userId).eq('status', 'active').or(`trigger_at.is.null,trigger_at.gte.${new Date().toISOString()}`).order('trigger_at', { ascending: true }).limit(10).then(res => res, _err => ({ data: [] }));

      // Fire-and-forget session counter bump in the background
      sessionPromise.catch(err => logger.error('[Chat] Session bump failed', { error: err }));

      // Parallel context fetch across DB connection pool
      const [
        profileResult, historyResult, crossSessionResult, wmResult, memoriesResult, stmResult, searchData,
        lastMsgResult, presenceResult, unreadResult, upcomingReminders, lifeThreadsResult,
        emotionResult, episodicResult, reflectionResult, behaviorPatternResult,
        temporalResult, upcomingDbResult, totalMemoriesResult
      ] = await Promise.all([
        profilePromise, historyPromise, crossSessionPromise, wmPromise, memoriesPromise, stmPromise, searchPromise,
        lastMsgPromise, presencePromise, unreadPromise, remindersPromise, lifeThreadsPromise,
        emotionPromise, episodicPromise, reflectionPromise, behaviorPatternPromise,
        temporalPromise, upcomingRemindersFullPromise, totalMemoriesPromise
      ]);

      const dbDuration = Date.now() - dbStartTime;
      context_ready_ms = Date.now();
      logger.info('[Chat] Parallel context fetch completed', { userId, durationMs: dbDuration });

      if (searchData) {
        effectiveMessage = `${searchData}\n\nUser's question: ${effectiveMessage}`;
        logger.info('[Chat] Web Search prepended to effectiveMessage');
      }

      // ── Unpack results ─────────────────────────────────────────────────────────
      let profile = profileResult.data as any;
      if (profile && !cachedProfile) cache.set(profileCacheKey, profile, CACHE_TTL.PROFILE_MS, CACHE_NS.PROFILE);

      const FALLBACK_PREFIXES = [ 'Yaar, kuch technical issue', 'Yaar, thoda technical glitch', 'kuch technical issue aa gaya', '[SYSTEM]', 'Thodi der mein phir try karo', 'reminder set nahi kar sakta', 'reminder system thoda busy', 'Nova ka reminder system', 'Sorry yaar, reminder', 'system busy hai', 'set nahi kar sakta' ];
      const isFallback = (content: string) => FALLBACK_PREFIXES.some(p => content.includes(p));

      let recentMessages = ((historyResult.data || []) as any[])
        .filter(msg => msg.role !== 'assistant' || !isFallback(msg.content))
        .reverse()
        .map(msg => ({ role: msg.role as 'user'|'assistant'|'system', content: msg.reply_to_content ? `[Replying to: "${msg.reply_to_content}"]\n${msg.content}` : msg.content }));

      let recentCrossSessionContext = '';
      if (crossSessionResult.data && (crossSessionResult.data as any[]).length > 0) {
        recentCrossSessionContext = (crossSessionResult.data as any[]).filter(m => !isFallback(m.content)).reverse().map(m => `${m.role === 'assistant' ? 'Nova' : 'User'}: ${m.content.substring(0, 200)}${m.content.length > 200 ? '...' : ''}`).join('\n');
      }

      let workingMemories: { key: string; value: string }[] = [];
      if (!skipMemory) {
        if (cachedWm) workingMemories = cachedWm;
        else if (wmResult.data) {
          workingMemories = (wmResult.data as any[]).map(wm => ({ key: wm.key, value: wm.value }));
          cache.set(wmCacheKey, workingMemories, CACHE_TTL.WORKING_MEMORY_MS, CACHE_NS.WORKING_MEMORY);
        }
      }

      const memories: any[] = Array.isArray(memoriesResult) ? memoriesResult : [];

      let shortTermMemories: any[] = [];
      if (!skipMemory) {
        const allFetched = (stmResult.data as any[]) || [];
        let stmTokens = 0;
        for (const m of allFetched) {
          const memStr = `${m.memory} ${m.emotion || ''}`;
          const tokens = Math.ceil(memStr.length / 4);
          if (stmTokens + tokens > 600) break;
          shortTermMemories.push({ memory: m.memory, emotion: m.emotion, importance: m.importance, timestamp: m.created_at ? timeAgo(m.created_at) : null });
          stmTokens += tokens;
        }
      }

      const userCountry = profile?.country || 'IN';
      const TIMEZONE_OFFSETS: Record<string, number> = { IN: 5.5, US: -5, UK: 0, AU: 10, AE: 4, SA: 3, PK: 5, BD: 6, SG: 8, JP: 9, DE: 1, FR: 1, CA: -5, NZ: 12, ZA: 2, NG: 1, KE: 3, BR: -3 };
      const tzOffset = TIMEZONE_OFFSETS[userCountry] ?? 5.5;
      const tzMs = tzOffset * 3600 * 1000;
      const nowLocal = new Date(Date.now() + tzMs);
      const DAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
      const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
      const dayIdx = nowLocal.getUTCDay();
      const dateStr = `${MONTH_NAMES[nowLocal.getUTCMonth()]} ${nowLocal.getUTCDate()}, ${nowLocal.getUTCFullYear()}`;
      const hh = nowLocal.getUTCHours(), mm = nowLocal.getUTCMinutes();
      const timeStr = `${hh % 12 || 12}:${mm.toString().padStart(2,'0')} ${hh >= 12 ? 'PM' : 'AM'}`;
      const tzLabel = tzOffset === 5.5 ? 'IST' : `UTC${tzOffset >= 0 ? '+' : ''}${tzOffset}`;
      
      const FRIDAY_SAT_WEEKEND = ['AE', 'SA', 'QA', 'BH', 'KW', 'OM', 'AF', 'IR'];
      let isWeekend = FRIDAY_SAT_WEEKEND.includes(userCountry) ? dayIdx === 5 || dayIdx === 6 : dayIdx === 0 || dayIdx === 6;

      let scheduleOverrideNote: string | undefined;
      if (workingMemories.length > 0) {
        const todayName = DAY_NAMES[dayIdx].toLowerCase();
        for (const wm of workingMemories) {
          const val = wm.value.toLowerCase();
          if (val.includes(todayName) && (val.includes('working') || val.includes('work day') || val.includes('office'))) { isWeekend = false; break; }
          if ((val.includes('weekoff') || val.includes('week off') || val.includes('day off')) && val.includes(todayName)) { isWeekend = true; break; }
          if ((val.includes('weekoff') || val.includes('week off') || val.includes('day off'))) {
            const DAYS_LC = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
            const weekoffDay = DAYS_LC.find(d => val.includes(d));
            if (weekoffDay && weekoffDay !== todayName) { isWeekend = false; break; }
          }
        }
        const calendarIsWeekend = FRIDAY_SAT_WEEKEND.includes(userCountry) ? dayIdx === 5 || dayIdx === 6 : dayIdx === 0 || dayIdx === 6;
        if (calendarIsWeekend !== isWeekend) {
          scheduleOverrideNote = !isWeekend ? `⚠️ SCHEDULE OVERRIDE: The calendar says today (${DAY_NAMES[dayIdx]}) is a weekend, BUT the user's actual work schedule says they are WORKING today. Treat today as a NORMAL WORKING DAY.` : `⚠️ SCHEDULE OVERRIDE: The user's memory says today (${DAY_NAMES[dayIdx]}) is their WEEKOFF / day off. Treat today as a rest day.`;
        }
      }

      let gapMinutes: number | null = null;
      if (lastMsgResult.data?.created_at) gapMinutes = (Date.now() - new Date(lastMsgResult.data.created_at).getTime()) / 60000;

      if (gapMinutes !== null) {
        if (gapMinutes > 1440) {
          activeConversationId = crypto.randomUUID();
          if (!is_proactive && userMessageId && !userMessageId.startsWith('msg_')) supabaseAdmin.from('chat_history').update({ conversation_id: activeConversationId }).eq('id', userMessageId).then(res => res);
          recentMessages = recentMessages.length > 0 && recentMessages[recentMessages.length - 1].role === 'user' ? [recentMessages[recentMessages.length - 1]] : [];
        } else if (gapMinutes > 360) {
          recentMessages = recentMessages.slice(-3);
        }
      }

      const userPresence = presenceResult.data ? { status: presenceResult.data.status || 'offline', last_active_at: presenceResult.data.last_active_at, last_typing_at: presenceResult.data.last_typing_at } : null;

      let lifeStageSummary: string | undefined;
      let blueprintDiscoveryNote: string | undefined;
      try {
        const stageCtx = await userLifeStageEngine.getUserLifeStageContext(userId, memories, workingMemories);
        lifeStageSummary = `${stageCtx.stageLabel}: ${stageCtx.corePurposeSummary} (Lifestyle Rhythm: ${stageCtx.lifestyleRhythm.phaseDescription})`;

        const blueprintSummary = lifeBlueprintCuriosityEngine.evaluateMissingBlueprintGaps(
          memories,
          workingMemories,
          { localHour: nowLocal.getUTCHours(), isWeekend }
        );
        const guideline = lifeBlueprintCuriosityEngine.formatDiscoveryPromptGuideline(blueprintSummary);
        if (guideline) {
          blueprintDiscoveryNote = guideline;
        }
      } catch (err) {
        // Non-critical
      }

      const situationCtx = {
        nowLocal, tzLabel, country: userCountry, gapMinutes,
        latestEmotion: emotionResult.data, recentEpisodes: episodicResult.data || [],
        latestReflection: reflectionResult.data, isWeekend, scheduleOverrideNote, dayName: DAY_NAMES[dayIdx],
        dateStr, timeStr, lastUserMessage: effectiveMessage, upcomingReminders,
        currentVisualContext: profile?.current_visual_context, userPresence,
        unreadNovaMessages: unreadResult.count || 0, behaviorPattern: behaviorPatternResult.pattern !== 'UNKNOWN' ? `${behaviorPatternResult.pattern} (${behaviorPatternResult.description})` : null,
        totalMemoriesCount: totalMemoriesResult.count || 0,
        goalMemories: memories.filter((m: any) => m.memory_type === 'goals'),
        activeLifeThreads: lifeThreadsResult.data || [],
        lifeStageSummary,
        blueprintDiscoveryNote,
      };
      situationBrief = situationalAwareness.buildBrief(situationCtx);

      let temporalContextBlock = '';
      if (temporalResult.data && temporalResult.data.length > 0) {
        const lines = temporalResult.data.reverse().map((m: any) => {
          const d = new Date(new Date(m.created_at).getTime() + tzMs);
          const tStr = `${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getUTCDay()]}, ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getUTCMonth()]} ${d.getUTCDate()} · ${d.getUTCHours().toString().padStart(2,'0')}:${d.getUTCMinutes().toString().padStart(2,'0')} ${tzLabel}`;
          return `[${tStr}] ${m.role === 'assistant' ? 'Nova' : 'You'}: ${m.content.substring(0, 300)}${m.content.length > 300 ? '...' : ''}`;
        });
        temporalContextBlock = '\n\n## WHAT WAS SAID RECENTLY (Exact Archive — last 30 days)\n' + lines.join('\n') + '\n\nCRITICAL TEMPORAL RULE: The user is asking about a past conversation or timestamp. Find the answer in the archive above and tell them the exact time or context. Do NOT bring up unrelated facts from your long-term memory.';
      }

      let remindersContext = '';
      if (upcomingDbResult.data && upcomingDbResult.data.length > 0) {
        remindersContext = '\n\n## ACTIVE REMINDERS (SOURCE OF TRUTH)\nThe user currently has these reminders active:\n' + upcomingDbResult.data.map((r: any) => {
          const when = r.trigger_at ? (() => { const d = new Date(new Date(r.trigger_at).getTime() + tzMs); return `at ${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getUTCDay()]}, ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getUTCMonth()]} ${d.getUTCDate()} · ${d.getUTCHours().toString().padStart(2,'0')}:${d.getUTCMinutes().toString().padStart(2,'0')} ${tzLabel}`; })() : `on event "${r.event_trigger || 'unknown event'}"`;
          return `- [ID: "${r.id}"] ${r.text || r.title} ${when}${r.recurrence_interval ? ` (repeats every ${r.recurrence_interval} ${r.recurrence_type || 'time(s)'})` : ''}${r.active_days?.length ? ` [only on: ${r.active_days.join(', ')}]` : ''}${r.active_months?.length ? ` [only in: ${r.active_months.join(', ')}${r.active_year ? ' ' + r.active_year : ''}]` : ''}${r.urgency && r.urgency !== 'medium' ? ` [${r.urgency} urgency]` : ''}${r.purpose ? ` — ${r.purpose}` : ''}${r.is_auto ? ' [auto-detected]' : ''}`;
        }).join('\n') + '\n\nCRITICAL ANTI-HALLUCINATION RULE: This list is the absolute source of truth. If past chat history says a reminder was cancelled but it appears here, it is STILL ACTIVE. Do not contradict this list. Do NOT invent or guess about reminders not in this list. If the user asks about a reminder, rely strictly on these IDs and descriptions.';
      } else {
        remindersContext = '\n\n## ACTIVE REMINDERS (SOURCE OF TRUTH)\n[EMPTY LIST] The user currently has NO active reminders.\nCRITICAL ANTI-HALLUCINATION RULE: If the user asks for their reminders, you MUST tell them they have no active reminders. NEVER invent or hallucinate reminders. Do NOT guess from past conversation. If this list is empty, they have NO reminders.';
      }

      const memoryContext = '';
      const responseConfig = classifyIntent(effectiveMessage, recentMessages.map(m => m.content));

      // ── Phase 10: Resolve cogCtx (if ready) and use unified turn analysis ──
      const cogCtx = await cogCtxPromise;
      if (cogCtx) {
        logger.info('[Chat][Phase10] CognitiveContext assembled', {
          userId,
          durableFacts: cogCtx.memories.durableFacts.length,
          conflicts: cogCtx.metadata.conflicts_detected,
          conflictsResolved: cogCtx.metadata.conflicts_resolved,
          degradedSources: cogCtx.metadata.degraded_sources,
          assemblyMs: cogCtx.metadata.assembly_duration_ms,
        });
      }

      // Use CognitiveContext's unified turn analysis (avoids duplicate TurnAnalyzer.analyze call).
      // Falls back to a fresh analysis if CognitiveContext assembly failed.
      const turnAnalysis = cogCtx?.turn?.turnAnalysis ?? TurnAnalyzer.analyze(normalizedMessages, { recentMessages, memories });
      let turnAnalysisBlock = TurnAnalyzer.buildTurnAnalysisPrompt(turnAnalysis);

      // Smart Reminder Engine: Check if user discussed any future-dated plan, habit, or activity
      const isFuturePlanIntent = !is_proactive && reminderIntentDetector.hasFuturePlanIntent(effectiveMessage);
      if (isFuturePlanIntent) {
        const planDetails = reminderIntentDetector.extractFuturePlanDetails(effectiveMessage, tzOffset);
        if (!planDetails.isAmbiguous && planDetails.formattedTime) {
          const futurePlanDirective = `\n\n## ⏰ SMART PROACTIVE REMINDER DIRECTIVE (TOP PRIORITY)\nThe user shared a specific future plan/routine: "${planDetails.title}" scheduled for ${planDetails.formattedTime}${planDetails.isRecurring ? ' (recurring daily)' : ''}.\nCRITICAL: DO NOT give a passive, 1-word reply like "Sahi", "Theek hai", or "Ok"!\nYou MUST warmly encourage this plan and proactively ask if you should set a reminder or alarm for it (e.g., "Mast plan hai yaar! Roz subah 8:00 AM ka reminder set kar doon tere liye, taaki miss na ho?").`;
          turnAnalysisBlock = (turnAnalysisBlock ? `${turnAnalysisBlock}\n` : '') + futurePlanDirective;
        } else {
          const futurePlanDirective = `\n\n## ⏰ SMART PROACTIVE REMINDER DIRECTIVE (TOP PRIORITY)\nThe user mentioned starting a future plan, habit, or routine ("${effectiveMessage}").\nCRITICAL: DO NOT give a passive, 1-word reply like "Sahi", "Theek hai", or "Ok"!\nYou MUST acknowledge their decision warmly and proactively ask if they want you to set a reminder, asking what time, how often (every day or specific days), and for what period they want to be reminded.`;
          turnAnalysisBlock = (turnAnalysisBlock ? `${turnAnalysisBlock}\n` : '') + futurePlanDirective;
        }
      }

      // User Mistake Callout & Misunderstanding Reconciliation Directive
      const isUserCallingOutMistake = /\b(i didn't understood|didn't understand|are u idiot|are you an idiot|pagal ho kya|kuch bhi mat bolo|ye galat hai|aisa nahi hai|maine kab bola|kya bol rahi ho|kya bol rahe ho|galat bol rahi ho|galat kaha)\b/i.test(effectiveMessage);
      if (turnAnalysis.hasCorrections || isUserCallingOutMistake) {
        const correctionDirective = `\n\n## 🛠️ USER MISTAKE CALLOUT & RECONCILIATION DIRECTIVE (TOP PRIORITY)\nThe user is pointing out a mistake, misunderstanding, or incorrect assertion made by Nova in the previous reply.\n1. Humbly and warmly acknowledge the misunderstanding like a true best friend ("Arre sorry yaar! Mera dhyan kahan tha...", "Arre meri galti!").\n2. State the user's confirmed facts accurately without arguing, making defensive excuses, or inventing new details.\n3. Smoothly move forward in continuity.\n4. Keep it concise (1-2 WhatsApp sentences).`;
        turnAnalysisBlock = (turnAnalysisBlock ? `${turnAnalysisBlock}\n` : '') + correctionDirective;
      }

      // ── Phase 11: Deterministic state execution moved to SemanticTurnAgent ──
      // 1. Proactive Offer Affirmation Guard: Check if user affirmed an immediate previous reminder offer
      const lastAssistantMsg = ((historyResult.data || []) as any[])
        .find(m => m.role === 'assistant')?.content || '';

      if (!is_proactive && lastAssistantMsg && reminderIntentDetector.hasReminderOffer(lastAssistantMsg) && reminderIntentDetector.isAffirmation(effectiveMessage)) {
        try {
          const affirmedReminder = await reminderIntentDetector.checkAndScheduleAffirmation(userId, effectiveMessage, lastAssistantMsg, tzOffset);
          if (affirmedReminder.scheduled) {
            deterministicReminderCreated = true;
            deterministicReminderNote = affirmedReminder.note || '';
            logger.info('[Chat] Affirmed proactive reminder scheduled', {
              userId,
              task: affirmedReminder.task,
              formattedTime: affirmedReminder.formattedTime
            });
          }
        } catch (affErr: any) {
          logger.warn('[Chat] Affirmed reminder detection error', { error: affErr?.message });
        }
      }
      // 2. Direct high-precision reminder extraction & scheduling guard
      else if (!is_proactive && reminderIntentDetector.hasReminderIntent(effectiveMessage)) {
        try {
          const directReminder = await reminderIntentDetector.detectAndSchedule(userId, effectiveMessage, userCountry);
          if (directReminder.detected) {
            if (directReminder.scheduled) {
              deterministicReminderCreated = true;
              deterministicReminderNote = directReminder.note || '';
            } else if (directReminder.note && !deterministicReminderNote) {
              deterministicReminderNote = directReminder.note;
            }
            logger.info('[Chat] Direct reminder result', {
              userId,
              scheduled: directReminder.scheduled,
              task: directReminder.task,
              formattedTime: directReminder.formattedTime
            });
          }
        } catch (rErr: any) {
          logger.warn('[Chat] Direct reminder detection non-fatal error', { error: rErr?.message });
        }
      }

      // 3. Accountability Completion Signal: Check if user completed a recent pending/reminded task
      const isCompletionSignal = /\b(?:ho\s*gaya|kar\s*diya|kar\s*liya|done|completed|finished|pani\s*pee\s*liya|workout\s*ho\s*gaya|gym\s*ho\s*gaya|bill\s*pay\s*kar\s*diya|dawai\s*le\s*li|dawa\s*kha\s*li)\b/i.test(effectiveMessage);
      if (isCompletionSignal) {
        try {
          const fourHoursAgo = new Date(Date.now() - 4 * 3600 * 1000).toISOString();
          const { data: recentPending } = await supabaseAdmin
            .from('reminders')
            .select('*')
            .eq('user_id', userId)
            .in('accountability_status', ['reminded', 'pending'])
            .gte('trigger_at', fourHoursAgo)
            .order('trigger_at', { ascending: false })
            .limit(1);

          if (recentPending && recentPending.length > 0) {
            const rem = recentPending[0];
            await supabaseAdmin.from('reminders').update({
              accountability_status: 'completed_confirmed',
              completed_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            }).eq('id', rem.id);

            const accountabilityDirective = `\n\n## 🏆 ACCOUNTABILITY CELEBRATION (TOP PRIORITY)\nThe user just confirmed they completed their reminder task: "${rem.text}"!\nPraise them warmly with authentic enthusiasm ("Proud of you yaar!", "Super consistency!"), celebrate their streak, and keep them feeling energized!`;
            turnAnalysisBlock = (turnAnalysisBlock ? `${turnAnalysisBlock}\n` : '') + accountabilityDirective;
            logger.info('[Chat] Reminder completed confirmed by user', { reminderId: rem.id, task: rem.text });
          }
        } catch (cErr: any) {
          logger.warn('[Chat] Accountability confirmation error', { error: cErr?.message });
        }
      }

      // ── Phase 2B: Cognitive Doubt Subsystem ──────────────────────────────────
      // 1. Detect knowledge gaps (e.g. family count gap)
      try {
        await cognitiveDoubtService.detectFamilyKnowledgeGap(userId, effectiveMessage, turnId);
      } catch (gapErr: any) {
        logger.debug('[Chat] detectFamilyKnowledgeGap non-fatal error', { error: gapErr?.message });
      }

      // 2. Resolution matching on incoming turn
      try {
        const resolution = await cognitiveDoubtService.checkResolutionOnUserTurn(userId, turnId, effectiveMessage);
        if (resolution.matched) {
          logger.info('[Chat] Cognitive doubt resolved by user turn', {
            doubtId: resolution.doubtId,
            category: resolution.category,
            reason: resolution.reason,
          });
        }
      } catch (resErr: any) {
        logger.debug('[Chat] Doubt resolution check non-fatal error', { error: resErr?.message });
      }

      // 3. Doubt Eligibility & Context Injection (Max 1 doubt per turn)
      let effectiveSituationBrief = situationBrief;
      try {
        const doubtDecision = await doubtEligibilityEngine.evaluateEligibility({
          userId,
          turnId,
          currentMessageText: effectiveMessage,
          isDistressed: situationBrief?.toLowerCase().includes('distress') || situationBrief?.toLowerCase().includes('stressed'),
          isCloseEnded: effectiveMessage.trim().length <= 5 && ['ok', 'haan', 'theek', 'k', 'yes', 'no'].includes(effectiveMessage.toLowerCase().trim()),
        });

        if (doubtDecision.eligible && doubtDecision.supervisoryDirective) {
          effectiveSituationBrief = (effectiveSituationBrief ? `${effectiveSituationBrief}\n\n` : '') + doubtDecision.supervisoryDirective;
          if (doubtDecision.doubt) {
            cognitiveDoubtService.markPresented(doubtDecision.doubt.id).catch(() => {});
          }
        }
      } catch (eligErr: any) {
        logger.debug('[Chat] Doubt eligibility non-fatal error', { error: eligErr?.message });
      }

      const brainContext = {
        memories,
        workingMemories,
        profile,
        shortTermMemories,
        recentCrossSessionContext,
        situationBrief: effectiveSituationBrief,
        temporalContextBlock,
        remindersContext,
        recentMessages,
        memoryContext,
        turnAnalysisBlock,
        hasCorrections: turnAnalysis.hasCorrections || isUserCallingOutMistake,
        // BUG-06: Forward negated correction concepts so NovaBrainService can pass them
        // to the extract_life_threads job → LifeThreadAgent.updateThreadProvenanceForCorrection()
        negativeCorrectionConcepts: turnAnalysis.negativeCorrectionConcepts || [],
        // Phase 10: canonical GoalCorrectedEvents replace raw TurnAnalyzer negation regex
        // LifeThreadAgent uses these for deterministic goal suppression
        goalCorrectedEvents: semanticEvents.filter((e: any) => e.family === 'GoalCorrected'),
        deterministicReminderCreated,
        deterministicReminderNote,
        lengthInstruction: isFuturePlanIntent
          ? "The user shared a future plan or habit. Acknowledge it warmly and proactively offer to set a smart reminder, asking for or confirming the time and recurrence. Do NOT give a passive 1-word reply like 'Sahi'."
          : normalizedMessages.length > 1
          ? "The user sent multiple messages in a burst. Address and acknowledge ALL their points warmly and naturally in a cohesive reply without skipping any detail."
          : primaryMessage.length < 20
          ? "KEEP IT VERY SHORT. 1-2 sentences max. User sent a tiny message."
          : "Match the user's depth, but still use short conversational messages.",
        userCountry: profile?.country || 'IN',
        conversationId: activeConversationId,
        requestId: requestId,
        userMessageId: userMessageId,
        messageId: userMessageId,
        // P0-A: canonical turn identity — propagated to all background jobs
        turnId,
        // P0-B: question clause texts — forwarded to memory extraction jobs
        questionClauses: turnAnalysis.questionClauses || [],
        language: language || 'auto',
        todayDayName: DAY_NAMES[dayIdx],
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
      } else if (semanticClarificationQuestion) {
        // Semantic clarification short-circuit
        rawReply = semanticClarificationQuestion;
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
          llm_started_ms = Date.now();
          logger.info('[Chat] Calling LLM', { userId });
          
          if (isStreaming) {
            res.write(`data: ${JSON.stringify({ type: 'setup', conversation_id: activeConversationId })}\n\n`);
            
            const { novaBrain } = await import('../services/NovaBrainService');
            const stream = novaBrain.streamInteraction(userId, normalizedMessages, brainContext);
            const iterator = stream[Symbol.asyncIterator]();
            
            const STREAM_CHUNK_TIMEOUT_MS = 60_000; // 60s — allows for slow TTFT on 49B Nemotron

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
                // A slow/hung stream is NOT a hard failure: retry the same request once
                // via the non-streaming path so the user gets a real reply instead of
                // FALLBACK_REPLY. Persisting the fallback on any stream hiccup is what
                // produced the 2026-08-14 test-chat failures (3 fallbacks in one
                // session, plus a 3-min dead chat). FALLBACK_REPLY is now reserved for
                // when the retry ALSO fails.
                logger.warn('[Chat] LLM stream interrupted — retrying non-streaming', {
                  userId, reason: err.message === 'STREAM_TIMEOUT' ? 'STREAM_TIMEOUT' : (err.message || err)
                });
                let retrySucceeded = false;
                try {
                  const retryTimeoutMs = 25_000;
                  let retryTimer: NodeJS.Timeout | null = null;
                  const retryTimeoutPromise = new Promise<never>((_, rejectRetry) => {
                    retryTimer = setTimeout(() => rejectRetry(new Error('RETRY_TIMEOUT')), retryTimeoutMs);
                  });
                  try {
                    const retryResult = await Promise.race([
                      novaBrain.processInteraction(userId, normalizedMessages, brainContext),
                      retryTimeoutPromise,
                    ]);
                    if (retryResult.reply && !isPromptLeak(retryResult.reply)) {
                      retrySucceeded = true;
                      rawReply = retryResult.reply;
                      res.write(`data: ${JSON.stringify({ type: 'chunk', content: rawReply })}\n\n`);
                      if (typeof (res as any).flush === 'function') (res as any).flush();
                      if (retryResult.subconscious_actions?.length) {
                        extractedActions = retryResult.subconscious_actions;
                        const { backgroundActions } = await import('../services/BackgroundActionService');
                        backgroundActions.processActions(userId, activeConversationId, retryResult.subconscious_actions, userCountry).catch((e: any) => {
                          logger.error('[BackgroundAction] Unhandled failure', { error: e });
                        });
                      }
                    }
                  } finally {
                    if (retryTimer) clearTimeout(retryTimer);
                  }
                } catch (retryErr: any) {
                  logger.error('[Chat] Non-streaming retry failed after stream interruption', {
                    userId, error: retryErr instanceof Error ? retryErr.message : String(retryErr)
                  });
                }

                if (retrySucceeded) break; // stream effectively done; drop to the normal save path

                // Both the stream AND the retry failed — now, and only now, save the
                // in-voice fallback so the user always gets a bubble (never a dead chat).
                await persistAssistantMessage(userId, activeConversationId, FALLBACK_REPLY, is_proactive ? undefined : userMessageId, {
                  asyncMode: async_mode,
                  source: 'streaming_retry_failed',
                });
                res.write(`data: ${JSON.stringify({ type: 'error', error: FALLBACK_REPLY })}\n\n`);
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
                if (!first_token_ms) first_token_ms = Date.now();
                rawReply += value;
                res.write(`data: ${JSON.stringify({ type: 'chunk', content: value })}\n\n`);
                if (typeof (res as any).flush === 'function') (res as any).flush();
              }
            }
          } else {
            const { novaBrain } = await import('../services/NovaBrainService');
            
            const LLM_TIMEOUT_MS = 55_000; // 55s — must match NVIDIA client timeout (49B model needs 20-40s)

            const llmPromise = novaBrain.processInteraction(userId, normalizedMessages, brainContext);
            let llmTimeoutId: NodeJS.Timeout | null = null;
            const timeoutPromise = new Promise<never>((_, reject) => {
              llmTimeoutId = setTimeout(() => reject(new Error('LLM_TIMEOUT')), LLM_TIMEOUT_MS);
            });

            let result: { reply: string; subconscious_actions: any[] };
            try {
              result = await Promise.race([llmPromise, timeoutPromise]);
            } catch (llmErr: any) {
              if (llmErr.message === 'LLM_TIMEOUT') {
                logger.error('[Chat] LLM call timed out, attempting fast 8B retry', { userId, messageLength: effectiveMessage.length });

                // FAST RETRY: Use the 8B extraction model with a minimal prompt
                try {
                  const { complete } = await import('../lib/nvidia');
                  const recentSnippet = Array.isArray(brainContext?.recentMessages)
                    ? brainContext.recentMessages.slice(-2).map((m: any) => `${m.role === 'user' ? 'User' : 'Nova'}: ${m.content}`).join('\n')
                    : '';
                  const fastRetryPrompt = isEnglishUser
                    ? `You are Nova, a female virtual best friend texting on WhatsApp.
Reply in 1-2 SHORT, natural English sentences. Max 1 emoji.
Output ONLY conversational text. NEVER output rule names, labels, guidelines, instructions, or bullet points.
Plain conversational text only.`
                    : `You are Nova, a female virtual best friend texting on WhatsApp.
Reply in 1-2 SHORT, natural Hinglish sentences. Max 1 emoji.
Output ONLY conversational text. NEVER output rule names, labels, guidelines, instructions, or bullet points.
Nova is female: use "Main samajh gayi", "Main batati hoon".
Use casual "tu/tum", never formal "Aap". Plain conversational text only.`;

                  const fastRetryMessages = [
                    {
                      role: 'system' as const,
                      content: fastRetryPrompt
                    },
                    ...(recentSnippet ? [{ role: 'user' as const, content: `Recent Context:\n${recentSnippet}\n\nUser: ${primaryMessage}` }] : [{ role: 'user' as const, content: primaryMessage }])
                  ];
                  const fastReply = await complete('TIMEOUT_FALLBACK', fastRetryMessages, {
                    maxTokens: 256,
                    temperature: 0.65
                  });
                  if (fastReply && fastReply.trim().length > 0 && !isPromptLeak(fastReply)) {
                    logger.info('[Chat] Fast 8B retry succeeded', { userId });
                    // Sanitize and validate grounding
                    const sanitizedFastReply = validateAndRepairGrounding(sanitizeReply(fastReply.trim()), primaryMessage, brainContext);
                    result = { reply: sanitizedFastReply || NOVA_EMPTY_REPLY, subconscious_actions: [] };
                  } else {
                    result = { reply: requestFallbackReply, subconscious_actions: [] };
                  }
                } catch (retryErr) {
                  logger.error('[Chat] Fast 8B retry also failed', { userId, error: retryErr instanceof Error ? retryErr.message : String(retryErr) });
                  result = { reply: requestFallbackReply, subconscious_actions: [] };
                }
              } else {
                throw llmErr;
              }
            } finally {
              if (llmTimeoutId) clearTimeout(llmTimeoutId);
            }

            rawReply = result.reply;
            if (isPromptLeak(rawReply) || rawReply === NOVA_EMPTY_REPLY) {
              logger.warn('[Chat] Prompt instruction leak detected in rawReply, triggering secondary fast worker retry', { rawReply });
              try {
                const { complete: nvidiaComplete } = await import('../lib/nvidia');
                const promptLeakRetryPrompt = isEnglishUser
                  ? `You are Nova, a female best friend texting on WhatsApp in natural English.
Reply in 1-2 SHORT sentences. Output ONLY spoken conversational dialogue.
NO lists, NO formatting, NO prompt rules, NO internal labels. Plain text only.`
                  : `You are Nova, a female best friend texting on WhatsApp in natural Hinglish.
Reply in 1-2 SHORT sentences. Output ONLY spoken conversational dialogue.
NO lists, NO formatting, NO prompt rules, NO internal labels.
Nova is female: use "Main samajh gayi", "Mast hai yaar". Plain text only.`;

                const fastRetryMessages = [
                  {
                    role: 'system' as const,
                    content: promptLeakRetryPrompt
                  },
                  { role: 'user' as const, content: primaryMessage }
                ];
                const fastReply = await nvidiaComplete('TIMEOUT_FALLBACK', fastRetryMessages, {
                  maxTokens: 256,
                  temperature: 0.65
                });
                if (fastReply && !isPromptLeak(fastReply)) {
                  rawReply = validateAndRepairGrounding(sanitizeReply(fastReply), primaryMessage, brainContext);
                } else {
                  rawReply = requestFallbackReply;
                }
              } catch (e: any) {
                logger.error('[Chat] Fast retry on prompt leak failed', { error: e.message });
                rawReply = requestFallbackReply;
              }
            }
            if (result.subconscious_actions && result.subconscious_actions.length > 0) {
              extractedActions = result.subconscious_actions;
            }
          }
          
          const llmDuration = Date.now() - llm_started_ms!;
          logger.info('[Chat] LLM response received', { userId, durationMs: llmDuration });
          if (llmDuration > 5000) {
            logger.warn('[Chat] LLM call slow', { userId, durationMs: llmDuration });
          }


          // Auto-append table offer as follow-up bubble in LONG_CONTEXT mode
          if (responseConfig.shouldOfferTable && !rawReply.includes('<NOVA_TABLE>')) {
            const extraText = isEnglishUser
              ? '\n<NOVA_MESSAGE_BREAK>\nWant to see this in a table format? It might be clearer.'
              : '\n<NOVA_MESSAGE_BREAK>\nTable format mein dekhna chahega? Zyada clear hoga.';
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
            // Persist the fallback (the raw errStr shown live must NOT be stored — it would
            // render as a broken bubble in history). The user message stays orphaned otherwise.
            await persistAssistantMessage(userId, activeConversationId, requestFallbackReply, is_proactive ? undefined : userMessageId, {
              asyncMode: async_mode,
              source: 'nvidia_error_streaming',
            });
            res.write(`data: ${JSON.stringify({ type: 'error', error: requestFallbackReply })}\n\n`);
            if (typeof (res as any).flush === 'function') (res as any).flush();
            res.end();
            return;
          } else if (async_mode) {
            if (isContentPolicy) {
              rawReply = isEnglishUser
                ? "Well, I can't really talk much about that topic 😂 Let's chat about something else?"
                : 'Acha, is topic par main jyada bol nahi sakti yaar 😂 kuch aur baat karte hain?';
            } else {
              rawReply = requestFallbackReply;
            }
            logger.warn('[ASYNC] Saved fallback reply due to LLM failure', { userId, isContentPolicy });
          } else {
            throw new ExternalServiceError('NVIDIA', errStr);
          }
        } finally {
          llm_completed_ms = Date.now();
        }
      }

      // Coverage Check and Fast Repair (only if remaining request budget permits)
      let coverage_repair_invoked = false;
      const uncoveredUnits = TurnAnalyzer.getUncoveredUnits(turnAnalysis, rawReply);
      const elapsedBudget = Date.now() - request_received_ms;
      if (uncoveredUnits.length > 0 && rawReply !== FALLBACK_REPLY && rawReply !== FALLBACK_REPLY_EN && elapsedBudget < 4000) {
        logger.warn('[Chat] Uncovered required units detected, injecting repair bubble', { uncoveredUnits });
        try {
          const { complete } = await import('../lib/nvidia');
          const missedPoints = uncoveredUnits.map(u => u.text).join(' | ');
          const repairContent = isEnglishUser
            ? 'You are Nova, a casual best friend. Your previous message forgot to address these points: "' + missedPoints + '". Write a 1-2 sentence quick follow-up to casually cover it. Start with "Oh and also," or similar. NO lists, NO emojis.'
            : 'You are Nova, a casual Hinglish friend. Your previous message forgot to address these points: "' + missedPoints + '". Write a 1-2 sentence quick follow-up to casually cover it. Start with "Oh aur haan," or similar. NO lists, NO emojis.';
          const fastRepair = await complete('TIMEOUT_FALLBACK', [
             { role: 'system', content: repairContent },
             { role: 'user', content: 'You missed answering/acknowledging this. Add a quick follow up.' }
          ], { maxTokens: 100, temperature: 0.7 });
          
          if (fastRepair && fastRepair.trim().length > 0) {
             coverage_repair_invoked = true;
             logger.info('[Chat] Metric coverage_repair_invoked', { userId, uncoveredUnitsCount: uncoveredUnits.length });
             const repairBubble = '\n<NOVA_MESSAGE_BREAK>\n' + fastRepair.trim();
             rawReply += repairBubble;
             if (isStreaming) {
                res.write(`data: ${JSON.stringify({ type: 'chunk', content: repairBubble })}\n\n`);
                if (typeof (res as any).flush === 'function') (res as any).flush();
             }
          }
        } catch (repairErr) {
          logger.error('[Chat] Fast repair failed', { error: repairErr instanceof Error ? repairErr.message : String(repairErr) });
        }
      }

      if (isStreaming) {
        res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
        res.end();
      }

      let optionsArray: string[] | undefined;
      const optionsMatch = rawReply.match(/<OPTIONS>([\s\S]*?)<\/OPTIONS>/i);
      if (optionsMatch) {
        const rawOptionsContent = optionsMatch[1].trim();
        try {
          // 1. Try standard JSON parse
          const parsed = JSON.parse(rawOptionsContent);
          if (Array.isArray(parsed) && parsed.length > 0) {
            optionsArray = parsed.map((item: any) => String(item).trim()).filter(Boolean).slice(0, 4);
          }
        } catch (e) {
          // 2. Resilient fallback: parse single-quoted or unquoted items
          try {
            const normalizedJson = rawOptionsContent
              .replace(/'/g, '"')
              .replace(/,\s*]/, ']');
            const parsed = JSON.parse(normalizedJson);
            if (Array.isArray(parsed) && parsed.length > 0) {
              optionsArray = parsed.map((item: any) => String(item).trim()).filter(Boolean).slice(0, 4);
            }
          } catch {
            // 3. Regex match any quoted strings
            const matches = Array.from(rawOptionsContent.matchAll(/["']([^"']+)["']/g))
              .map(m => m[1].trim())
              .filter(Boolean);
            if (matches.length > 0) {
              optionsArray = matches.slice(0, 4);
            }
          }
          logger.warn('Lenient parse applied for OPTIONS JSON', { rawOptions: rawOptionsContent, recoveredCount: optionsArray?.length });
        }
      }

      // CRITICAL BUG FIX: ALWAYS strip <OPTIONS> tags (even malformed/dangling tags) from rawReply
      // so raw XML tags never leak into the visible chat bubble on mobile!
      rawReply = rawReply
        .replace(/<OPTIONS>[\s\S]*?<\/OPTIONS>/gi, '')
        .replace(/<\/?OPTIONS>/gi, '')
        .trim();

      // If no options were emitted by model or parse yielded empty, synthesize contextual quick replies
      if (!optionsArray || optionsArray.length === 0) {
        const synthesized = synthesizeContextualOptions({
          message: primaryMessage,
          replyText: rawReply,
          language: language || 'auto',
          mode: responseConfig?.mode,
        });
        if (synthesized.length > 0) {
          optionsArray = synthesized;
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

      let parsedMessages = parseLLMResponse(sanitizeMarkdown(convertNovaTable(rawReply)))
        .filter(msg => !isPromptLeak(msg));
      
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
      
      // Split each parsed message further if it's too long and apply strict pre-delivery sanitization
      let finalBubbles = messagesWithEmoji
        .map(m => validateAndRepairGrounding(sanitizeReply(m), primaryMessage, brainContext))
        .flatMap(m => chunkResponse(m))
        .map(b => sanitizeReply(b))
        .filter(b => b.trim().length > 0 && !isPromptLeak(b));
      
      // If no valid bubbles were generated (e.g. LLM returned blank), safely abort.
      // Streaming: the 'done' event was already flushed above — writing again after
      // res.end() would throw. Non-streaming: send an empty 200 so the client never
      if (finalBubbles.length === 0) {
        logger.info('[Chat] LLM returned a blank reply or leaks were stripped. Forcing friendly fallback bubble.', { userId });
        finalBubbles = [requestFallbackReply];
      }
      const reply = finalBubbles.join('\n\n');

      // ── TOCTOU re-check: a NEWER real user message may have arrived while this (25-60s)
      // LLM call was in flight. The debounce above only guards the moment of lock acquisition;
      // if B lands after join(point) while A is still generating, saving A's reply now would
      // give the user a stale double-reply. Re-check and drop A if a newer user row exists.
      if (async_mode && !is_proactive) {
        const { data: newerUserMsg } = await supabaseAdmin
          .from('chat_history')
          .select('id')
          .eq('user_id', userId)
          .eq('conversation_id', activeConversationId)
          .eq('role', 'user')
          .not('content', 'like', '[HIDDEN_CONTEXT]%')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (newerUserMsg && newerUserMsg.id && newerUserMsg.id !== userMessageId) {
          logger.warn('[Chat] Superseded reply dropped — a newer user message arrived during the LLM call', { userId, userMessageId, supersededBy: newerUserMsg.id });
          if (asyncDeadlineTimer) {
            clearTimeout(asyncDeadlineTimer);
          }
          return;
        }
      }

      // 7. Save AI response ONCE (with telemetry meta)
      // Check for duplicates due to race conditions
      const isDuplicate = await isDuplicateAssistantMessage(userId, activeConversationId, reply, 5);
      
      const REJECT_PREFIXES = [
        'Yaar, kuch technical issue',
        'Yaar, thoda technical glitch',
        'kuch technical issue aa gaya',
        'Yaar, thoda slow chal raha hai server',
        'Thodi der mein phir try karo'
        // NOTE: FALLBACK_REPLY ('Hmm... mujhe thoda sochne de...') must NOT be in this list
        // so it gets saved to chat_history and shown in the app when the provider times out.
      ];
      const isFallbackReply = REJECT_PREFIXES.some(p => rawReply.includes(p));

      // Only save to DB if it's NOT a fallback/error message, UNLESS we are in async_mode where we MUST guarantee a reply
      if (!isDuplicate && (!isFallbackReply || async_mode)) {
        // Fetch push token fresh for the loop
        const pushTokenResult = await supabaseAdmin
          .from('profiles')
          .select('push_token')
          .eq('id', userId)
          .maybeSingle();
        const pushToken = pushTokenResult.data?.push_token as string | undefined;

        // Prepare thoughts array
        const thoughts: any[] = [];
        if (situationBrief) {
          // Parse situationBrief into human-readable thoughts
          const emotionMatch = situationBrief.match(/Last known mood:\s*(\w+)/);
          const patternMatch = situationBrief.match(/BEHAVIOR PATTERN:\s*([A-Z_]+)/);
          const timeMatch = situationBrief.match(/Right now:\s*([^\n]+)/);

          if (emotionMatch) {
            thoughts.push({
              engine: '🧠 Emotional Intelligence',
              type: 'context',
              detail: `Sensing ${emotionMatch[1].toLowerCase()} vibes from you right now`
            });
          }
          if (patternMatch) {
            const pattern = patternMatch[1];
            const patternLabels: Record<string, string> = {
              'ACTIVE_CHATTING': '💬 You\'re actively chatting — keeping up the energy!',
              'IDLE': '😴 You\'ve been quiet for a while — might check in soon',
              'RETURNING': '👋 Welcome back! Catching up on what I missed',
              'EMOTIONAL': '💛 Something emotional is going on — being extra thoughtful'
            };
            thoughts.push({
              engine: '👁️ Awareness',
              type: 'context',
              detail: patternLabels[pattern] || `Current vibe: ${pattern}`
            });
          }
          if (timeMatch) {
            thoughts.push({
              engine: '⏰ Time Awareness',
              type: 'context',
              detail: `It's ${timeMatch[1]} — adjusting my tone accordingly`
            });
          }
        }
        
        // Push accessed working memories if any
        if (workingMemories && workingMemories.length > 0) {
          workingMemories.forEach(wm => {
            const safeKey = wm.key || 'context';
            const cleanKey = String(safeKey).replace(/_/g, ' ').toLowerCase();
            thoughts.push({
              engine: 'MemoryCore',
              type: 'memory_link',
              detail: `Recalled that your ${cleanKey} is: ${wm.value || ''}`
            });
          });
        }
        
        // Push accessed long term memories if any
        if (memories && memories.length > 0) {
          memories.slice(0, 3).forEach(m => {
            thoughts.push({
              engine: 'MemoryCore',
              type: 'memory_link',
              detail: `Remembered: ${m.memory}`
            });
          });
        }

        if (extractedActions && extractedActions.length > 0) {
          extractedActions.forEach((action: any) => {
            let detail = `Executed action: ${action.tool}`;
            if (action.tool === 'MemoryRepository' && action.action === 'save') {
              detail = `Saved to short-term memory: ${action.data?.key || ''} = ${action.data?.value || ''}`;
            } else if (action.tool === 'MomentEngine' && action.action === 'extract') {
              detail = `Noted an emotional moment: ${action.data?.moment || ''} (${action.data?.emotion || ''})`;
            } else if (action.tool === 'LifeEventExtractor' && action.action === 'event') {
              detail = `Logged upcoming event: ${action.data?.description || ''}`;
            } else if (action.tool === 'LifeEventExtractor' && action.action === 'routine') {
              detail = `Noted routine/habit: ${action.data?.description || ''}`;
            } else if (action.tool === 'AgendaManager' && action.action === 'update_status') {
              detail = `Updated task status: ${action.data?.task_description || ''} is ${action.data?.status || ''}`;
            } else if (action.tool === 'AgendaManager' && action.action === 'add') {
              detail = `Added implicitly mentioned task: ${action.data?.task_description || ''}`;
            } else if (action.tool === 'NovaFollowupService' && action.action === 'queue') {
              detail = `Queued a future check-in: "${action.data?.question || ''}" for ${action.data?.delay_hours || ''} hrs later`;
            } else if (action.tool === 'MemoryEngine') {
              if (action.action === 'save_short_term') detail = `Saved to short-term memory: ${action.data?.summary || 'User context'}`;
              else if (action.action === 'save_long_term') detail = `Committed to long-term memory: ${action.data?.memory || 'Core detail'}`;
              else if (action.action === 'delete_memory') detail = `Removed outdated memory to keep context fresh.`;
              else if (action.action === 'search_memory') detail = `Searched memories for connections regarding: ${action.data?.query || 'context'}`;
            } else if (action.tool === 'ReminderEngine') {
              detail = `Scheduled reminder for ${action.data?.trigger_time || 'later'}: ${action.data?.title || action.data?.purpose || 'Follow-up'}`;
            }
            thoughts.push({
              engine: action.tool || 'NovaBrain',
              type: 'action',
              detail,
              data: action.data || {}
            });
          });
        }
        thoughts.push({
          engine: '🎭 Personality',
          type: 'style',
          detail: 'Speaking naturally — like a real friend, not a robot'
        });

        // Create separate DB rows for each bubble
        for (let idx = 0; idx < finalBubbles.length; idx++) {
          const msgText = finalBubbles[idx];
          // Proactive triggers have no real user message — never reference the fake
          // 'proactive_<ts>' id (it is not a uuid and the reply_to_id column is uuid),
          // which otherwise makes every insert fail and fall into the emergency path.
          const replyTargetId = is_proactive ? null : userMessageId;

          const rowData = {
            user_id: userId,
            conversation_id: activeConversationId,
            role: 'assistant',
            content: msgText,
            reply_to_id: idx === 0 ? replyTargetId : null,
            reply_to_content: null,
            // P0-C: causal attribution — this is a direct conversational reply
            source_type: 'conversational',
            meta: idx === finalBubbles.length - 1 ? {
              situationBrief: situationBrief || null,
              subconsciousActions: extractedActions,
              options: optionsArray,
              hasThoughts: thoughts.length > 0,
              coverage_repair_invoked
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
            const emergencyResult = await saveAssistantMessage(userId, activeConversationId, msgText, 'EmergencyFallback').then(() => ({ error: null })).catch((e: any) => ({ error: e }));
              
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
            
            // If this is the last bubble (where meta is attached), save thoughts asynchronously (never block reply)
            if (idx === finalBubbles.length - 1 && thoughts.length > 0) {
              Promise.resolve(
                supabaseAdmin.from('nova_thoughts').insert({
                  chat_message_id: savedMsg.id,
                  user_id: userId,
                  thoughts: thoughts
                })
              ).then(({ error }: any) => {
                if (error) {
                  logger.error('[Chat] FAILED to save thoughts to nova_thoughts', {
                    requestId,
                    userId,
                    messageId: savedMsg.id,
                    error: error.message
                  });
                }
              }).catch((err: any) => {
                logger.error('[Chat] nova_thoughts insert threw', { error: err });
              });
            }

            // Send push notification asynchronously (never block reply)
            if (pushToken) {
              sendNovaReplyNotification(pushToken, msgText, activeConversationId, savedMsg.id)
                .catch(err => logger.warn('[Push] sendNovaReplyNotification failed', { error: err?.message }));
            }

            // Watchtower Post-Reply Reflection & Self-Correction (only on latest assistant reply)
            if (idx === finalBubbles.length - 1 && !is_proactive) {
              watchtowerReflectionService.scheduleReflection({
                userId,
                conversationId: activeConversationId,
                messageId: savedMsg.id,
                content: msgText,
                userMessage: primaryMessage,
              });
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
      degradedMode.appendMessage(userId, 'user', primaryMessage);
      degradedMode.appendMessage(userId, 'assistant', reply);

      // 9. Background extraction — skipped when DISABLE_MEMORY=true or MEMORY_ENABLED=false
      // OPTIMIZED: All 7 memory types are extracted in ONE LLM call via ConsolidatedMemoryAgent.
      // This reduces per-message LLM load from ~7 calls to ~2 (1 main + 1 consolidated extraction).
      if (process.env.DISABLE_MEMORY !== 'true' && memoryEnabledForChat) {
        const isFiller = primaryMessage.length < 10 && !shouldExtractShortTermMemory(primaryMessage);

        if (!isFiller) {
          // P0-A + P0-B: include turnId (traceability) and questionClauses (admission guard)
          const recentContext = recentMessages
            .filter((m: any) => m?.role === 'user' && typeof m.content === 'string')
            .slice(-4)
            .map((m: any) => m.content)
            .join('\n');
          const payload = {
            userId,
            messageId: userMessageId,
            message: (effectiveMessage && effectiveMessage.trim().length > primaryMessage.length) ? effectiveMessage : primaryMessage,
            turnId,                           // P0-A
            questionClauses: brainContext.questionClauses,  // P0-B
            hasExplicitRemember: turnAnalysis.hasExplicitRemember,
            hasCorrections: turnAnalysis.hasCorrections,
            recentContext,
            // Phase 10: canonical SemanticEvent[] — consumers must use these instead of
            // re-interpreting the raw message for authoritative durable state
            semanticEvents: semanticEvents.length > 0 ? semanticEvents : undefined,
          };
          memoryQueue.add('extract_all_memories', payload).catch(err => {
            logger.error('Failed to enqueue consolidated memory extraction job', { error: err instanceof Error ? err.message : String(err) });
          });
        } else {
          logger.info('Memory Extraction Skipped:', { reason: 'Ultra-short filler message' });
        }

        cache.invalidate(wmCacheKey);
      } else {
        logger.info('[DEBUG] DISABLE_MEMORY=true — skipping background extraction jobs');
      }

      // Push notifications are now sent per-bubble directly after DB insert

      const totalDuration = Date.now() - request_received_ms;
      logger.info('[Chat] Request completed', { requestId, userId, durationMs: totalDuration });
      if (totalDuration > 10000) {
        logger.warn('[Chat] Total request slow', { userId, totalDurationMs: totalDuration });
      }
      
      // If user is actively chatting, schedule a targeted NACE pulse 60s from now
      // to handle back-to-back proactive messaging without spamming the global cron
      if (!is_proactive) {
        if (backToBackTimers.has(userId)) clearTimeout(backToBackTimers.get(userId));
        backToBackTimers.set(userId, setTimeout(() => {
          import('../services/NovaConsciousnessEngine').then(({ novaConsciousnessEngine }) => {
            novaConsciousnessEngine.pulse().catch(e => logger.error('[NACE] Back-to-back pulse failed', { error: e }));
          }).catch(() => {});
        }, 60000));
      }

      // Phase 2A: Asynchronous Read-Only Post-Turn Guardian Observation (Non-blocking)
      setImmediate(() => {
        import('../services/DeterministicGuardianService').then(({ deterministicGuardian }) => {
          deterministicGuardian.runPostTurnScan(userId, turnId, userMessageId).catch(gErr => {
            logger.debug('[Chat] Guardian post-turn observation non-fatal error', { error: gErr?.message });
          });
        }).catch(() => {});

        // Section 12, 13, 14, 31: Adaptive Watchtower & Semantic Self-Audit Loop
        import('../services/EntityResolutionService').then(({ entityResolutionService }) => {
          const resolvedTurn = entityResolutionService.resolveTurn(primaryMessage);
          import('../services/AdaptiveRiskScorer').then(({ adaptiveRiskScorer }) => {
            const riskAssessment = adaptiveRiskScorer.evaluate(
              primaryMessage,
              resolvedTurn.facts.map(f => ({ key: f.canonicalKey, value: f.value })),
              {
                hasCorrections: turnAnalysis.hasCorrections,
                activeEntitiesCount: resolvedTurn.entities.length,
              }
            );

            if (riskAssessment.tier !== 'LOW') {
              import('../services/SemanticVerificationService').then(({ semanticVerificationService }) => {
                semanticVerificationService.verifyTurn({
                  userId,
                  userMessage: primaryMessage,
                  generatedResponse: reply,
                  sourceMessageId: userMessageId,
                  candidateFacts: resolvedTurn.facts,
                  currentMemories: (memories || []).map((m: any) => ({ key: m?.key || '', value: m?.value || '' })),
                }).catch((err: any) => {
                  logger.warn('[Chat] Semantic verification loop non-fatal error', { error: err?.message });
                });
              }).catch(() => {});
            }
          }).catch(() => {});
        }).catch(() => {});

        // Dedicated Autonomous Memory Tree & Knowledge Graph Continuous Curator
        import('../services/AutonomousMemoryGraphCuratorService').then(({ autonomousMemoryGraphCurator }) => {
          autonomousMemoryGraphCurator.curateUserMemoryGraph(userId).catch(cErr => {
            logger.debug('[Chat] Autonomous memory curator non-fatal error', { error: cErr?.message });
          });
        }).catch(() => {});
      });

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
            options: optionsArray || [],
          }
        });
      }

      response_sent_ms = Date.now();
      const ttft_ms = first_token_ms && llm_started_ms ? first_token_ms - llm_started_ms : null;
      const generation_latency_ms = llm_completed_ms && first_token_ms ? llm_completed_ms - first_token_ms : null;
      const total_server_latency_ms = response_sent_ms - request_received_ms;

      logger.info('[Latency] Request completed', {
        requestId,
        userId,
        ttft_ms,
        generation_latency_ms,
        total_server_latency_ms,
        context_fetch_ms: context_ready_ms && context_started_ms ? context_ready_ms - context_started_ms : null,
      });
    } catch (err) {
      // In async_mode: 202 was already sent. If we reach here, the user message
      // is in the DB but Nova never replied. Save a fallback reply so the user
      // always gets SOMETHING and the chat never stays stuck.
      const isAsync = req.body?.async_mode === true;
      const errFallback = (typeof requestFallbackReply !== 'undefined' && requestFallbackReply) ? requestFallbackReply : FALLBACK_REPLY;
      if (isAsync) {
        logger.error('[ASYNC] Unexpected crash during processing — saving fallback reply', {
          error: err instanceof Error ? err.message : String(err),
          userId: (req as any).user?.id,
        });
        try {
          const userId = (req as any).user?.id;
          // Use the request's active conversation id (a valid UUID). Do NOT fall back
          // to req.body.conversation_id here — the client may omit it, and inserting
          // '' into the uuid column makes the fallback insert fail silently, so the
          // user never gets their "glitch" recovery message.
          if (userId) {
            await persistAssistantMessage(userId, activeConversationId, errFallback, undefined, {
              asyncMode: true,
              source: 'async_catch_block',
            });
            // Try to push a notification so user knows to check
            const ptResult = await supabaseAdmin.from('profiles').select('push_token').eq('id', userId).maybeSingle();
            if (ptResult.data?.push_token) {
              sendNovaReplyNotification(ptResult.data.push_token, errFallback).catch(() => {});
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
            res.write(`data: ${JSON.stringify({ type: 'error', error: errFallback })}\n\n`);
            res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
            res.end();
          } catch (e) {}
        } else {
          throw err; // throw to the outer catch
        }
      }
    } finally {
      // Always disarm the deadline watchdog on this path (covers the async error catch and
      // any other unguarded return) so a stale timer can't fire a misleading log 90s later.
      if (asyncDeadlineTimer) {
        clearTimeout(asyncDeadlineTimer);
      }
      // locks removed
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
        .select('id, role, content, created_at, conversation_id, user_id, meta, user_reaction, reply_to_id, reply_to_content')
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

// ── GET Thoughts (Lazy Load) ──────────────────────────────────────────────────
chatRouter.get(
  '/:messageId/thoughts',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = (req as any).user!.id;
      const { messageId } = req.params;

      // Ensure messageId is a valid UUID to prevent Postgres errors on temporary IDs
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(messageId)) {
        res.status(200).json({ thoughts: [] });
        return;
      }

      const { data, error } = await supabaseAdmin
        .from('nova_thoughts')
        .select('thoughts')
        .eq('chat_message_id', messageId)
        .eq('user_id', userId)
        .maybeSingle();

      if (error) {
        throw new Error(`Failed to fetch thoughts: ${error.message}`);
      }

      res.status(200).json({ thoughts: data?.thoughts || [] });
    } catch (err) {
      next(err);
    }
  }
);

// ── Mark all Nova messages as READ (read receipt) ─────────────────────────────
// The mobile app calls this when the user opens the chat / foregrounds the app,
// so Nova knows which of her messages have actually been seen. This is the "seen"
// signal that feeds `unreadNovaMessages` into the situation brief — letting Nova
// tell "user hasn't seen my message yet" apart from "user left me on read".
chatRouter.post(
  '/read',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = (req as any).user!.id;
      const { error } = await supabaseAdmin
        .from('chat_history')
        .update({ is_read: true, read_at: new Date().toISOString() })
        .eq('user_id', userId)
        .eq('role', 'assistant')
        .eq('is_read', false);
      if (error) throw new Error(error.message);
      res.status(200).json({ success: true });
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

// ── SWITCH Message Version ───────────────────────────────────────────────────
chatRouter.post(
  '/:messageId/version',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = (req as any).user!.id;
      const { messageId } = req.params;
      const { version_index } = req.body;

      if (typeof version_index !== 'number') {
        throw new ValidationError('version_index must be a number');
      }

      const result = await watchtowerReflectionService.switchMessageVersion(userId, messageId, version_index);
      if (!result.success) {
        res.status(400).json({ error: result.error || 'Failed to switch version' });
        return;
      }

      res.status(200).json({ success: true, active_content: result.activeContent, version_index });
    } catch (err) {
      next(err);
    }
  }
);

// ── REGENERATE / BRANCH Message ──────────────────────────────────────────────
chatRouter.post(
  '/:messageId/branch',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = (req as any).user!.id;
      const { messageId } = req.params;

      const { data: targetMsg, error: fetchErr } = await supabaseAdmin
        .from('chat_history')
        .select('*')
        .eq('id', messageId)
        .eq('user_id', userId)
        .maybeSingle();

      if (fetchErr || !targetMsg) {
        throw new ValidationError('Target message not found');
      }

      const { data: prevUserMsg } = await supabaseAdmin
        .from('chat_history')
        .select('content')
        .eq('user_id', userId)
        .eq('conversation_id', targetMsg.conversation_id)
        .eq('role', 'user')
        .lt('created_at', targetMsg.created_at)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      const userPrompt = prevUserMsg?.content || 'Continue the conversation';

      const rawAlternative = await complete(
        'USER_FAST',
        [
          { role: 'system', content: 'You are Nova, texting on WhatsApp. Give a fresh, warm, natural Hinglish alternative reply in 1-2 short sentences. No robot headers or lists.' },
          { role: 'user', content: userPrompt }
        ],
        { temperature: 0.7, maxTokens: 300 }
      );

      const alternativeClean = rawAlternative.trim();
      const meta = (targetMsg.meta as any) || {};
      const versions: any[] = meta.versions || [
        {
          version: 1,
          content: targetMsg.content,
          timestamp: targetMsg.created_at,
          reason: 'Initial reply'
        }
      ];

      versions.push({
        version: versions.length + 1,
        content: alternativeClean,
        timestamp: new Date().toISOString(),
        reason: 'User regenerated branch'
      });

      const updatedMeta = {
        ...meta,
        is_corrected: true,
        active_version_index: versions.length - 1,
        versions
      };

      await supabaseAdmin
        .from('chat_history')
        .update({
          content: alternativeClean,
          meta: updatedMeta
        })
        .eq('id', messageId);

      res.status(200).json({
        success: true,
        active_content: alternativeClean,
        version_index: versions.length - 1,
        versions
      });
    } catch (err) {
      next(err);
    }
  }
);

