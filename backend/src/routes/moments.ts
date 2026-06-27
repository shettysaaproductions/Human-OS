import { Router, Request, Response, NextFunction } from 'express';
import { momentEngineService } from '../services/MomentEngineService';
import { supabaseAdmin } from '../lib/supabase';
import { qt } from '../lib/queryTracker';
import { z } from 'zod';
import { ValidationError } from '../types/errors';

export const momentsRouter: import('express').Router = Router();

const UpdatePreferencesSchema = z.object({
  goal_followups_enabled: z.boolean().optional(),
  child_milestones_enabled: z.boolean().optional(),
  quiet_hours: z.string().regex(/^\d{2}:\d{2}-\d{2}:\d{2}$/, 'Invalid quiet hours format. Must be HH:MM-HH:MM').optional()
});

/**
 * GET /moments
 * Retrieves recent moment notifications for the authenticated user.
 */
momentsRouter.get('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = (req as any).user.id;
    const { data, error } = await qt.track('moment_route_get_all', 'user_moments', () =>
      supabaseAdmin
        .from('user_moments')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(20)
    );

    if (error) throw error;
    res.status(200).json({ success: true, moments: data });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /moments/preferences
 * Retrieves user moment notification preferences.
 */
momentsRouter.get('/preferences', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = (req as any).user.id;
    const prefs = await momentEngineService.getPreferences(userId);
    res.status(200).json({ success: true, preferences: prefs });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /moments/preferences
 * Updates user moment notification preferences.
 */
momentsRouter.put('/preferences', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = (req as any).user.id;
    const parseResult = UpdatePreferencesSchema.safeParse(req.body);
    if (!parseResult.success) {
      throw new ValidationError(parseResult.error.issues[0]?.message ?? 'Invalid preference parameters');
    }

    const updated = await momentEngineService.updatePreferences(userId, parseResult.data);
    res.status(200).json({ success: true, preferences: updated });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /moments/:id/open
 * Tracks that a user opened a moment.
 */
momentsRouter.post('/:id/open', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const momentId = req.params.id;
    await momentEngineService.trackMomentStatus(momentId, 'opened');
    res.status(200).json({ success: true, message: 'Moment status updated to opened.' });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /moments/:id/dismiss
 * Tracks that a user dismissed a moment.
 */
momentsRouter.post('/:id/dismiss', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const momentId = req.params.id;
    await momentEngineService.trackMomentStatus(momentId, 'dismissed');
    res.status(200).json({ success: true, message: 'Moment status updated to dismissed.' });
  } catch (err) {
    next(err);
  }
});
