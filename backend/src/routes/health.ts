/**
 * Health check routes.
 *
 * GET /health      — Basic liveness check (used by Render for deploy health checks).
 * GET /health/llm  — Deep check: pings NVIDIA API with a minimal prompt.
 *                    Use this to verify the NVIDIA integration is alive without
 *                    going through the full chat pipeline.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { config } from '../config';
import { chatCompletion } from '../lib/nvidia';
import { logger } from '../lib/logger';

export const healthRouter: import('express').Router = Router();

// ── GET /health ───────────────────────────────────────────────────────────────
healthRouter.get('/', (_req: Request, res: Response) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: config.server.appVersion,
  });
});

// ── GET /health/llm ───────────────────────────────────────────────────────────
// Sends a 1-token "ping" to NVIDIA and returns latency + model info.
// If NVIDIA is down or the key is invalid, this returns 502 with the reason.
// This saves hours of debugging connection issues in production.
healthRouter.get(
  '/llm',
  async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    const start = Date.now();

    try {
      logger.info('LLM health check initiated', { model: config.nvidia.chatModel });

      const reply = await chatCompletion(
        [
          { role: 'user', content: 'Reply with exactly one word: OK' },
        ],
        {
          maxTokens: 5,      // Minimal — just need proof of connectivity
          temperature: 0,
        },
      );

      const latencyMs = Date.now() - start;

      logger.info('LLM health check passed', {
        model: config.nvidia.chatModel,
        latency_ms: latencyMs,
      });

      res.status(200).json({
        status: 'ok',
        llm: {
          reachable: true,
          model: config.nvidia.chatModel,
          latency_ms: latencyMs,
          response_sample: reply.trim(),
        },
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      const latencyMs = Date.now() - start;
      const message = err instanceof Error ? err.message : 'Unknown error';

      logger.error('LLM health check failed', {
        model: config.nvidia.chatModel,
        latency_ms: latencyMs,
        error: message,
      });

      // Return 502 (not 500) — the server itself is fine, NVIDIA is not reachable
      res.status(502).json({
        status: 'error',
        llm: {
          reachable: false,
          model: config.nvidia.chatModel,
          latency_ms: latencyMs,
          error: message,
        },
        timestamp: new Date().toISOString(),
      });

      // Don't propagate to error handler — we've already responded
      void next;
    }
  },
);
