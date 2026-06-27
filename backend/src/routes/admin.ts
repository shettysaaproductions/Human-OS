import { Router, Request, Response, NextFunction } from 'express';
import { supabaseAdmin } from '../lib/supabase';
import { reflectionQueue } from '../services/QueueService';
import { memoryDecayService } from '../services/MemoryDecayService';

export const adminRouter: import('express').Router = Router();

/**
 * Triggers a reflection for all users who had activity today.
 * In production, this would be called by pg_cron or a scheduled task.
 */
adminRouter.post('/trigger-reflection', async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const today = new Date().toISOString().split('T')[0];
    
    // Find all users who sent a message today
    const { data: sessions, error } = await supabaseAdmin
      .from('conversation_sessions')
      .select('user_id')
      .eq('session_date', today)
      .gt('message_count', 0);

    if (error) throw error;

    let enqueued = 0;
    if (sessions && sessions.length > 0) {
      for (const session of sessions) {
        await reflectionQueue.add('daily_reflection', {
          userId: session.user_id,
          messageId: `daily_reflection_${session.user_id}_${today}`, // used for idempotency
          date: today
        });
        enqueued++;
      }
    }

    res.status(200).json({ success: true, users_enqueued: enqueued });
  } catch (err) {
    next(err);
  }
});

/**
 * Triggers the memory decay process.
 */
adminRouter.post('/trigger-decay', async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const archivedCount = await memoryDecayService.processWeeklyDecay();
    res.status(200).json({ success: true, archived_count: archivedCount });
  } catch (err) {
    next(err);
  }
});
