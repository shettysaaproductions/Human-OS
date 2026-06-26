/**
 * HTTP request logger middleware using Morgan.
 *
 * Logs: method, path, status code, response time.
 * PII policy (PRD §17): does NOT log request bodies (may contain user message content).
 */

import morgan from 'morgan';
import { logger } from '../lib/logger';
import { config } from '../config';

// Pipe Morgan output through our Winston logger
const stream = {
  write: (message: string) => {
    logger.info(message.trim());
  },
};

// In production use 'combined' Apache format; in dev use 'dev' (colored, concise)
export const requestLogger = morgan(
  config.server.isProduction ? 'combined' : 'dev',
  { stream },
);
