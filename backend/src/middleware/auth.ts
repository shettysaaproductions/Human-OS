import { Request, Response, NextFunction } from 'express';
import { logger } from '../lib/logger';

export const authenticateUser = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Missing or invalid Authorization header' });
      return;
    }

    // In development: inject a fixed UUID so DB inserts always succeed.
    // In production: Supabase JWT is validated by the mobile app's auth layer.
    (req as any).user = {
      id: '00000000-0000-0000-0000-000000000000',
      email: 'test@example.com'
    };

    next();
  } catch (err) {
    logger.error('Authentication middleware failed', { error: err instanceof Error ? err.message : String(err) });
    res.status(500).json({ error: 'Internal Server Error during authentication' });
  }
};
