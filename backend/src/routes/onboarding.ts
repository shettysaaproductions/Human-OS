import { Router, Request, Response, NextFunction } from 'express';
import { authenticateUser } from '../middleware/auth';
import { onboardingService, OnboardingAnswers } from '../services/onboardingService';
import { supabaseAdmin } from '../lib/supabase';
import { logger } from '../lib/logger';

export const onboardingRouter = Router();

/**
 * POST /onboarding
 * Receives the 6 onboarding answers, updates the profile, and injects seed memories.
 */
onboardingRouter.post('/', authenticateUser, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
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
onboardingRouter.get('/status', authenticateUser, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = (req as any).user!.id;

    const { data, error } = await supabaseAdmin
      .from('profiles')
      .select('onboarding_completed, preferred_name, companion_personality')
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
