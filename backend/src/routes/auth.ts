import { Router, Request, Response, NextFunction } from 'express';
import { supabaseAnon } from '../lib/supabase';
import { authenticateUser } from '../middleware/auth';
import { logger } from '../lib/logger';
import { config } from '../config';

export const authRouter = Router();

/**
 * POST /auth/signup
 */
authRouter.post('/signup', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      res.status(400).json({ error: 'Email and password are required' });
      return;
    }

    if (!config.supabase.url || !config.supabase.anonKey) {
      const errorMsg = 'Backend Error: SUPABASE_URL or SUPABASE_ANON_KEY is missing from environment variables.';
      logger.error('Signup failed: Supabase variables missing', { urlSet: !!config.supabase.url, anonKeySet: !!config.supabase.anonKey });
      res.status(500).json({ error: errorMsg });
      return;
    }

    logger.info('Attempting to sign up user with Supabase...', { email });
    const { data, error } = await supabaseAnon.auth.signUp({
      email,
      password,
    });

    if (error) {
      logger.error('Supabase auth.signUp returned an error', { error: error.message, status: error.status });
      res.status(400).json({ error: error.message });
      return;
    }

    res.status(201).json({
      user: data.user,
      access_token: data.session?.access_token || null,
      refresh_token: data.session?.refresh_token || null,
    });
  } catch (err) {
    logger.error('Signup completely failed due to an exception', { 
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined
    });
    res.status(500).json({ error: `Backend crash: ${err instanceof Error ? err.message : String(err)}` });
  }
});

/**
 * POST /auth/login
 */
authRouter.post('/login', async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      res.status(400).json({ error: 'Email and password are required' });
      return;
    }

    if (!config.supabase.url || !config.supabase.anonKey) {
      const errorMsg = 'Backend Error: SUPABASE_URL or SUPABASE_ANON_KEY is missing from environment variables.';
      logger.error('Login failed: Supabase variables missing', { urlSet: !!config.supabase.url, anonKeySet: !!config.supabase.anonKey });
      res.status(500).json({ error: errorMsg });
      return;
    }

    const { data, error } = await supabaseAnon.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      res.status(401).json({ error: error.message });
      return;
    }

    res.status(200).json({
      user: data.user,
      access_token: data.session?.access_token || null,
      refresh_token: data.session?.refresh_token || null,
    });
  } catch (err) {
    logger.error('Login completely failed due to an exception', { 
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined
    });
    // Return the EXACT error message to the client for debugging
    res.status(500).json({ error: `Backend crash: ${err instanceof Error ? err.message : String(err)}` });
  }
});

/**
 * POST /auth/logout
 */
authRouter.post('/logout', authenticateUser, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (token) {
      // For a purely stateless JWT API, logout is primarily handled by the client dropping the token.
      // We can attempt to sign out via the anon client if a session was active, but since we don't persist sessions, it's a no-op.
      await supabaseAnon.auth.signOut();
    }
    res.status(200).json({ success: true });
  } catch (err) {
    logger.error('Logout failed', { error: err instanceof Error ? err.message : String(err) });
    next(err);
  }
});

/**
 * GET /auth/me
 */
authRouter.get('/me', authenticateUser, (req: Request, res: Response): void => {
  res.status(200).json((req as any).user);
});
