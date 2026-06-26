/**
 * Global error-handling middleware.
 *
 * This must be the LAST middleware registered on the app (after all routes).
 * Express identifies error handlers by their 4-argument signature: (err, req, res, next).
 *
 * Design: Returns a consistent JSON shape regardless of error source.
 */

import { Request, Response, NextFunction } from 'express';
import { AppError } from '../types/errors';
import { logger } from '../lib/logger';
import { config } from '../config';

interface ErrorResponse {
  error: {
    code: string;
    message: string;
    stack?: string;
  };
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  // Operational errors (our AppError subclasses) are expected and handled gracefully
  if (err instanceof AppError) {
    logger.warn('Operational error', {
      code: err.code,
      statusCode: err.statusCode,
      path: req.path,
      method: req.method,
    });

    const body: ErrorResponse = {
      error: {
        code: err.code,
        message: err.message,
      },
    };

    res.status(err.statusCode).json(body);
    return;
  }

  // Unexpected errors — log with full stack, return 500
  logger.error('Unexpected error', {
    message: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
  });

  const body: ErrorResponse = {
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected error occurred. Please try again.',
      // Only expose stack in development
      ...(config.server.isProduction ? {} : { stack: err.stack }),
    },
  };

  res.status(500).json(body);
}
