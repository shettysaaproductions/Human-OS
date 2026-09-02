import { Request, Response, NextFunction } from 'express';
import { logger } from '../lib/logger';

export const authenticateUser = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      if (process.env.NODE_ENV !== 'production' && req.headers['x-dev-user-id']) {
        (req as any).user = {
          id: req.headers['x-dev-user-id'],
          email: 'dev@local'
        };
        next();
        return;
      }
      res.status(401).json({ error: 'Missing or invalid Authorization header' });
      return;
    }

    const token = authHeader.split(' ')[1];
    
    // We import supabaseAnon dynamically or from lib to verify the token
    const { getSupabaseAnon } = await import('../lib/supabase');
    const supabase = getSupabaseAnon();
    const { data, error } = await supabase.auth.getUser(token);

    if (error || !data?.user) {
      res.status(401).json({ error: 'Unauthorized: Invalid token' });
      return;
    }

    (req as any).user = {
      id: data.user.id,
      email: data.user.email
    };

    next();
  } catch (err) {
    logger.error('Authentication middleware failed', { error: err instanceof Error ? err.message : String(err) });
    res.status(500).json({ error: 'Internal Server Error during authentication' });
  }
};
