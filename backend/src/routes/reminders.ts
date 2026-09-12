import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { ValidationError } from '../types/errors';
import { supabaseAdmin } from '../lib/supabase';
import crypto from 'crypto';

export const remindersRouter: import('express').Router = Router();

const CreateReminderSchema = z.object({
  text: z.string().min(1).max(1000),
  trigger_at: z.string().datetime().optional().nullable(),
  recurrence_type: z.enum(['minutes', 'hours', 'days', 'weeks', 'months', 'years']).optional().nullable(),
  recurrence_interval: z.number().int().positive().optional().nullable(),
  recurrence_limit: z.number().int().positive().optional().nullable(),
  active_days: z.array(z.string()).optional().nullable(),
  active_months: z.array(z.string()).optional().nullable(),
  active_year: z.number().int().optional().nullable(),
  urgency: z.enum(['low', 'medium', 'high']).optional().nullable(),
  notes: z.string().optional().nullable(),
  batch_count: z.number().int().positive().optional().nullable(),
  batch_interval_minutes: z.number().int().positive().optional().nullable()
});

const UpdateReminderSchema = z.object({
  text: z.string().min(1).max(1000).optional(),
  trigger_at: z.string().datetime().optional().nullable(),
  recurrence_type: z.enum(['minutes', 'hours', 'days', 'weeks', 'months', 'years']).optional().nullable(),
  recurrence_interval: z.number().int().positive().optional().nullable(),
  recurrence_limit: z.number().int().positive().optional().nullable(),
  active_days: z.array(z.string()).optional().nullable(),
  active_months: z.array(z.string()).optional().nullable(),
  active_year: z.number().int().optional().nullable(),
  urgency: z.enum(['low', 'medium', 'high']).optional().nullable(),
  status: z.enum(['active', 'completed', 'cancelled', 'expired', 'paused']).optional(),
  notes: z.string().optional().nullable()
});

/**
 * POST /reminders
 * Creates a new reminder (or batch of reminders) for the authenticated user.
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

      const data = parseResult.data;

      // Handle multi-step batch
      if (data.batch_count && data.batch_count > 1 && data.batch_interval_minutes) {
        const batchGroupId = crypto.randomUUID();
        const baseTime = data.trigger_at ? new Date(data.trigger_at).getTime() : Date.now();
        const rowsToInsert = [];

        for (let i = 1; i <= data.batch_count; i++) {
          const trigger = new Date(baseTime + i * data.batch_interval_minutes * 60 * 1000);
          rowsToInsert.push({
            user_id: userId,
            text: `${data.text} (step ${i}/${data.batch_count})`,
            trigger_at: trigger.toISOString(),
            status: 'active',
            is_auto: false,
            urgency: data.urgency || 'medium',
            batch_group_id: batchGroupId,
            accountability_status: 'pending',
            notes: data.notes || null,
            created_at: new Date().toISOString()
          });
        }

        const { data: insertedList, error } = await supabaseAdmin
          .from('reminders')
          .insert(rowsToInsert)
          .select('*');

        if (error) throw error;
        res.status(201).json({ success: true, reminders: insertedList, isBatch: true });
        return;
      }

      // Single or recurring reminder
      const triggerAtDate = data.trigger_at ? new Date(data.trigger_at) : new Date(Date.now() + 5 * 60 * 1000);

      const { data: reminder, error } = await supabaseAdmin
        .from('reminders')
        .insert({
          user_id: userId,
          text: data.text,
          trigger_at: triggerAtDate.toISOString(),
          recurrence_type: data.recurrence_type || null,
          recurrence_interval: data.recurrence_interval || null,
          recurrence_limit: data.recurrence_limit || null,
          active_days: data.active_days || null,
          active_months: data.active_months || null,
          active_year: data.active_year || null,
          urgency: data.urgency || 'medium',
          status: 'active',
          is_auto: false,
          accountability_status: 'pending',
          notes: data.notes || null,
          created_at: new Date().toISOString()
        })
        .select('*')
        .single();

      if (error) throw error;
      res.status(201).json({ success: true, reminder });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /reminders
 * Retrieves reminders for the authenticated user.
 * Optional query parameter: ?status=active|completed|all|recurring
 */
remindersRouter.get(
  '/',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = (req as any).user.id;
      const statusFilter = (req.query.status as string) || 'active';

      let query = supabaseAdmin
        .from('reminders')
        .select('*')
        .eq('user_id', userId);

      if (statusFilter === 'active') {
        query = query.eq('status', 'active');
      } else if (statusFilter === 'completed') {
        query = query.eq('status', 'completed');
      } else if (statusFilter === 'recurring') {
        query = query.eq('status', 'active').not('recurrence_type', 'is', null);
      } else if (statusFilter === 'all') {
        // No status filter
      } else {
        query = query.eq('status', statusFilter);
      }

      const { data: reminders, error } = await query.order('trigger_at', { ascending: true, nullsFirst: false });

      if (error) throw error;

      res.status(200).json({ success: true, reminders: reminders || [] });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * PATCH /reminders/:id
 * Updates an existing reminder (text, trigger_at, recurrence, days, months, urgency, status).
 */
remindersRouter.patch(
  '/:id',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = (req as any).user.id;
      const { id } = req.params;
      const parseResult = UpdateReminderSchema.safeParse(req.body);
      if (!parseResult.success) {
        throw new ValidationError(parseResult.error.issues[0]?.message ?? 'Invalid update parameters');
      }

      const updates: any = { ...parseResult.data, updated_at: new Date().toISOString() };

      const { data: updated, error } = await supabaseAdmin
        .from('reminders')
        .update(updates)
        .eq('id', id)
        .eq('user_id', userId)
        .select('*')
        .maybeSingle();

      if (error) throw error;
      if (!updated) {
        res.status(404).json({ success: false, error: 'Reminder not found' });
        return;
      }

      res.status(200).json({ success: true, reminder: updated });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /reminders/:id/complete
 * Marks a reminder as completed with accountability confirmation.
 */
remindersRouter.post(
  '/:id/complete',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = (req as any).user.id;
      const { id } = req.params;

      const { data: updated, error } = await supabaseAdmin
        .from('reminders')
        .update({
          status: 'completed',
          accountability_status: 'completed_confirmed',
          completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('id', id)
        .eq('user_id', userId)
        .select('*')
        .maybeSingle();

      if (error) throw error;
      if (!updated) {
        res.status(404).json({ success: false, error: 'Reminder not found' });
        return;
      }

      res.status(200).json({ success: true, reminder: updated });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * DELETE /reminders/:id
 * Cancels (soft-deletes) a reminder.
 */
remindersRouter.delete(
  '/:id',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = (req as any).user.id;
      const { id } = req.params;

      const { data, error } = await supabaseAdmin
        .from('reminders')
        .update({ status: 'cancelled', updated_at: new Date().toISOString() })
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
