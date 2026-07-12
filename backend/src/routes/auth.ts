import { Router, Request, Response } from 'express';
import { supabaseAnon, supabaseAdmin } from '../lib/supabase';
import { authenticateUser } from '../middleware/auth';
import { logger } from '../lib/logger';
import { config } from '../config';
import { cache } from '../lib/cache';

export const authRouter: import('express').Router = Router();

/**
 * POST /auth/signup
 */
authRouter.post('/signup', async (req: Request, res: Response): Promise<void> => {
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

    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('onboarding_completed')
      .eq('id', data.user.id)
      .maybeSingle();

    res.status(200).json({
      user: {
        ...data.user,
        onboardingCompleted: profile?.onboarding_completed || false,
      },
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
 * POST /auth/refresh
 * Exchanges a Supabase refresh_token for a new access_token + refresh_token pair.
 * Called automatically by the mobile app's axios interceptor when a 401 is received.
 */
authRouter.post('/refresh', async (req: Request, res: Response): Promise<void> => {
  try {
    const { refresh_token } = req.body;
    if (!refresh_token) {
      res.status(400).json({ error: 'refresh_token is required' });
      return;
    }

    const { data, error } = await supabaseAnon.auth.refreshSession({ refresh_token });

    if (error || !data.session) {
      logger.warn('Token refresh failed', { error: error?.message });
      res.status(401).json({ error: 'Session expired. Please log in again.' });
      return;
    }

    logger.info('Token refreshed successfully', { userId: data.user?.id });
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('onboarding_completed')
      .eq('id', data.user?.id)
      .maybeSingle();

    res.status(200).json({
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      user: {
        ...data.user,
        onboardingCompleted: profile?.onboarding_completed || false,
      },
    });
  } catch (err) {
    logger.error('Token refresh crashed', { error: err instanceof Error ? err.message : String(err) });
    res.status(500).json({ error: 'Internal Server Error during token refresh' });
  }
});

/**
 * POST /auth/logout
 */
authRouter.post('/logout', authenticateUser, async (req: Request, res: Response): Promise<void> => {
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
    res.status(500).json({ error: 'Logout failed' });
  }
});

/**
 * GET /auth/me
 */
authRouter.get('/me', authenticateUser, async (req: Request, res: Response): Promise<void> => {
  try {
    const user = (req as any).user;
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('onboarding_completed')
      .eq('id', user.id)
      .maybeSingle();

    res.status(200).json({
      id: user.id,
      email: user.email,
      name: user.user_metadata?.name || null,
      onboardingCompleted: profile?.onboarding_completed || false,
    });
  } catch (err) {
    logger.error('Failed to fetch /me', { error: err instanceof Error ? err.message : String(err) });
    res.status(500).json({ error: 'Failed to fetch user profile' });
  }
});

/**
 * POST /auth/push-token
 * Saves the user's Expo Push Token so Nova can send notifications to their device.
 */
authRouter.post('/push-token', authenticateUser, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req as any).user?.id;
    const { token } = req.body;

    if (!token || !token.startsWith('ExponentPushToken[')) {
      res.status(400).json({ error: 'Invalid push token format' });
      return;
    }

    const { error } = await supabaseAdmin
      .from('profiles')
      .update({ push_token: token, push_token_updated_at: new Date().toISOString() })
      .eq('id', userId);

    if (error) {
      logger.error('Failed to save push token', { error: error.message, userId });
      res.status(500).json({ error: 'Failed to save push token' });
      return;
    }

    logger.info('Push token registered', { userId });
    // Invalidate profile cache so next chat request reads the fresh push_token
    cache.invalidate(`profile:${userId}`);
    res.status(200).json({ success: true });
  } catch (err) {
    logger.error('Failed to register push token', { error: err instanceof Error ? err.message : String(err) });
    res.status(500).json({ error: 'Internal server error' });
  }
});

