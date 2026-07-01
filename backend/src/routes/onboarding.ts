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

    let answers: any = null;
    if (data.onboarding_completed) {
      const { data: memories } = await supabaseAdmin
        .from('memories')
        .select('key, value')
        .eq('user_id', userId)
        .in('key', ['passions_and_interests', 'current_goals', 'family_and_relationships', 'important_facts']);

      answers = {
        preferred_name: data.preferred_name || '',
        companion_personality: data.companion_personality || '',
        passions: memories?.find(m => m.key === 'passions_and_interests')?.value || '',
        goals: memories?.find(m => m.key === 'current_goals')?.value || '',
        family: memories?.find(m => m.key === 'family_and_relationships')?.value || '',
        important_facts: memories?.find(m => m.key === 'important_facts')?.value || ''
      };
    }

    res.status(200).json({
      onboarding_completed: data.onboarding_completed,
      preferred_name: data.preferred_name,
      companion_personality: data.companion_personality,
      answers
    });
  } catch (err) {
    logger.error('Failed to get onboarding status', { error: err instanceof Error ? err.message : String(err) });
    next(err);
  }
});
