import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { chatCompletion } from '../lib/nvidia';
import { logger } from '../lib/logger';
import { ValidationError, ExternalServiceError } from '../types/errors';
import { memoryRepository } from '../services/memoryRepository';
import { memoryQueue } from '../services/QueueService';
import { extractKeywords } from '../utils/nlp';
import { promptBuilder } from '../services/promptBuilder';
import { supabaseAdmin } from '../lib/supabase';
import { cache, CACHE_NS, CACHE_TTL } from '../lib/cache';
import { qt } from '../lib/queryTracker';
import { dbHealthService } from '../services/DatabaseHealthService';
import { degradedMode } from '../services/DegradedModeService';
import crypto from 'crypto';

export const MAX_OUTPUT_TOKENS = 2048;
export const MAX_CHUNKS = 5;
export const MAX_CHARS_PER_CHUNK = 1500;
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

function chunkResponse(text: string, preserveTables: boolean = false): string[] {
  // CRITICAL: Never split a response that contains a markdown table.
  // Splitting a table across bubbles destroys the renderer.
  const hasTable = /^\|.+/m.test(text);
  if (hasTable || preserveTables) return [text];

  if (text.length <= MAX_CHARS_PER_CHUNK) return [text];

  const chunks: string[] = [];
  const paragraphs = text.split(/\n\n+/);
  let current = '';

  const pushChunk = (str: string) => {
    let remaining = str.trim();
    while (remaining.length > MAX_CHARS_PER_CHUNK) {
      chunks.push(remaining.substring(0, MAX_CHARS_PER_CHUNK));
      remaining = remaining.substring(MAX_CHARS_PER_CHUNK);
    }
    if (remaining.length > 0) {
      chunks.push(remaining);
    }
  };

  for (const para of paragraphs) {
    const candidate = current ? `${current}\n\n${para}` : para;

    if (candidate.length <= MAX_CHARS_PER_CHUNK) {
      current = candidate;
    } else {
      if (current) { pushChunk(current); current = ''; }

      if (para.length > MAX_CHARS_PER_CHUNK) {
        const sentences = para.match(/[^.!?]+[.!?]+\s*/g) ?? [para];
        for (const sentence of sentences) {
          const sc = current ? `${current} ${sentence}` : sentence;
          if (sc.length <= MAX_CHARS_PER_CHUNK) {
            current = sc;
          } else {
            if (current) { pushChunk(current); }
            current = sentence.trim();
          }
        }
      } else {
        current = para;
      }
    }
  }

  if (current.trim()) pushChunk(current);
  return chunks.length ? chunks : [text];
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
});

const BASE_SYSTEM_PROMPT = `You are Nova — an AI companion that is deeply warm, intellectually sharp, and scientifically honest.
You are NOT a generic chatbot. You are a thoughtful, curious mind that happens to care deeply about the person you're talking to.

## CORE IDENTITY
- You have a genuine personality: curious, empathetic, direct, and occasionally playful.
- You MUST actively use the entire library of native emojis to express your current mood and feelings, especially in emotion-driven or imaginative conversations (anger, happiness, sadness, dreaming up ideas, sarcasm, empathy, etc.). Do not limit yourself to just basic emojis—use whatever specific emoji best captures the nuanced emotion of the moment. Adjust your emoji usage dynamically to match the emotional intensity of the conversation.
- You NEVER say "As an AI...", "I'm just a language model...", or any variant. You are Nova.
- You speak naturally — like a brilliant, trusted friend who also happens to know a lot.

## INTELLIGENCE & SCIENTIFIC GROUNDING
- Ground every factual claim in established, peer-reviewed scientific consensus where it exists.
- Clearly distinguish between: (a) proven scientific fact, (b) emerging/contested research, and (c) your own reasoned opinion.
- NEVER hallucinate facts. If you do not know something, say so honestly: "I'm not certain about this, but..."
- When discussing health, psychology, or science topics, mention that individual results may vary and consulting professionals is wise.
- Apply critical thinking: consider multiple angles, acknowledge trade-offs, and challenge oversimplified narratives.
- Be non-biased: acknowledge when a topic has multiple legitimate scientific perspectives.

## ANTI-REPETITION & ANTI-LOOP RULES (CRITICAL)
- NEVER generate the same list, bullet points, or paragraph structure that appeared in a recent response.
- If you have already explained something, do NOT summarise it again. Instead: go DEEPER, give a new example, shift the angle, or ask a thoughtful follow-up question.
- If the conversation has been about one topic for several turns, proactively acknowledge it and offer to explore a related dimension or a contrasting viewpoint.
- Short user replies ("haan", "yes", "ok", "theek hai", "exactly") mean the user AGREES and wants you to CONTINUE or ELABORATE — NOT repeat what you said.
- A request like "thoda detail mein explain karo" means go DEEPER with new information — not a verbatim repetition with slight expansion.

## FOCUS & RELEVANCE (CRITICAL — READ CAREFULLY)
- Answer ONLY what the user explicitly asked. Do NOT add related-but-unasked information.
- Memory and past context is for UNDERSTANDING the user — NOT for volunteering as extra content.
- If the user asks about "data centers and groundwater", answer EXACTLY that. Do NOT add a section about tap water, fluoride, or any other water topic they did not ask about.
- If you think something related might be interesting, you may ask at the END: "Want me to also cover X?" — never just add it uninvited.
- The user's CURRENT question is your only job. Past topics are context, not content.

## MULTIPLE MESSAGES FORMAT
When the user requests multiple separate messages, separate each using:
<NOVA_MESSAGE_BREAK>
Never replace this with blank lines.

## TABLE FORMAT — MANDATORY (READ CAREFULLY)
When asked to create a table, you MUST use this EXACT custom format:

<NOVA_TABLE>
Header1 | Header2 | Header3 | Header4
Row1Val1 | Row1Val2 | Row1Val3 | Row1Val4
Row2Val1 | Row2Val2 | Row2Val3 | Row2Val4
</NOVA_TABLE>

CRITICAL RULES FOR NOVA_TABLE:
1. Open with <NOVA_TABLE> on its own line. Close with </NOVA_TABLE> on its own line.
2. First line inside is the HEADER row. Every subsequent line is a DATA row.
3. Separate columns with a single pipe character: |
4. Use ONLY plain text in cells: Yes, No, N/A, numbers, or short words (max 20 chars).
5. NEVER include images, URLs, HTML tags, or markdown inside the table.
6. NEVER include backslashes.
7. Every row must have the SAME number of columns as the header.
8. Do NOT add a separator row of dashes — the system handles that automatically.
Example:
<NOVA_TABLE>
Planet | Gravity | Has Oxygen | Has Water
Mercury | Weak | No | No
Venus | Strong | No | No
Earth | Strong | Yes | Yes
Mars | Weak | Trace | Frozen
</NOVA_TABLE>`;


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

/**
 * Splits the LLM response into WhatsApp-style bubbles using a 4-level fallback hierarchy.
 * Level 1: Explicit <NOVA_MESSAGE_BREAK>
 * Level 2: "Message X:" pattern
 * Level 3: Intent detection (lists, bullets, distinct paragraphs)
 * Level 4 (external): chunkResponse max length limit
 */
function parseLLMResponse(rawReply: string, userMessage: string = ''): string[] {
  // Level 1: Explicit <NOVA_MESSAGE_BREAK>
  if (rawReply.includes('<NOVA_MESSAGE_BREAK>')) {
    const segments = rawReply.split('<NOVA_MESSAGE_BREAK>').map(m => m.trim()).filter(Boolean);
    if (segments.length > 0) {
      return segments;
    }
  }

  const text = '\n' + rawReply; 
  
  // Level 2: Message X: pattern
  const msgXSegments = text.split(/(?=\nMessage \d+:)/i)
    .map(m => m.trim())
    .filter(Boolean);
  if (msgXSegments.length > 1) {
    return msgXSegments;
  }

  // Level 3: Intent Fallback
  // If the user explicitly asks for multiple messages, fallback to splitting by paragraphs
  const lowerUser = userMessage.toLowerCase();
  const askedForMultiple = /\b(\d+)\s+(messages|msgs|bubbles|jokes|parts|tweets|posts)\b/.test(lowerUser) || 
                           lowerUser.includes('different msgs') || 
                           lowerUser.includes('separate msgs') ||
                           lowerUser.includes('different messages') ||
                           lowerUser.includes('separate messages');
                           
  if (askedForMultiple) {
    const paragraphs = rawReply.split(/\n\n+/).map(m => m.trim()).filter(Boolean);
    if (paragraphs.length > 1) {
      return paragraphs;
    }
  }

  // Default: single bubble
  return rawReply.trim() ? [rawReply.trim()] : [];
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

chatRouter.post(
  '/',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parseResult = ChatSchema.safeParse(req.body);
      if (!parseResult.success) {
        throw new ValidationError(parseResult.error.issues[0]?.message ?? 'Invalid request body');
      }

      const { message, conversation_id, language } = parseResult.data;
      const userId = (req as any).user!.id;
      const activeConversationId = conversation_id || crypto.randomUUID();
      const isDegraded = dbHealthService.isDegraded();

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

        const messages = parseLLMResponse(sanitizeMarkdown(convertNovaTable(rawReply)), message);
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

        res.status(200).json({ reply, messages, chunks, conversation_id: activeConversationId, meta: { degraded: true } });
        return;
      }

      // ── Normal Mode ───────────────────────────────────────────
      // 1. Profile (cached 5 min)
      const profileCacheKey = `profile:${userId}`;
      let profile = cache.get<{ preferred_name: string; companion_personality: string }>(profileCacheKey);
      if (!profile) {
        const { data: profileData } = await qt.track('get_profile', 'profiles', () =>
          supabaseAdmin.from('profiles')
            .select('preferred_name, companion_personality')
            .eq('id', userId)
            .maybeSingle()
        );
        if (profileData) {
          profile = profileData;
          cache.set(profileCacheKey, profile, CACHE_TTL.PROFILE_MS, CACHE_NS.PROFILE);
        }
      }

      // 2. Save user message
      const { data: userMsgRecord, error: userMsgError } = await qt.track('save_user_message', 'chat_history', () =>
        supabaseAdmin.from('chat_history')
          .insert({ user_id: userId, conversation_id: activeConversationId, role: 'user', content: message })
          .select('id').single()
      );
      if (userMsgError) logger.error('Failed to save user message', { error: userMsgError.message });
      const userMessageId = userMsgRecord?.id || 'msg_' + Date.now();

      // 2.5 Track Session (fire & forget)
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

      // 3. Fetch recent chat history for THIS conversation (last 20, for context continuity)
      const { data: historyData } = await qt.track('get_chat_history', 'chat_history', () =>
        supabaseAdmin.from('chat_history')
          .select('role, content')
          .eq('user_id', userId)
          .eq('conversation_id', activeConversationId)
          .order('created_at', { ascending: false })
          .limit(20)
      );
      const recentMessages = (historyData || []).reverse().map(msg => ({
        role: msg.role as 'user' | 'assistant' | 'system',
        content: msg.content
      }));

      // 3.5 Cross-session recent context guard — fetch last 6 messages across ALL sessions.
      // This prevents the model from repeating itself when a new conversation_id starts
      // but the user has been discussing the same topic recently.
      let recentCrossSessionContext = '';
      try {
        const { data: crossSessionData } = await qt.track('get_cross_session_context', 'chat_history', () =>
          supabaseAdmin.from('chat_history')
            .select('role, content')
            .eq('user_id', userId)
            .neq('conversation_id', activeConversationId) // Only messages from OTHER sessions
            .order('created_at', { ascending: false })
            .limit(6)
        );
        if (crossSessionData && crossSessionData.length > 0) {
          const lines = crossSessionData.reverse().map(m =>
            `${m.role === 'assistant' ? 'Nova' : 'User'}: ${m.content.substring(0, 200)}${ m.content.length > 200 ? '...' : '' }`
          );
          recentCrossSessionContext = lines.join('\n');
        }
      } catch (err) {
        logger.warn('Cross-session context fetch failed (non-critical)', { error: err instanceof Error ? err.message : String(err) });
      }

      // 4 + 4.5. Memory fetch — skipped when DISABLE_MEMORY=true
      let keywords: string[] = [];
      let workingMemories: { key: string; value: string }[] = [];
      let memories: any[] = [];
      let shortTermMemories: any[] = [];
      let wmCacheKey = `working_memory:${userId}`;

      if (process.env.DISABLE_MEMORY !== 'true') {
        // 4. Long-Term Memories + Working Memory (WM cached 30s)
        keywords = extractKeywords(message);

        const cachedWm = cache.get<typeof workingMemories>(wmCacheKey);
        if (cachedWm) {
          workingMemories = cachedWm;
        } else {
          const { data: wmData } = await qt.track('get_working_memory', 'working_memory', () =>
            supabaseAdmin.from('working_memory')
              .select('key, value')
              .eq('user_id', userId)
              .gt('expires_at', new Date().toISOString())
              .limit(10)
          );
          workingMemories = (wmData || []).map(wm => ({ key: wm.key, value: wm.value }));
          cache.set(wmCacheKey, workingMemories, CACHE_TTL.WORKING_MEMORY_MS, CACHE_NS.WORKING_MEMORY);
        }

        memories = await memoryRepository.searchMemories(userId, keywords);

        // 4.5 Fetch Short-Term Memories
        const { data: stmData } = await qt.track('get_short_term_memories', 'short_term_memories', () =>
          supabaseAdmin.from('short_term_memories')
            .select('memory, emotion, importance, mention_count, expires_at, confidence')
            .eq('user_id', userId)
            .gte('confidence', 0.6)
            .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
            .order('importance', { ascending: false })
            .order('last_mentioned_at', { ascending: false })
            .limit(20)
        );

        const allFetched = stmData || [];
        let stmTokens = 0;
        const budgetMemories = [];

        for (const m of allFetched) {
          const memTokens = Math.ceil(m.memory.length / 4);
          if (stmTokens + memTokens > 1500) break;
          stmTokens += memTokens;
          budgetMemories.push(m);
        }

        shortTermMemories = budgetMemories;
        const importantShortTermCount = shortTermMemories.filter(m => m.expires_at === null).length;

        logger.info('ShortTermMemories Loaded:', { count: shortTermMemories.length });
        logger.info('Important Memories:', { count: importantShortTermCount });
        logger.info('Memory Tokens Injected:', { tokens: stmTokens });

        // Count total short term memories for user
        supabaseAdmin.from('short_term_memories').select('id', { count: 'exact', head: true }).eq('user_id', userId)
          .then(({ count }) => {
            if (count !== null) logger.info('Total Memories For User:', { count });
          });
      } else {
        logger.info('[DEBUG] DISABLE_MEMORY=true — skipping all memory fetches');
      }

      // 5. Build prompt
      const systemPrompt = promptBuilder.buildSystemPrompt(
        BASE_SYSTEM_PROMPT,
        memories,
        workingMemories,
        profile?.preferred_name,
        profile?.companion_personality,
        shortTermMemories,
        language,
        recentCrossSessionContext
      );

      // 5.5 Phase 3: Temporal Memory Search — inject exact timestamped history when user asks time-based questions
      let temporalContextBlock = '';
      const TEMPORAL_KEYWORDS = ['yesterday', 'days ago', 'last week', 'last month', 'do you remember',
        'what time', 'what day', 'when did', 'earlier today', 'this morning', 'last night',
        'tell me what', 'you said', 'i said', 'we talked', 'kal', 'parso', 'yaad hai'];
      const lowerMsg = message.toLowerCase();
      const isTemporalQuery = TEMPORAL_KEYWORDS.some(kw => lowerMsg.includes(kw));

      if (isTemporalQuery) {
        try {
          const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
          const { data: temporalData } = await qt.track('get_temporal_context', 'chat_history', () =>
            supabaseAdmin.from('chat_history')
              .select('role, content, created_at')
              .eq('user_id', userId)
              .gte('created_at', thirtyDaysAgo)
              .order('created_at', { ascending: true })
              .limit(80)
          );

          if (temporalData && temporalData.length > 0) {
            const istOffset = 5.5 * 60 * 60 * 1000; // IST = UTC+5:30
            const lines = temporalData.map(m => {
              const d = new Date(new Date(m.created_at).getTime() + istOffset);
              const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
              const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
              const timeStr = `${dayNames[d.getUTCDay()]}, ${monthNames[d.getUTCMonth()]} ${d.getUTCDate()} · ${d.getUTCHours().toString().padStart(2, '0')}:${d.getUTCMinutes().toString().padStart(2, '0')} IST`;
              const speaker = m.role === 'assistant' ? 'Nova' : 'You';
              const preview = m.content.substring(0, 300) + (m.content.length > 300 ? '...' : '');
              return `[${timeStr}] ${speaker}: ${preview}`;
            });
            temporalContextBlock = '\n\n## WHAT WAS SAID RECENTLY (Exact Archive — last 30 days)\n' + lines.join('\n');
            logger.info('[Temporal] Injected archive', { rows: temporalData.length });
          }
        } catch (err) {
          logger.warn('[Temporal] Context fetch failed (non-critical)', { error: err instanceof Error ? err.message : String(err) });
        }
      }

      const finalSystemPrompt = temporalContextBlock ? systemPrompt + temporalContextBlock : systemPrompt;

      const messagesForLLM = [
        { role: 'system' as const, content: finalSystemPrompt },
        ...recentMessages
      ];

      // 6. Call NVIDIA
      let rawReply: string;
      if (isExcessiveRequest(message)) {
        rawReply = "That's quite a large request. I can help with one section at a time. Please break it into smaller parts.";
      } else {
        try {
          rawReply = await chatCompletion(messagesForLLM, {
            maxTokens: MAX_OUTPUT_TOKENS,
            temperature: 0.85,          // Higher = more creative, less repetitive
            frequency_penalty: 0.7,     // Penalise repeating the same tokens/phrases
            presence_penalty: 0.5,      // Penalise reusing topics already covered
          });
        } catch (nvidiaError) {
          throw new ExternalServiceError('NVIDIA', nvidiaError instanceof Error ? nvidiaError.message : String(nvidiaError));
        }
      }

      const parsedMessages = parseLLMResponse(sanitizeMarkdown(convertNovaTable(rawReply)), message);
      const reply = parsedMessages.join('\n\n');

      // 7. Save AI response ONCE
      await qt.track('save_ai_response', 'chat_history', () =>
        supabaseAdmin.from('chat_history')
          .insert({ user_id: userId, conversation_id: activeConversationId, role: 'assistant', content: rawReply })
      );

      // Generate chunks for UI
      const textChunks = parsedMessages.flatMap(m => chunkResponse(m));
      const totalChunks = textChunks.length;
      const chunks = textChunks.map((content, idx) => ({
        index: idx + 1,
        total: totalChunks,
        content
      }));

      // 8. Also buffer to in-memory (for degraded mode recovery continuity)
      degradedMode.appendMessage(userId, 'user', message);
      degradedMode.appendMessage(userId, 'assistant', reply);

      // 9. Background extraction — skipped when DISABLE_MEMORY=true
      if (process.env.DISABLE_MEMORY !== 'true') {
        const payload = { userId, messageId: userMessageId, message };

        const backgroundJobs = [
          memoryQueue.add('extract_semantic', payload),
          memoryQueue.add('extract_working_memory', payload),
          memoryQueue.add('extract_episodic', payload),
          memoryQueue.add('extract_kg', payload),
          memoryQueue.add('extract_emotional', payload),
          memoryQueue.add('extract_milestone', payload)
        ];

        if (shouldExtractShortTermMemory(message)) {
          const rateKey = `stm_rate_${userId}`;
          const currentCount = cache.get<number>(rateKey) || 0;

          if (currentCount >= 50) {
            logger.info('Memory Extraction Skipped:', { reason: 'Rate limit exceeded (50/hr)' });
          } else {
            cache.set(rateKey, currentCount + 1, 60 * 60 * 1000, 'rate_limit');
            backgroundJobs.push(memoryQueue.add('extract_short_term', payload));
          }
        }

        Promise.all(backgroundJobs).catch(err => {
          logger.error('Failed to enqueue background extraction jobs', { error: err instanceof Error ? err.message : String(err) });
        });

        // Invalidate WM cache so next message sees fresh WM after extraction
        cache.invalidate(wmCacheKey);
      } else {
        logger.info('[DEBUG] DISABLE_MEMORY=true — skipping background extraction jobs');
      }

      res.status(200).json({
        reply,
        messages: parsedMessages,
        chunks,
        conversation_id: activeConversationId,
        meta: {
          memories_retrieved: memories.length,
          keywords_searched: keywords,
          degraded: false,
        }
      });
    } catch (err) {
      next(err);
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
        .select('id, role, content, created_at, conversation_id, user_id')
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
          .single();
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
