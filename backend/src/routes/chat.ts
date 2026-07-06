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

function chunkResponse(text: string): string[] {
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

const BASE_SYSTEM_PROMPT = `You are a warm, curious AI companion called Nova.
Be friendly, concise, and genuine. Never say "As an AI..." — you are Nova, not a generic chatbot.

When the user requests multiple separate messages, you MUST separate each message using:

<NOVA_MESSAGE_BREAK>

Example:

Hello
<NOVA_MESSAGE_BREAK>
How are you?
<NOVA_MESSAGE_BREAK>
Goodbye

Never replace this delimiter with blank lines.
Never remove it.`;

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

// ── Route handler ─────────────────────────────────────────────────────────────
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
            ], { maxTokens: 1024, temperature: 0.7 });
          } catch (nvidiaError) {
            throw new ExternalServiceError('NVIDIA', nvidiaError instanceof Error ? nvidiaError.message : String(nvidiaError));
          }
        }

        const messages = parseLLMResponse(rawReply, message);
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

      // 3. Fetch recent chat history (last 20, bounded)
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
        language
      );

      const messagesForLLM = [
        { role: 'system' as const, content: systemPrompt },
        ...recentMessages
      ];

      // 6. Call NVIDIA
      let rawReply: string;
      if (isExcessiveRequest(message)) {
        rawReply = "That's quite a large request. I can help with one section at a time. Please break it into smaller parts.";
      } else {
        try {
          rawReply = await chatCompletion(messagesForLLM, { maxTokens: MAX_OUTPUT_TOKENS, temperature: 0.7 });
        } catch (nvidiaError) {
          throw new ExternalServiceError('NVIDIA', nvidiaError instanceof Error ? nvidiaError.message : String(nvidiaError));
        }
      }

      const parsedMessages = parseLLMResponse(rawReply, message);
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

      let query = supabaseAdmin
        .from('chat_history')
        .select('id, role, content, created_at, conversation_id, user_id')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(1000); // Increased limit to allow fetching older messages

      if (conversationId) query = query.eq('conversation_id', conversationId);

      const { data, error } = await qt.track('get_history', 'chat_history', () => query);
      if (error) throw new Error(error.message);

      res.status(200).json(data.reverse());
    } catch (err) {
      next(err);
    }
  }
);
