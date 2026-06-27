/**
 * Express application factory.
 *
 * Separated from server startup (index.ts) so the app can be tested
 * in isolation without binding to a port.
 */

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

import { config } from './config';
import { requestLogger } from './middleware/requestLogger';
import { errorHandler } from './middleware/errorHandler';
import { healthRouter } from './routes/health';
import { chatRouter } from './routes/chat';
import { memoryDebugRouter } from './routes/memoryDebug';
import { authRouter } from './routes/auth';
import { onboardingRouter } from './routes/onboarding';
import { diagnosticsRouter } from './routes/diagnostics';
import { adminRouter } from './routes/admin';
import { momentsRouter } from './routes/moments';
import { analyticsRouter } from './routes/analytics';
import { founderRouter } from './routes/founder';
import { memoryManagementRouter } from './routes/memoryManagement';
import { feedbackRouter } from './routes/feedback';
import { telemetryRouter } from './routes/telemetry';
import { exportRouter } from './routes/export';
import { betaAnalyticsRouter } from './routes/betaAnalytics';
import { dbHealthService } from './services/DatabaseHealthService';
import { degradedMode } from './services/DegradedModeService';
import { authenticateUser } from './middleware/auth';
import { logger } from './lib/logger';

export function createApp(): express.Application {
  const app = express();

  // ── Security headers (Helmet) ────────────────────────────────────────────────
  // Sets X-Content-Type-Options, X-Frame-Options, Strict-Transport-Security, etc.
  app.use(helmet());

  // ── CORS ────────────────────────────────────────────────────────────────────
  app.use(
    cors({
      origin: (origin, callback) => {
        // Allow requests with no origin (e.g., curl, Postman, mobile apps)
        if (!origin) {
          callback(null, true);
          return;
        }
        if (config.cors.origins.includes(origin)) {
          callback(null, true);
        } else {
          logger.warn('CORS blocked origin', { origin });
          callback(new Error(`CORS: origin ${origin} not allowed`));
        }
      },
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
      credentials: true,
    }),
  );

  // ── Body parsers ─────────────────────────────────────────────────────────────
  // Limit body size to 10kb — prevents large payload attacks
  app.use(express.json({ limit: '10kb' }));
  app.use(express.urlencoded({ extended: false }));

  // ── Global rate limiter ──────────────────────────────────────────────────────
  // 100 requests per 15 minutes per IP — adjust per-route as needed
  const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many requests. Please wait and try again.',
      },
    },
  });
  app.use(globalLimiter);

  // ── Stricter rate limit for AI endpoints ─────────────────────────────────────
  // NVIDIA API has rate limits on free tier — protect it aggressively
  const chatLimiter = rateLimit({
    windowMs: 60 * 1000,        // 1 minute
    max: 10,                    // 10 AI requests per minute per IP
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'AI rate limit reached. Please wait a moment before sending another message.',
      },
    },
  });

  // ── Request logger ───────────────────────────────────────────────────────────
  app.use(requestLogger);

  // ── Routes ───────────────────────────────────────────────────────────────────
  app.use('/health', healthRouter);
  app.use('/auth', authRouter);
  app.use('/onboarding', authenticateUser, onboardingRouter);
  app.use('/chat', authenticateUser, chatLimiter, chatRouter);
  app.use('/memory/debug', authenticateUser, memoryDebugRouter);
  app.use('/admin/diagnostics', authenticateUser, diagnosticsRouter);
  app.use('/admin', authenticateUser, adminRouter);
  app.use('/moments', authenticateUser, momentsRouter);
  app.use('/analytics', authenticateUser, analyticsRouter);
  app.use('/analytics/overview', authenticateUser, founderRouter);
  app.use('/founder', authenticateUser, founderRouter);
  app.use('/memories', authenticateUser, memoryManagementRouter);
  app.use('/memories', authenticateUser, exportRouter);
  app.use('/feedback', authenticateUser, feedbackRouter);
  app.use('/telemetry', authenticateUser, telemetryRouter);
  app.use('/admin/errors', authenticateUser, telemetryRouter);
  app.use('/admin/beta', authenticateUser, betaAnalyticsRouter);

  // ── 404 handler ──────────────────────────────────────────────────────────────
  app.use((_req, res) => {
    res.status(404).json({
      error: {
        code: 'NOT_FOUND',
        message: 'The requested endpoint does not exist.',
      },
    });
  });

  // ── Global error handler (must be LAST) ──────────────────────────────────────
  app.use(errorHandler);

  // ── Background health checker ────────────────────────────────────────────────
  // Runs every 30s: checks DB health, fires alerts, drains degraded queue on recovery
  const healthInterval = setInterval(async () => {
    const report = await dbHealthService.check();
    if (report.status === 'online') {
      const queueSize = degradedMode.queueSize();
      if (queueSize > 0) {
        const result = await degradedMode.drain();
        if (result.success > 0) {
          // Invalidate diagnostics cache after drain
          const { cache } = await import('./lib/cache');
          cache.invalidateNamespace('diagnostics');
        }
      }
    }
  }, 30_000);
  if (healthInterval.unref) healthInterval.unref();

  return app;
}
