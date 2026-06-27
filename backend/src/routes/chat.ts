import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { chatCompletion } from '../lib/nvidia';
import { logger } from '../lib/logger';
import { ValidationError, ExternalServiceError } from '../types/errors';
import { memoryRepository } from '../services/memoryRepository';
import { memoryExtractor } from '../services/memoryExtractor';
import { promptBuilder } from '../services/promptBuilder';
import { supabaseAdmin } from '../lib/supabase';
import crypto from 'crypto';

export const chatRouter: import('express').Router = Router();

// ── Input validation schema ────────────────────────────────────────────────────
const ChatSchema = z.object({
  message: z.string().min(1).max(4000),
  conversation_id: z.string().uuid().optional(),
});

const BASE_SYSTEM_PROMPT = `You are a warm, curious AI companion called Nova.
Be friendly, concise, and genuine. Never say "As an AI..." — you are Nova, not a generic chatbot.`;

// ── Route handler ──────────────────────────────────────────────────────────────
chatRouter.post(
  '/',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      // 1. Validate input
      const parseResult = ChatSchema.safeParse(req.body);
      if (!parseResult.success) {
        throw new ValidationError(parseResult.error.issues[0]?.message ?? 'Invalid request body');
      }

      const { message, conversation_id } = parseResult.data;
      const userId = (req as any).user!.id;
      
      // We need a conversation_id. If not provided, generate one.
      const activeConversationId = conversation_id || crypto.randomUUID();

      // 2. Fetch user profile
      const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('preferred_name, companion_personality')
        .eq('id', userId)
        .maybeSingle();

      // 3. Save User Message to DB
      const { data: userMsgRecord, error: userMsgError } = await supabaseAdmin
        .from('chat_history')
        .insert({
          user_id: userId,
          conversation_id: activeConversationId,
          role: 'user',
          content: message
        })
        .select('id')
        .single();
        
      if (userMsgError) logger.error('Failed to save user message', { error: userMsgError.message });
      const userMessageId = userMsgRecord?.id || 'msg_' + Date.now();

      // 4. Fetch last 20 messages for Context Pipeline
      const { data: historyData } = await supabaseAdmin
        .from('chat_history')
        .select('role, content')
        .eq('user_id', userId)
        .eq('conversation_id', activeConversationId)
        .order('created_at', { ascending: false })
        .limit(20);

      const recentMessages = (historyData || []).reverse().map(msg => ({
        role: msg.role as 'user' | 'assistant' | 'system',
        content: msg.content
      }));

      // 5. Retrieve Long-Term Memories
      const keywords = memoryExtractor.extractKeywords(message);
      const memories = await memoryRepository.searchMemories(userId, keywords);

      // 6. Build Context Pipeline System Prompt
      const systemPrompt = promptBuilder.buildSystemPrompt(
        BASE_SYSTEM_PROMPT, 
        memories,
        profile?.preferred_name,
        profile?.companion_personality
      );

      // 7. Assemble final LLM messages array (Pipeline Step 4)
      const messagesForLLM = [
        { role: 'system' as const, content: systemPrompt },
        ...recentMessages // recentMessages already includes the current user message because we saved it above!
      ];

      // 8. Call NVIDIA
      let reply: string;
      try {
        reply = await chatCompletion(messagesForLLM, {
          maxTokens: 512,
          temperature: 0.7,
        });
      } catch (nvidiaError) {
        throw new ExternalServiceError('NVIDIA', nvidiaError instanceof Error ? nvidiaError.message : String(nvidiaError));
      }

      // 9. Save AI Response to DB
      await supabaseAdmin
        .from('chat_history')
        .insert({
          user_id: userId,
          conversation_id: activeConversationId,
          role: 'assistant',
          content: reply
        });

      // 10. Background Memory Extraction (Fire & Forget)
      memoryExtractor.extractMemories(message).then(async (extracted) => {
        for (const mem of extracted) {
          if (mem.shouldPersist) {
            try {
              await memoryRepository.upsertMemory(userId, mem, userMessageId);
            } catch (err) {
              logger.error('Background memory save failed', { error: err instanceof Error ? err.message : String(err) });
            }
          }
        }
      }).catch(err => {
        logger.error('Background extraction failed entirely', { error: err.message });
      });

      // Return response
      res.status(200).json({
        reply,
        conversation_id: activeConversationId,
        meta: {
          memories_retrieved: memories.length,
          keywords_searched: keywords,
        }
      });
    } catch (err) {
      next(err);
    }
  }
);

// ── GET History ──────────────────────────────────────────────────────────────
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

      if (conversationId) {
        query = query.eq('conversation_id', conversationId);
      }

      const { data, error } = await query;
      if (error) throw new Error(error.message);

      res.status(200).json(data.reverse());
    } catch (err) {
      next(err);
    }
  }
);
