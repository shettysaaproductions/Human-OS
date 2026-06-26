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

// ── Boot sequence ─────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  logger.info('Starting HumanOS backend...', {
    version: config.server.appVersion,
    environment: config.server.nodeEnv,
  });

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
  });

  // ── Graceful shutdown ──────────────────────────────────────────────────────
  // Render sends SIGTERM before stopping a service — we want to finish
  // in-flight requests before closing.
  const shutdown = (signal: string) => {
    logger.info(`${signal} received — shutting down gracefully`);
    server.close(() => {
      logger.info('HTTP server closed');
      process.exit(0);
    });

    // Force exit if connections don't drain within 10 seconds
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
