import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { ValidationError } from '../types/errors';
import { reminderSchedulerService } from '../services/ReminderSchedulerService';
import { supabaseAdmin } from '../lib/supabase';

export const remindersRouter: import('express').Router = Router();

const CreateReminderSchema = z.object({
  text: z.string().min(1).max(1000),
  trigger_at: z.string().datetime(),
  recurrence_type: z.enum(['hours', 'days']).optional().nullable(),
  recurrence_interval: z.number().int().positive().optional().nullable()
});

/**
 * POST /reminders
 * Creates a new reminder for the authenticated user.
 */
remindersRouter.post(
  '/',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = (req as any).user.id;
      const parseResult = CreateReminderSchema.safeParse(req.body);
      if (!parseResult.success) {
        throw new ValidationError(parseResult.error.issues[0]?.message ?? 'Invalid reminder parameters');
      }

      const { text, trigger_at, recurrence_type, recurrence_interval } = parseResult.data;
      const triggerAtDate = new Date(trigger_at);

      const reminder = await reminderSchedulerService.scheduleReminder(
        userId,
        text,
        triggerAtDate,
        recurrence_type || undefined,
        recurrence_interval || undefined
      );

      res.status(201).json({ success: true, reminder });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /reminders
 * Retrieves all active reminders for the authenticated user.
 */
remindersRouter.get(
  '/',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = (req as any).user.id;
      const { data: reminders, error } = await supabaseAdmin
        .from('reminders')
        .select('*')
        .eq('user_id', userId)
        .order('trigger_at', { ascending: true });

      if (error) throw error;

      res.status(200).json({ success: true, reminders });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * DELETE /reminders/:id
 * Cancels (deletes) a reminder.
 */
remindersRouter.delete(
  '/:id',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = (req as any).user.id;
      const { id } = req.params;

      const { data, error } = await supabaseAdmin
        .from('reminders')
        .update({ status: 'canceled', updated_at: new Date().toISOString() })
        .eq('id', id)
        .eq('user_id', userId)
        .select('id')
        .maybeSingle();

      if (error) throw error;
      if (!data) {
        res.status(404).json({ success: false, error: 'Reminder not found' });
        return;
      }

      res.status(200).json({ success: true, message: 'Reminder canceled successfully.' });
    } catch (err) {
      next(err);
    }
  }
);
