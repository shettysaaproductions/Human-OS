/**
 * Server entry point.
 *
 * Responsibilities:
 * 1. Validate environment variables (via config import — throws on bad config).
 * 2. Create the Express app.
 * 3. Start listening on the configured port.
 * 4. Handle uncaught exceptions and unhandled rejections gracefully.
 */

import { createApp } from './app';
import { config } from './config';
import { logger } from './lib/logger';
import { startWorkers } from './workers/queueWorker';
import { momentEngineService } from './services/MomentEngineService';
import { reflectionScheduler } from './services/ReflectionSchedulerService';
import { reminderSchedulerService } from './services/ReminderSchedulerService';
import { shortTermMemoryCleanupService } from './services/ShortTermMemoryCleanupService';
import https from 'https';
import http from 'http';

// ── Self-Ping Keep-Alive ───────────────────────────────────────────────────────
// Render free tier sleeps after 15 minutes of inactivity.
// This pings our own /health endpoint every 13 minutes to prevent cold starts FOREVER.
function startKeepAlive(): void {
  const RENDER_SERVICE_URL = process.env.RENDER_EXTERNAL_URL || '';
  const PING_INTERVAL_MS = 13 * 60 * 1000; // 13 minutes

  if (!RENDER_SERVICE_URL) {
    logger.info('[KeepAlive] RENDER_EXTERNAL_URL not set — skipping self-ping (local dev)');
    return;
  }

  const pingUrl = `${RENDER_SERVICE_URL}/health`;
  logger.info(`[KeepAlive] Starting self-ping every 13 minutes → ${pingUrl}`);

  const pingFn = () => {
    const client = pingUrl.startsWith('https') ? https : http;
    const req = client.get(pingUrl, (res) => {
      logger.info(`[KeepAlive] Self-ping OK — status ${res.statusCode}`);
    });
    req.on('error', (err) => {
      logger.warn(`[KeepAlive] Self-ping failed: ${err.message}`);
    });
    req.setTimeout(10000, () => {
      req.destroy();
      logger.warn('[KeepAlive] Self-ping timed out');
    });
  };

  // First ping after 1 minute (let server fully boot)
  setTimeout(pingFn, 60_000);

  const keepAliveInterval = setInterval(pingFn, PING_INTERVAL_MS);
  if (keepAliveInterval.unref) keepAliveInterval.unref();
}

// ── Boot sequence ─────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  logger.info('Starting HumanOS backend...', {
    version: config.server.appVersion,
    environment: config.server.nodeEnv,
  });

  // Initialize Background Queue Workers
  startWorkers();

  // Start Moment Engine Scheduler (runs once every 24 hours)
  const momentInterval = setInterval(async () => {
    try {
      logger.info('Scheduler: Triggering daily Moment Engine checks...');
      await momentEngineService.runEngineForAllUsers();
    } catch (err) {
      logger.error('Error in Moment Engine scheduled run', { error: err instanceof Error ? err.message : String(err) });
    }
  }, 24 * 60 * 60 * 1000);
  if (momentInterval.unref) momentInterval.unref();

  // Reminders Polling Engine (runs every 10 seconds)
  const remindersInterval = setInterval(async () => {
    try {
      await reminderSchedulerService.checkAndFireReminders();
    } catch (err) {
      logger.error('Error in scheduled reminders check run', { error: err instanceof Error ? err.message : String(err) });
    }
  }, 10 * 1000);
  if (remindersInterval.unref) remindersInterval.unref();

  // Daily Reflection Scheduler (runs once per day)
  const dailyReflectionInterval = setInterval(async () => {
    try {
      logger.info('Scheduler: Triggering daily reflections...');
      await reflectionScheduler.runDailyForAllUsers();
      await shortTermMemoryCleanupService.run();
    } catch (err) {
      logger.error('Error in daily scheduled run', { error: err instanceof Error ? err.message : String(err) });
    }
  }, 24 * 60 * 60 * 1000);
  if (dailyReflectionInterval.unref) dailyReflectionInterval.unref();

  // Weekly Reflection Scheduler (runs on Sundays)
  const weeklyReflectionInterval = setInterval(async () => {
    const day = new Date().getDay();
    if (day === 0) {
      try {
        logger.info('Scheduler: Triggering weekly reflections...');
        await reflectionScheduler.runWeeklyForAllUsers();
      } catch (err) {
        logger.error('Error in weekly reflection scheduled run', { error: err instanceof Error ? err.message : String(err) });
      }
    }
  }, 24 * 60 * 60 * 1000);
  if (weeklyReflectionInterval.unref) weeklyReflectionInterval.unref();

  const app = createApp();

  const server = app.listen(config.server.port, () => {
    logger.info(`Server is running`, {
      port: config.server.port,
      environment: config.server.nodeEnv,
    });
    logger.info('Endpoints ready', {
      health: `GET  http://localhost:${config.server.port}/health`,
      chatTest: `POST http://localhost:${config.server.port}/chat/test`,
    });

    // Start keep-alive AFTER server is fully listening
    startKeepAlive();
  });

  // ── Graceful shutdown ──────────────────────────────────────────────────────
  const shutdown = (signal: string) => {
    logger.info(`${signal} received — shutting down gracefully`);
    server.close(() => {
      logger.info('HTTP server closed');
      process.exit(0);
    });
    setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, 10_000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

// ── Safety nets ───────────────────────────────────────────────────────────────
process.on('uncaughtException', (err: Error) => {
  logger.error('Uncaught exception — shutting down', {
    message: err.message,
    stack: err.stack,
  });
  process.exit(1);
});

process.on('unhandledRejection', (reason: unknown) => {
  logger.error('Unhandled promise rejection — shutting down', {
    reason: String(reason),
  });
  process.exit(1);
});

main().catch((err: Error) => {
  logger.error('Failed to start server', {
    message: err.message,
    stack: err.stack,
  });
  process.exit(1);
});
