import { Request, Response, NextFunction } from 'express';
import { supabaseAdmin } from '../lib/supabase';
import { logger } from '../lib/logger';

export const authenticateUser = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Missing or invalid Authorization header' });
      return;
    }

    const token = authHeader.split(' ')[1];
    
    // We use supabaseAdmin here because it's a backend token verification step.
    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);

    if (error || !user) {
      logger.warn('Unauthorized request: invalid token', { error: error?.message });
      res.status(401).json({ error: 'Unauthorized: Invalid token' });
      return;
    }

    (req as any).user = {
      id: user.id,
      email: user.email || ''
    };

    next();
  } catch (err) {
    logger.error('Authentication middleware failed', { error: err instanceof Error ? err.message : String(err) });
    res.status(500).json({ error: 'Internal Server Error during authentication' });
  }
};
