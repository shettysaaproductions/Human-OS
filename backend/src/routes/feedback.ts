import { Router, Request, Response, NextFunction } from 'express';
import { supabaseAdmin } from '../lib/supabase';
import { logger } from '../lib/logger';

export const feedbackRouter = Router();

// POST /feedback — store user feedback
feedbackRouter.post('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }

    const { feedback_type, message, rating } = req.body;

    if (!feedback_type || !message) {
      res.status(400).json({ error: 'feedback_type and message are required' });
      return;
    }

    const { data, error } = await supabaseAdmin
      .from('user_feedback')
      .insert({
        user_id: userId,
        feedback_type,
        message: message.trim(),
        rating: rating ?? null,
      })
      .select('id')
      .single();

    if (error) throw error;

    logger.info('Feedback submitted', { userId, feedback_type, rating });

    res.status(201).json({ success: true, id: data.id });
  } catch (err) {
    logger.error('Failed to store feedback', { error: err instanceof Error ? err.message : String(err) });
    next(err);
  }
});

// GET /feedback — list feedback (admin use)
feedbackRouter.get('/', async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { data, error } = await supabaseAdmin
      .from('user_feedback')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) throw error;
    res.status(200).json({ success: true, data: data || [] });
  } catch (err) {
    next(err);
  }
});
