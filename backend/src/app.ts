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
import { remindersRouter } from './routes/reminders';
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

  const apiRouter = express.Router();
  
  apiRouter.use('/health', healthRouter);
  apiRouter.use('/auth', authRouter);
  apiRouter.use('/onboarding', authenticateUser, onboardingRouter);
  apiRouter.use('/chat', authenticateUser, chatLimiter, chatRouter);
  apiRouter.use('/memory/debug', authenticateUser, memoryDebugRouter);
  apiRouter.use('/admin/diagnostics', authenticateUser, diagnosticsRouter);
  apiRouter.use('/admin', authenticateUser, adminRouter);
  apiRouter.use('/moments', authenticateUser, momentsRouter);
  apiRouter.use('/reminders', authenticateUser, remindersRouter);
  apiRouter.use('/analytics', authenticateUser, analyticsRouter);
  apiRouter.use('/analytics/overview', authenticateUser, founderRouter);
  apiRouter.use('/founder', authenticateUser, founderRouter);
  apiRouter.use('/memories', authenticateUser, memoryManagementRouter);
  apiRouter.use('/memories', authenticateUser, exportRouter);
  apiRouter.use('/feedback', authenticateUser, feedbackRouter);
  apiRouter.use('/telemetry', authenticateUser, telemetryRouter);
  apiRouter.use('/admin/errors', authenticateUser, telemetryRouter);
  apiRouter.use('/admin/beta', authenticateUser, betaAnalyticsRouter);

  // Mount the API router
  app.use('/api', apiRouter);

  // Also mount health at the root for Render health checks
  app.use('/health', healthRouter);

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
