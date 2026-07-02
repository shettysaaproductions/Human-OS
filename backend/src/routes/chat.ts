import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { chatCompletion, getMockResponse, nvidiaClient } from '../lib/nvidia';
import { config } from '../config';
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
  client_message_id: z.string().optional(),
});

const BASE_SYSTEM_PROMPT = `You are a warm, curious AI companion called Nova.
Be friendly, concise, and genuine. Never say "As an AI..." — you are Nova, not a generic chatbot.`;

// ── Route handler ─────────────────────────────────────────────────────────────
chatRouter.post(
  '/',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parseResult = ChatSchema.safeParse(req.body);
      if (!parseResult.success) {
        throw new ValidationError(parseResult.error.issues[0]?.message ?? 'Invalid request body');
      }

      const { message, conversation_id, language, client_message_id } = parseResult.data;
      const userId = (req as any).user!.id;
      const activeConversationId = conversation_id || crypto.randomUUID();
      const isDegraded = dbHealthService.isDegraded();

      if (client_message_id) {
        const dedupeKey = `dedupe:chat:${userId}:${client_message_id}`;
        if (cache.get(dedupeKey)) {
          logger.warn('[DIAGNOSTICS] DUPLICATE_BLOCKED', { client_message_id });
          res.status(200).json({ reply: 'Message already being processed.', conversation_id: activeConversationId, meta: { duplicate: true } });
          return;
        }
        cache.set(dedupeKey, true, 600000, 'dedupe');
      }

      // ── Degraded Mode: serve from in-memory buffer ─────────────
      if (isDegraded) {
        logger.warn('Chat running in DEGRADED mode', { userId });
        degradedMode.appendMessage(userId, 'user', message);
        const recentMessages = degradedMode.getRecentMessages(userId);

        let reply: string;
        try {
          reply = await chatCompletion([
            { role: 'system', content: BASE_SYSTEM_PROMPT + '\n[Note: Running in degraded mode — some memories may be unavailable.]' },
            ...recentMessages.map(m => ({ role: m.role as 'user' | 'assistant' | 'system', content: m.content }))
          ], { maxTokens: 512, temperature: 0.7 });
        } catch (nvidiaError) {
          throw new ExternalServiceError('NVIDIA', nvidiaError instanceof Error ? nvidiaError.message : String(nvidiaError));
        }

        degradedMode.appendMessage(userId, 'assistant', reply);

        // Queue DB writes for later drain
        degradedMode.enqueue({ table: 'chat_history', operation: 'insert', data: { user_id: userId, conversation_id: activeConversationId, role: 'user', content: message, created_at: new Date().toISOString() } });
        degradedMode.enqueue({ table: 'chat_history', operation: 'insert', data: { user_id: userId, conversation_id: activeConversationId, role: 'assistant', content: reply, created_at: new Date().toISOString() } });

        res.status(200).json({ reply, conversation_id: activeConversationId, meta: { degraded: true } });
        return;
      }

      // ── Normal Mode ───────────────────────────────────────────
      const dbStart = performance.now();
      const keywords = extractKeywords(message);
      const wmCacheKey = `working_memory:${userId}`;

      const [
        profile,
        historyDataResult,
        memories,
        stmDataResult,
        userMsgResult,
        workingMemories
      ] = await Promise.all([
        // 1. Profile (cached 5 min)
        (async () => {
          const profileCacheKey = `profile:${userId}`;
          let cachedProfile = cache.get<{ preferred_name: string; companion_personality: string }>(profileCacheKey);
          if (!cachedProfile) {
            const { data: profileData } = await qt.track('get_profile', 'profiles', () =>
              supabaseAdmin.from('profiles')
                .select('preferred_name, companion_personality')
                .eq('id', userId)
                .maybeSingle()
            );
            if (profileData) {
              cachedProfile = profileData;
              cache.set(profileCacheKey, cachedProfile, CACHE_TTL.PROFILE_MS, CACHE_NS.PROFILE);
            }
          }
          return cachedProfile;
        })(),
        // 2. Chat history (prior to this message)
        qt.track('get_chat_history', 'chat_history', () =>
          supabaseAdmin.from('chat_history')
            .select('role, content')
            .eq('user_id', userId)
            .eq('conversation_id', activeConversationId)
            .order('created_at', { ascending: false })
            .limit(20)
        ),
        // 3. Long-Term Memories
        memoryRepository.searchMemories(userId, keywords),
        // 4. Short-Term Memories
        qt.track('get_short_term_memories', 'short_term_memories', () =>
          supabaseAdmin.from('short_term_memories')
            .select('memory, emotion, importance, mention_count, expires_at, confidence')
            .eq('user_id', userId)
            .gte('confidence', 0.6)
            .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
            .order('importance', { ascending: false })
            .order('last_mentioned_at', { ascending: false })
            .limit(20)
        ),
        // 5. Save user message concurrently
        qt.track('save_user_message', 'chat_history', () =>
          supabaseAdmin.from('chat_history')
            .insert({ user_id: userId, conversation_id: activeConversationId, role: 'user', content: message })
            .select('id').single()
        ),
        // 6. Working Memory
        (async () => {
          const cachedWm = cache.get<{ key: string; value: string }[]>(wmCacheKey);
          if (cachedWm) return cachedWm;
          const { data: wmData } = await qt.track('get_working_memory', 'working_memory', () =>
            supabaseAdmin.from('working_memory')
              .select('key, value')
              .eq('user_id', userId)
              .gt('expires_at', new Date().toISOString())
              .limit(10)
          );
          const wm = (wmData || []).map(wm => ({ key: wm.key, value: wm.value }));
          cache.set(wmCacheKey, wm, CACHE_TTL.WORKING_MEMORY_MS, CACHE_NS.WORKING_MEMORY);
          return wm;
        })()
      ]);

      const dbFetchMs = performance.now() - dbStart;

      const userMsgRecord = userMsgResult.data;
      const userMsgError = userMsgResult.error;
      if (userMsgError) logger.error('Failed to save user message', { error: userMsgError.message });
      const userMessageId = userMsgRecord?.id || 'msg_' + Date.now();

      const historyData = historyDataResult.data || [];
      const recentMessages = historyData.reverse().map(msg => ({
        role: msg.role as 'user' | 'assistant' | 'system',
        content: msg.content
      }));

      // Ensure user message is appended to local context list if concurrent select didn't catch it
      if (recentMessages.length === 0 || recentMessages[recentMessages.length - 1].content !== message) {
        recentMessages.push({ role: 'user', content: message });
      }

      const stmData = stmDataResult.data || [];
      const allFetched = stmData || [];
      let stmTokens = 0;
      const budgetMemories = [];
      
      for (const m of allFetched) {
        const memTokens = Math.ceil(m.memory.length / 4);
        if (stmTokens + memTokens > 1500) break;
        stmTokens += memTokens;
        budgetMemories.push(m);
      }

      const shortTermMemories = budgetMemories;
      const importantShortTermCount = shortTermMemories.filter(m => m.expires_at === null).length;
      
      logger.info('ShortTermMemories Loaded:', { count: shortTermMemories.length });
      logger.info('Important Memories:', { count: importantShortTermCount });
      logger.info('Memory Tokens Injected:', { tokens: stmTokens });

      // Count total short term memories for user
      supabaseAdmin.from('short_term_memories').select('id', { count: 'exact', head: true }).eq('user_id', userId)
        .then(({ count }) => {
          if (count !== null) logger.info('Total Memories For User:', { count });
        });

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

      // 5. Build prompt
      const promptStart = performance.now();
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
      const promptBuildMs = performance.now() - promptStart;

      // 6. Call NVIDIA
      const llmStart = performance.now();
      let reply: string;
      try {
        reply = await chatCompletion(messagesForLLM, { maxTokens: 512, temperature: 0.7 });
      } catch (nvidiaError) {
        throw new ExternalServiceError('NVIDIA', nvidiaError instanceof Error ? nvidiaError.message : String(nvidiaError));
      }
      const llmTotalMs = performance.now() - llmStart;
      const llmFirstTokenMs = llmTotalMs; // Non-streaming fallback

      // 7. Save AI response
      await qt.track('save_ai_response', 'chat_history', () =>
        supabaseAdmin.from('chat_history')
          .insert({ user_id: userId, conversation_id: activeConversationId, role: 'assistant', content: reply })
      );

      // 8. Also buffer to in-memory (for degraded mode recovery continuity)
      degradedMode.appendMessage(userId, 'user', message);
      degradedMode.appendMessage(userId, 'assistant', reply);

      // 9. Background extraction (fire & forget)
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

      logger.info('Performance Instrumentation metrics:', {
        DB_FETCH_MS: dbFetchMs,
        PROMPT_BUILD_MS: promptBuildMs,
        LLM_FIRST_TOKEN_MS: llmFirstTokenMs,
        LLM_TOTAL_MS: llmTotalMs
      });

      res.status(200).json({
        reply,
        conversation_id: activeConversationId,
        meta: {
          memories_retrieved: memories.length,
          keywords_searched: keywords,
          degraded: false,
          DB_FETCH_MS: dbFetchMs,
          PROMPT_BUILD_MS: promptBuildMs,
          LLM_FIRST_TOKEN_MS: llmFirstTokenMs,
          LLM_TOTAL_MS: llmTotalMs
        }
      });
    } catch (err) {
      next(err);
    }
  }
);

chatRouter.post(
  '/stream',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parseResult = ChatSchema.safeParse(req.body);
      if (!parseResult.success) {
        throw new ValidationError(parseResult.error.issues[0]?.message ?? 'Invalid request body');
      }

      const { message, conversation_id, language, client_message_id } = parseResult.data;
      const userId = (req as any).user!.id;
      const activeConversationId = conversation_id || crypto.randomUUID();

      if (client_message_id) {
        const dedupeKey = `dedupe:chat:${userId}:${client_message_id}`;
        if (cache.get(dedupeKey)) {
          logger.warn('[DIAGNOSTICS] DUPLICATE_BLOCKED', { client_message_id });
          res.status(200).json({ reply: 'Message already being processed.', conversation_id: activeConversationId, meta: { duplicate: true } });
          return;
        }
        cache.set(dedupeKey, true, 600000, 'dedupe');
      }

      const dbStart = performance.now();
      const keywords = extractKeywords(message);
      const wmCacheKey = `working_memory:${userId}`;

      const [
        profile,
        historyDataResult,
        memories,
        stmDataResult,
        userMsgResult,
        workingMemories
      ] = await Promise.all([
        (async () => {
          const profileCacheKey = `profile:${userId}`;
          let cachedProfile = cache.get<{ preferred_name: string; companion_personality: string }>(profileCacheKey);
          if (!cachedProfile) {
            const { data: profileData } = await qt.track('get_profile', 'profiles', () =>
              supabaseAdmin.from('profiles')
                .select('preferred_name, companion_personality')
                .eq('id', userId)
                .maybeSingle()
            );
            if (profileData) {
              cachedProfile = profileData;
              cache.set(profileCacheKey, cachedProfile, CACHE_TTL.PROFILE_MS, CACHE_NS.PROFILE);
            }
          }
          return cachedProfile;
        })(),
        qt.track('get_chat_history', 'chat_history', () =>
          supabaseAdmin.from('chat_history')
            .select('role, content')
            .eq('user_id', userId)
            .eq('conversation_id', activeConversationId)
            .order('created_at', { ascending: false })
            .limit(20)
        ),
        memoryRepository.searchMemories(userId, keywords),
        qt.track('get_short_term_memories', 'short_term_memories', () =>
          supabaseAdmin.from('short_term_memories')
            .select('memory, emotion, importance, mention_count, expires_at, confidence')
            .eq('user_id', userId)
            .gte('confidence', 0.6)
            .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
            .order('importance', { ascending: false })
            .order('last_mentioned_at', { ascending: false })
            .limit(20)
        ),
        qt.track('save_user_message', 'chat_history', () =>
          supabaseAdmin.from('chat_history')
            .insert({ user_id: userId, conversation_id: activeConversationId, role: 'user', content: message })
            .select('id').single()
        ),
        (async () => {
          const cachedWm = cache.get<{ key: string; value: string }[]>(wmCacheKey);
          if (cachedWm) return cachedWm;
          const { data: wmData } = await qt.track('get_working_memory', 'working_memory', () =>
            supabaseAdmin.from('working_memory')
              .select('key, value')
              .eq('user_id', userId)
              .gt('expires_at', new Date().toISOString())
              .limit(10)
          );
          const wm = (wmData || []).map(wm => ({ key: wm.key, value: wm.value }));
          cache.set(wmCacheKey, wm, CACHE_TTL.WORKING_MEMORY_MS, CACHE_NS.WORKING_MEMORY);
          return wm;
        })()
      ]);

      const dbFetchMs = performance.now() - dbStart;

      const userMsgRecord = userMsgResult.data;
      const userMsgError = userMsgResult.error;
      if (userMsgError) logger.error('Failed to save user message', { error: userMsgError.message });
      const userMessageId = userMsgRecord?.id || 'msg_' + Date.now();

      const historyData = historyDataResult.data || [];
      const recentMessages = historyData.reverse().map(msg => ({
        role: msg.role as 'user' | 'assistant' | 'system',
        content: msg.content
      }));

      if (recentMessages.length === 0 || recentMessages[recentMessages.length - 1].content !== message) {
        recentMessages.push({ role: 'user', content: message });
      }

      const stmData = stmDataResult.data || [];
      const allFetched = stmData || [];
      let stmTokens = 0;
      const budgetMemories = [];
      
      for (const m of allFetched) {
        const memTokens = Math.ceil(m.memory.length / 4);
        if (stmTokens + memTokens > 1500) break;
        stmTokens += memTokens;
        budgetMemories.push(m);
      }

      const shortTermMemories = budgetMemories;

      const promptStart = performance.now();
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
      const promptBuildMs = performance.now() - promptStart;

      // Set headers for SSE streaming
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      logger.info('[DIAGNOSTICS] STREAM_STARTED', { userId });
      res.write(`event: start\ndata: ${JSON.stringify({ DB_FETCH_MS: dbFetchMs, PROMPT_BUILD_MS: promptBuildMs, conversation_id: activeConversationId })}\n\n`);

      const llmStart = performance.now();
      let isFirstToken = true;
      let llmFirstTokenMs = 0;
      let fullReply = '';
      let isClientDisconnected = false;

      req.on('close', () => {
        isClientDisconnected = true;
        logger.info('Client disconnected from SSE stream');
      });

      try {
        const stream = await nvidiaClient.chat.completions.create({
          model: config.nvidia.chatModel,
          messages: messagesForLLM,
          max_tokens: 512,
          temperature: 0.7,
          stream: true,
        });

        for await (const chunk of stream) {
          if (isClientDisconnected) {
            break;
          }
          if (isFirstToken) {
            llmFirstTokenMs = performance.now() - llmStart;
            isFirstToken = false;
            logger.info('[DIAGNOSTICS] FIRST_TOKEN_RECEIVED', { LLM_FIRST_TOKEN_MS: llmFirstTokenMs });
            res.write(`event: first_token\ndata: ${JSON.stringify({ LLM_FIRST_TOKEN_MS: llmFirstTokenMs })}\n\n`);
          }
          const content = chunk.choices[0]?.delta?.content || '';
          if (content) {
            fullReply += content;
            res.write(`event: chunk\ndata: ${JSON.stringify({ content })}\n\n`);
          }
        }

        if (!isClientDisconnected) {
          const llmTotalMs = performance.now() - llmStart;
          logger.info('[DIAGNOSTICS] STREAM_FINISHED', { LLM_TOTAL_MS: llmTotalMs });

          // Background saves and extractions
          supabaseAdmin.from('chat_history')
            .insert({ user_id: userId, conversation_id: activeConversationId, role: 'assistant', content: fullReply })
            .then(({ error }) => {
              if (error) logger.error('Failed to save AI response in stream route', { error: error.message });
            });

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
            backgroundJobs.push(memoryQueue.add('extract_short_term', payload));
          }
          Promise.all(backgroundJobs).catch(err => {
            logger.error('Failed background extractions in stream route', { error: err.message });
          });

          cache.invalidate(wmCacheKey);

          res.write(`event: done\ndata: ${JSON.stringify({ LLM_TOTAL_MS: llmTotalMs })}\n\n`);
        }
        res.end();
      } catch (err: any) {
        logger.warn('NVIDIA stream failed, falling back to mock stream', { error: err.message });
        try {
          const mockText = getMockResponse(messagesForLLM, { maxTokens: 512, temperature: 0.7 });
          if (isFirstToken) {
            llmFirstTokenMs = performance.now() - llmStart;
            res.write(`event: first_token\ndata: ${JSON.stringify({ LLM_FIRST_TOKEN_MS: llmFirstTokenMs })}\n\n`);
          }
          const mockChunks = mockText.match(/.{1,4}/g) || [mockText];
          for (const chunk of mockChunks) {
            if (isClientDisconnected) break;
            res.write(`event: chunk\ndata: ${JSON.stringify({ content: chunk })}\n\n`);
            await new Promise(r => setTimeout(r, 10));
          }
          if (!isClientDisconnected) {
            const llmTotalMs = performance.now() - llmStart;
            res.write(`event: done\ndata: ${JSON.stringify({ LLM_TOTAL_MS: llmTotalMs })}\n\n`);
          }
          res.end();
        } catch (fallbackErr: any) {
          logger.error('[DIAGNOSTICS] STREAM_FAILED', { error: fallbackErr.message });
          res.write(`event: error\ndata: ${JSON.stringify({ error: fallbackErr.message })}\n\n`);
          res.end();
        }
      }
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
