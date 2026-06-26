/**
 * POST /chat/test
 *
 * Phase 1 proof-of-concept endpoint.
 * Proves the full pipeline: Client → Backend → NVIDIA API → Response.
 *
 * No auth. No memory. No conversation persistence.
 * This is intentionally minimal — it validates the NVIDIA integration works.
 *
 * Request body:  { "message": "Hello" }
 * Response body: { "reply": "AI response text" }
 */

import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { chatCompletion } from '../lib/nvidia';
import { logger } from '../lib/logger';
import { ValidationError, ExternalServiceError } from '../types/errors';
import { config } from '../config';

export const chatRouter: import('express').Router = Router();

// ── Input validation schema ────────────────────────────────────────────────────
const ChatTestSchema = z.object({
  message: z
    .string({
      required_error: 'message is required',
      invalid_type_error: 'message must be a string',
    })
    .min(1, 'message cannot be empty')
    .max(4000, 'message cannot exceed 4000 characters'),
});

// ── System prompt for Phase 1 test ────────────────────────────────────────────
// Minimal but well-formed. Full companion system prompt is built in Phase 2.
const PHASE1_SYSTEM_PROMPT = `You are a warm, curious AI companion called Nova.
You are speaking with someone for the first time.
Be friendly, concise, and genuine. Ask one follow-up question.
Never say "As an AI..." — you are Nova, not a generic chatbot.`;

// ── Route handler ──────────────────────────────────────────────────────────────
chatRouter.post(
  '/test',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const startTime = Date.now();

    try {
      // 1. Validate input
      const parseResult = ChatTestSchema.safeParse(req.body);
      if (!parseResult.success) {
        const firstError = parseResult.error.issues[0];
        throw new ValidationError(firstError?.message ?? 'Invalid request body');
      }

      const { message } = parseResult.data;

      // 2. Log the NVIDIA call (PRD §17) — never log raw message content
      logger.info('NVIDIA API call initiated', {
        endpoint: '/chat/test',
        model: config.nvidia.chatModel,
      });

      // 3. Call NVIDIA API
      let reply: string;
      try {
        reply = await chatCompletion(
          [
            { role: 'system', content: PHASE1_SYSTEM_PROMPT },
            { role: 'user', content: message },
          ],
          {
            maxTokens: 512,
            temperature: 0.7,
          },
        );
      } catch (nvidiaError) {
        const errorMessage =
          nvidiaError instanceof Error ? nvidiaError.message : 'Unknown error';

        logger.error('NVIDIA API failure', {
          endpoint: '/chat/test',
          error_message: errorMessage,
          retry_count: 0,
        });

        throw new ExternalServiceError('NVIDIA', errorMessage);
      }

      const durationMs = Date.now() - startTime;

      // 4. Log success (PRD §17) — log tokens_out approximation via word count
      logger.info('NVIDIA API call completed', {
        endpoint: '/chat/test',
        model: config.nvidia.chatModel,
        duration_ms: durationMs,
        success: true,
      });

      // 5. Return response
      res.status(200).json({ reply });
    } catch (err) {
      next(err);
    }
  },
);
