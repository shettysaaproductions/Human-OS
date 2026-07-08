import { Router, Request, Response, NextFunction } from 'express';
import { onboardingService, OnboardingAnswers } from '../services/onboardingService';
import { supabaseAdmin } from '../lib/supabase';
import { logger } from '../lib/logger';

export const onboardingRouter: import('express').Router = Router();

/**
 * POST /onboarding
 * Receives the 6 onboarding answers, updates the profile, and injects seed memories.
 */
onboardingRouter.post('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = (req as any).user!.id;
    const answers: OnboardingAnswers = req.body;

    // Basic validation
    if (!answers || !answers.preferred_name) {
      res.status(400).json({ error: 'Missing required onboarding data' });
      return;
    }

    await onboardingService.processOnboarding(userId, answers);

    res.status(200).json({ success: true, redirect: '/chat' });
  } catch (err) {
    logger.error('Onboarding failed', { error: err instanceof Error ? err.message : String(err) });
    next(err);
  }
});

/**
 * GET /onboarding/status
 * Returns the current onboarding status for the user to help frontend routing.
 */
onboardingRouter.get('/status', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = (req as any).user!.id;

    const { data, error } = await supabaseAdmin
      .from('profiles')
      .select('onboarding_completed, preferred_name, companion_personality, country')
      .eq('id', userId)
      .single();

    if (error && error.code !== 'PGRST116') { // PGRST116 is 'no rows returned'
      res.status(500).json({ error: 'Failed to fetch onboarding status' });
      return;
    }

    if (!data) {
      // Profile doesn't exist yet
      res.status(200).json({
        onboarding_completed: false,
        preferred_name: null,
        companion_personality: null
      });
      return;
    }

    res.status(200).json(data);
  } catch (err) {
    logger.error('Failed to get onboarding status', { error: err instanceof Error ? err.message : String(err) });
    next(err);
  }
});
/**
 * PATCH /onboarding/profile
 * Updates individual profile fields (country, preferred_name, companion_personality, etc.)
 * without requiring a full onboarding re-submission.
 */
onboardingRouter.patch('/profile', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = (req as any).user!.id;
    const ALLOWED_FIELDS = ['country', 'preferred_name', 'companion_personality'];

    // Only pick fields that are explicitly allowed — never let raw body touch the DB directly
    const updates: Record<string, string> = {};
    for (const field of ALLOWED_FIELDS) {
      if (req.body[field] !== undefined && typeof req.body[field] === 'string') {
        updates[field] = req.body[field].trim().substring(0, 100); // max 100 chars per field
      }
    }

    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: 'No valid fields provided' });
      return;
    }

    const { error } = await supabaseAdmin
      .from('profiles')
      .update(updates)
      .eq('id', userId);

    if (error) {
      logger.error('Profile patch failed', { userId, error: error.message });
      res.status(500).json({ error: 'Failed to update profile' });
      return;
    }

    logger.info('Profile patched', { userId, fields: Object.keys(updates) });
    res.status(200).json({ success: true, updated: Object.keys(updates) });
  } catch (err) {
    logger.error('Profile patch error', { error: err instanceof Error ? err.message : String(err) });
    next(err);
  }
});
