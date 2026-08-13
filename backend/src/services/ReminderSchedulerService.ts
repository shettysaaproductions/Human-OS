import { supabaseAdmin } from '../lib/supabase';
import { logger } from '../lib/logger';
import { sendPushNotification } from '../lib/pushNotifications';
import crypto from 'crypto';

export class ReminderSchedulerService {
  // Overlap guard: fireReminder generates a warm LLM message per reminder, which can exceed
  // the 10s poll interval. Without this guard two overlapping polls fetch the SAME due
  // reminders and fire them twice (double chat insert + push). Only one poll runs at a time.
  private _isChecking = false;

  /**
   * Schedule a reminder by creating a database record
   */
  async scheduleReminder(userId: string, text: string, triggerAt: Date, recurrenceType?: string, recurrenceInterval?: number, recurrenceLimit?: number): Promise<any> {
    const { data: reminder, error } = await supabaseAdmin
      .from('reminders')
      .insert({
        user_id: userId,
        text,
        trigger_at: triggerAt.toISOString(),
        recurrence_type: recurrenceType || null,
        recurrence_interval: recurrenceInterval || null,
        recurrence_limit: recurrenceLimit || null,
        status: 'active'
      })
      .select('*')
      .single();

    if (error) throw error;
    return reminder;
  }

  /**
   * Check and fire any active reminders that are due
   */
  async checkAndFireReminders(): Promise<void> {
    if (this._isChecking) {
      logger.warn('[Reminder] checkAndFireReminders skipped — previous poll still running');
      return;
    }
    this._isChecking = true;
    try {
      const now = new Date();
      const { data: dueReminders, error } = await supabaseAdmin
        .from('reminders')
        .select('*')
        .eq('status', 'active')
        .lte('trigger_at', now.toISOString());

      if (error) {
        logger.error('Failed to fetch due reminders', { error: error.message });
        return;
      }

      if (dueReminders && dueReminders.length > 0) {
        logger.info(`Found ${dueReminders.length} due reminders to process`);
        for (const reminder of dueReminders) {
          try {
            await this.fireReminder(reminder.id);
          } catch (err) {
            logger.error('Failed to fire reminder', { reminderId: reminder.id, error: err instanceof Error ? err.message : String(err) });
          }
        }
      }
    } catch (err) {
      logger.error('Error during checkAndFireReminders execution', { error: err instanceof Error ? err.message : String(err) });
    } finally {
      this._isChecking = false;
    }
  }

  /**
   * Fire all active reminders tied to a life event (EventDetector).
   * "I just left the office" → EventDetector.fire({event: "left_the_office"})
   * → any reminder with event_trigger = "left_the_office" fires now.
   * Reuses fireReminder: event reminders have trigger_at = NULL (epoch) so the
   * future-check passes, and no recurrence so they complete after firing.
   * Returns how many reminders were fired.
   */
  async fireEvent(userId: string, event: string): Promise<number> {
    try {
      if (!event) return 0;
      const { data: reminders, error } = await supabaseAdmin
        .from('reminders')
        .select('id')
        .eq('user_id', userId)
        .eq('status', 'active')
        .ilike('event_trigger', event); // case-insensitive — Nova echoes the stored string

      if (error) {
        logger.error('[ReminderScheduler] Failed to query event reminders', { userId, event, error: error.message });
        return 0;
      }
      if (!reminders || reminders.length === 0) return 0;

      logger.info(`[ReminderScheduler] Event "${event}" fired — ${reminders.length} reminder(s)`, { userId });
      let fired = 0;
      for (const r of reminders) {
        try {
          await this.fireReminder(r.id);
          fired++;
        } catch (err) {
          logger.error('[ReminderScheduler] Failed to fire event reminder', {
            id: r.id, error: err instanceof Error ? err.message : String(err)
          });
        }
      }
      return fired;
    } catch (err) {
      logger.error('[ReminderScheduler] fireEvent error', {
        userId, event, error: err instanceof Error ? err.message : String(err)
      });
      return 0;
    }
  }

  /**
   * Fires the reminder:
   * 1. Inserts a Moment entry.
   * 2. Inserts an assistant message into the user's latest conversation history.
   * 3. Updates reminder status (or schedules next occurrence).
   */
  async fireReminder(reminderId: string): Promise<void> {
    const { data: reminder, error } = await supabaseAdmin
      .from('reminders')
      .select('*')
      .eq('id', reminderId)
      .eq('status', 'active')
      .maybeSingle();

    if (error || !reminder) {
      logger.warn('Reminder not found or not active', { reminderId, error });
      return;
    }

    const now = new Date();
    // Event reminders have trigger_at = NULL — they are ALWAYS eligible to fire
    // (they are only reached via fireEvent, which does its own active+event_trigger lookup).
    // Time-based reminders must not have a future trigger_at.
    const isEventReminder = !reminder.trigger_at;
    const triggerTime = isEventReminder ? now : new Date(reminder.trigger_at);

    // Generate a warm, Nova-style reminder message (natural Hinglish, not "🔔 Reminder: x")
    const message = await this.generateReminderMessage(reminder);

    // Safety check: if trigger time is in the future, do not fire yet (time-based only)
    if (!isEventReminder && triggerTime > now) {
      logger.info('Reminder scheduled for future, skipping fire', { reminderId });
      return;
    }

    // 1. Create a user_moments entry
    await supabaseAdmin.from('user_moments').insert({
      user_id: reminder.user_id,
      moment_type: 'REMINDER',
      title: 'Reminder',
      body: reminder.text,
      status: 'generated'
    });

    // 2. Retrieve user's latest active conversation ID
    const { data: latestChat } = await supabaseAdmin
      .from('chat_history')
      .select('conversation_id')
      .eq('user_id', reminder.user_id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const conversationId = latestChat?.conversation_id || crypto.randomUUID();

    // Insert chat message to conversation history
    await supabaseAdmin.from('chat_history').insert({
      user_id: reminder.user_id,
      conversation_id: conversationId,
      role: 'assistant',
      content: message
    });

    // 3. Handle recurrence or mark completed
    let completed = false;
    if (reminder.recurrence_type && reminder.recurrence_interval) {
      const currentCount = (reminder.recurrence_count || 0) + 1;

      // Check hard limit
      const hitLimit = reminder.recurrence_limit && currentCount >= reminder.recurrence_limit;

      // Calculate next trigger respecting day/month filters
      const rawNextTrigger = this.calculateNextTrigger(
        triggerTime,
        reminder.recurrence_type,
        reminder.recurrence_interval
      );
      const nextTrigger = this.applyDayMonthFilters(
        rawNextTrigger,
        reminder.active_days || null,
        reminder.active_months || null,
        reminder.active_year || null
      );

      // Check end_at
      const hitEndAt = reminder.end_at && nextTrigger >= new Date(reminder.end_at);

      if (hitLimit || hitEndAt) {
        completed = true;
      } else {
        await supabaseAdmin
          .from('reminders')
          .update({ 
            trigger_at: nextTrigger.toISOString(), 
            updated_at: new Date().toISOString(),
            recurrence_count: currentCount
          })
          .eq('id', reminderId);
        logger.info('Recurring reminder rescheduled', { reminderId, nextTrigger, count: currentCount });
      }
    } else {
      completed = true;
    }

    if (completed) {
      await supabaseAdmin
        .from('reminders')
        .update({ status: 'completed', updated_at: new Date().toISOString() })
        .eq('id', reminderId);
      logger.info('Reminder fired and completed', { reminderId });

      // Completion tracking: queue a Nova agenda item so NACE checks in on how it went.
      // Only for finished reminders (one-shots or recurring that hit their limit) —
      // ongoing recurring reminders don't spam the agenda with a "done?" follow-up.
      try {
        const followUpAfter = new Date(Date.now() + 45 * 60 * 1000);
        await supabaseAdmin.from('nova_agenda').insert({
          user_id: reminder.user_id,
          event_description: reminder.text.substring(0, 500),
          expected_time: now.toISOString(),
          follow_up_question: `"${reminder.text}" ho gaya? Batao kaise gaya!`,
          follow_up_after: followUpAfter.toISOString(),
          source_message: 'Reminder fired',
          status: 'pending',
          next_retry_at: followUpAfter.toISOString(),
          urgency: 'medium',
          is_recurring: false,
        });
        logger.info('[Reminder] Completion follow-up queued in agenda', { reminderId });
      } catch (agendaErr) {
        logger.warn('[Reminder] Failed to queue completion follow-up', { error: agendaErr instanceof Error ? agendaErr.message : String(agendaErr) });
      }
    }

    // 4. Send push notification to the user
    try {
      const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('push_token')
        .eq('id', reminder.user_id)
        .maybeSingle();
      if (profile?.push_token) {
        await sendPushNotification([{
          to: profile.push_token,
          title: '🔔 Nova Reminder',
          body: message.length > 100 ? message.substring(0, 97) + '...' : message,
          sound: 'default',
          channelId: 'nova_reminders',
          priority: 'high',
          data: { type: 'nova_reminder', conversationId: conversationId },
        }]);
        logger.info('Reminder push notification sent', { reminderId });
      }
    } catch (pushErr) {
      logger.warn('Failed to send reminder push notification', {
        error: pushErr instanceof Error ? pushErr.message : String(pushErr)
      });
    }
  }

  /**
   * Generate a warm, Nova-style reminder message via a short background LLM call
   * (with a 6s timeout). Falls back to a natural template if the LLM fails.
   */
  private async generateReminderMessage(reminder: any): Promise<string> {
    const fallback = `⏰ ${reminder.text} — ho gaya?`;
    try {
      const { novaBrain } = await import('./NovaBrainService');
      const result: any = await Promise.race([
        novaBrain.evaluateConsciousnessTier2(
          `Name: yaar\nSituation: It is time for a reminder the user set earlier: "${reminder.text}".\nGenerate ONE short WhatsApp-style reminder message (1 sentence, casual Hinglish/English mix, warm best-friend tone, max 1 emoji). Make it feel like a friend reminding them, and end with a light nudge to confirm once done (e.g. "done kar ke batana"). Do NOT start with "Reminder:" and do NOT use a bell emoji.`
        ),
        new Promise<string>((resolve) => setTimeout(() => resolve(''), 6000))
      ]);
      const candidate = result?.message;
      if (typeof candidate === 'string' && candidate.trim().length > 3 && candidate.trim().length <= 200) {
        return candidate.trim();
      }
    } catch (err) {
      logger.warn('[Reminder] LLM reminder message generation failed, using fallback', { error: err instanceof Error ? err.message : String(err) });
    }
    return fallback;
  }

  private calculateNextTrigger(currentTrigger: Date, recurrenceType: string, recurrenceInterval: number): Date {
    const next = new Date(currentTrigger);
    if (recurrenceType === 'minutes') {
      next.setMinutes(next.getMinutes() + recurrenceInterval);
    } else if (recurrenceType === 'hours') {
      next.setHours(next.getHours() + recurrenceInterval);
    } else if (recurrenceType === 'days') {
      next.setDate(next.getDate() + recurrenceInterval);
    } else if (recurrenceType === 'weeks') {
      next.setDate(next.getDate() + (recurrenceInterval * 7));
    } else if (recurrenceType === 'months') {
      next.setMonth(next.getMonth() + recurrenceInterval);
    } else {
      next.setDate(next.getDate() + 1);
    }
    return next;
  }

  /**
   * Given a candidate next trigger date, advance it forward until
   * it falls on a valid day (active_days) and valid month (active_months/year).
   */
  private applyDayMonthFilters(
    date: Date,
    activeDays: string[] | null,
    activeMonths: string[] | null,
    activeYear: number | null
  ): Date {
    const DAY_NAMES = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
    const MONTH_NAMES = ['january','february','march','april','may','june','july','august','september','october','november','december'];

    let d = new Date(date);
    let safetyDay = 0;
    // Advance to a valid day
    if (activeDays && activeDays.length > 0) {
      while (safetyDay < 14) {
        const dayName = DAY_NAMES[d.getUTCDay()];
        if (activeDays.includes(dayName)) break;
        d.setUTCDate(d.getUTCDate() + 1);
        safetyDay++;
      }
    }

    // Advance to a valid month
    if (activeMonths && activeMonths.length > 0) {
      let safetyMonth = 0;
      while (safetyMonth < 24) {
        const monthName = MONTH_NAMES[d.getUTCMonth()];
        const yearOk = !activeYear || d.getUTCFullYear() === activeYear;
        if (activeMonths.includes(monthName) && yearOk) break;
        // Jump to 1st of next month, preserve time
        const hours = d.getUTCHours();
        const mins = d.getUTCMinutes();
        d.setUTCMonth(d.getUTCMonth() + 1);
        d.setUTCDate(1);
        d.setUTCHours(hours, mins, 0, 0);
        safetyMonth++;
      }
    }

    return d;
  }
}

export const reminderSchedulerService = new ReminderSchedulerService();
