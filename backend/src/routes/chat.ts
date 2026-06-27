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

export const chatRouter: import('express').Router = Router();

const ChatSchema = z.object({
  message: z.string().min(1).max(4000),
  conversation_id: z.string().uuid().optional(),
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

      const { message, conversation_id } = parseResult.data;
      const userId = (req as any).user!.id;
      const activeConversationId = conversation_id || crypto.randomUUID();
      const isDegraded = dbHealthService.isDegraded();

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

      // 4. Long-Term Memories + Working Memory (WM cached 30s)
      const keywords = extractKeywords(message);
      const wmCacheKey = `working_memory:${userId}`;
      let workingMemories: { key: string; value: string }[] = [];

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

      const memories = await memoryRepository.searchMemories(userId, keywords);

      // 5. Build prompt
      const systemPrompt = promptBuilder.buildSystemPrompt(
        BASE_SYSTEM_PROMPT,
        memories,
        workingMemories,
        profile?.preferred_name,
        profile?.companion_personality
      );

      const messagesForLLM = [
        { role: 'system' as const, content: systemPrompt },
        ...recentMessages
      ];

      // 6. Call NVIDIA
      let reply: string;
      try {
        reply = await chatCompletion(messagesForLLM, { maxTokens: 512, temperature: 0.7 });
      } catch (nvidiaError) {
        throw new ExternalServiceError('NVIDIA', nvidiaError instanceof Error ? nvidiaError.message : String(nvidiaError));
      }

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
      Promise.all([
        memoryQueue.add('extract_semantic', payload),
        memoryQueue.add('extract_working_memory', payload),
        memoryQueue.add('extract_episodic', payload),
        memoryQueue.add('extract_kg', payload),
        memoryQueue.add('extract_emotional', payload)
      ]).catch(err => {
        logger.error('Failed to enqueue background extraction jobs', { error: err instanceof Error ? err.message : String(err) });
      });

      // Invalidate WM cache so next message sees fresh WM after extraction
      cache.invalidate(wmCacheKey);

      res.status(200).json({
        reply,
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
        .select('id, role, content, created_at, conversation_id')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(50);

      if (conversationId) query = query.eq('conversation_id', conversationId);

      const { data, error } = await qt.track('get_history', 'chat_history', () => query);
      if (error) throw new Error(error.message);

      res.status(200).json(data.reverse());
    } catch (err) {
      next(err);
    }
  }
);
