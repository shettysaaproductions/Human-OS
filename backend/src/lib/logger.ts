/**
 * Application logger using Winston.
 *
 * Design decisions:
 * - Structured JSON in production (machine-parseable by Render log drains).
 * - Human-readable colorized output in development.
 * - Follows PRD Section 17: log levels, required fields, and PII rules.
 *
 * PII POLICY (PRD §17): Never log raw message content, emails, names,
 * JWT tokens, or memory content. Only log hashed user IDs.
 */

import winston from 'winston';
import { config } from '../config';
import crypto from 'crypto';

const { combine, timestamp, errors, json, colorize, printf } = winston.format;

// ── Development format: human-readable ────────────────────────────────────────
const devFormat = combine(
  colorize(),
  timestamp({ format: 'HH:mm:ss' }),
  errors({ stack: true }),
  printf(({ level, message, timestamp: ts, ...meta }) => {
    const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
    return `${ts} [${level}] ${message}${metaStr}`;
  }),
);

// ── Production format: structured JSON ────────────────────────────────────────
const prodFormat = combine(
  timestamp(),
  errors({ stack: true }),
  json(),
);

export const logger = winston.createLogger({
  level: config.server.isProduction ? 'info' : 'debug',
  format: config.server.isProduction ? prodFormat : devFormat,
  transports: [
    new winston.transports.Console(),
  ],
  // Do not exit on uncaught exceptions — let Express handle them
  exitOnError: false,
});

/**
 * Hash a user ID for safe logging.
 * Use this instead of logging raw user IDs.
 */
export function hashUserId(userId: string): string {
  return crypto
    .createHash('sha256')
    .update(userId)
    .digest('hex')
    .substring(0, 12);
}
