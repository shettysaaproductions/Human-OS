import { supabaseAdmin } from '../lib/supabase';
import { logger } from '../lib/logger';
import { outboundDispatcherService } from './OutboundDispatcherService';
import type { OutboundSource } from '../types/outbound';


export class ReminderSchedulerService {
  // Overlap guard: fireReminder generates a warm LLM message per reminder, which can exceed
  // the 10s poll interval. Without this guard two overlapping polls fetch the SAME due
  // reminders and fire them twice (double chat insert + push). Only one poll runs at a time.
  private _isChecking = false;

  /**
   * Schedule a reminder by creating a database record
   */
  async scheduleReminder(userId: string, text: string, triggerAt: Date, recurrenceType?: string, recurrenceInterval?: number, recurrenceLimit?: number, isAuto: boolean = false): Promise<any> {
    const { data: reminder, error } = await supabaseAdmin
      .from('reminders')
      .insert({
        user_id: userId,
        text,
        trigger_at: triggerAt.toISOString(),
        recurrence_type: recurrenceType || null,
        recurrence_interval: recurrenceInterval || null,
        recurrence_limit: recurrenceLimit || null,
        status: 'active',
        is_auto: isAuto
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
    const startMs = Date.now();
    // runId is correlation-only — never used as a durable outbound identity
    const runId = `reminder:poll:${startMs}`;
    logger.info('[Reminder] Engine started', { engine: 'REMINDER', event: 'engine_started', runId });

    let remindersChecked = 0;
    let intentsDispatched = 0;
    let intentsSuppressed = 0;

    try {
      const now = new Date();
      const { data: dueReminders, error } = await supabaseAdmin
        .from('reminders')
        .select('*')
        .eq('status', 'active')
        .lte('trigger_at', now.toISOString());

      if (error) {
        logger.error('Failed to fetch due reminders', { error: error.message });
        logger.info('[Reminder] Engine completed', {
          engine: 'REMINDER', event: 'engine_completed', runId,
          durationMs: Date.now() - startMs, remindersChecked: 0,
          intentsDispatched: 0, intentsSuppressed: 0, intentsFailed: 0,
          outcome: 'failed', suppressionReasons: {},
        });
        return;
      }

      remindersChecked = dueReminders?.length ?? 0;
      if (dueReminders && dueReminders.length > 0) {
        logger.info(`Found ${dueReminders.length} due reminders to process`);
        for (const reminder of dueReminders) {
          try {
            const status = await this.fireReminderWithStatus(reminder.id);
            if (status === 'dispatched') intentsDispatched++;
            else intentsSuppressed++;
          } catch (err) {
            logger.error('Failed to fire reminder', { reminderId: reminder.id, error: err instanceof Error ? err.message : String(err) });
            intentsSuppressed++;
          }
        }
      }

      logger.info('[Reminder] Engine completed', {
        engine: 'REMINDER',
        event: 'engine_completed',
        runId,
        durationMs: Date.now() - startMs,
        remindersChecked,
        intentsDispatched,
        intentsSuppressed,
        intentsFailed: 0,
        outcome: 'healthy',
        suppressionReasons: {},
        metadata: { remindersChecked },
      });
    } catch (err) {
      logger.error('Error during checkAndFireReminders execution', { error: err instanceof Error ? err.message : String(err) });
      logger.info('[Reminder] Engine completed', {
        engine: 'REMINDER', event: 'engine_completed', runId,
        durationMs: Date.now() - startMs, remindersChecked,
        intentsDispatched, intentsSuppressed, intentsFailed: 0,
        outcome: 'failed', suppressionReasons: {},
      });
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

    // Pre-generate the reminder message (natural Hinglish, not "🔔 Reminder: x").
    // We do this before dispatch so it can be passed as proposedMessage (strategy:'none').
    // If generation fails, generateReminderMessage() returns a safe template — never throws.
    const message = await this.generateReminderMessage(reminder);

    // Safety check: if trigger time is in the future, do not fire yet (time-based only)
    if (!isEventReminder && triggerTime > now) {
      logger.info('Reminder scheduled for future, skipping fire', { reminderId });
      return;
    }

    // 1. Insert a Moment entry (separate from delivery — not part of the dispatch lifecycle).
    try {
      await supabaseAdmin.from('user_moments').insert({
        user_id: reminder.user_id,
        moment_type: 'REMINDER',
        title: 'Reminder',
        body: reminder.text,
        status: 'generated'
      });
    } catch (momentErr) {
      // Non-fatal — moment log is informational only.
      logger.warn('[Reminder] Failed to insert user_moment', { reminderId, error: momentErr instanceof Error ? momentErr.message : String(momentErr) });
    }

    // 2. Deliver through the canonical Dispatcher.
    //
    // Quiet-hours bypass policy (Correction 3):
    //   - User-explicitly-requested reminders (is_auto = false) with high urgency bypass quiet hours.
    //   - Auto-detected / system-generated reminders (is_auto = true) NEVER bypass quiet hours,
    //     regardless of urgency — a system-classified "high" does not equal user intent.
    //   - This prevents a future system-generated reminder from accidentally breaking quiet hours
    //     simply because it was classified as high urgency.
    const isUserRequested = reminder.is_auto !== true;
    const isHighUrgency = reminder.urgency === 'high';
    const bypassQuietHours = isUserRequested && isHighUrgency;

    // Stable idempotency key: same reminder.id = same logical firing operation.
    // On retry (e.g., transient DB failure), the Dispatcher resumes from existing intent state.
    // The Dispatcher's FAILED_TRANSIENT reset logic releases the stale gate reservation
    // before re-acquiring, preventing phantom nova_outreach_log rows.
    const idempotencyKey = `reminder:fire:${reminder.id}`;
    const logicalKey = `reminder:fire:${reminder.id}`;

    const dispatchResult = await outboundDispatcherService.dispatch({
      userId: reminder.user_id,
      sourceEngine: 'REMINDER' as OutboundSource,
      intentType: 'reminder',
      logicalKey,
      idempotencyKey,
      context: { reminderId: reminder.id, reminderText: reminder.text, urgency: reminder.urgency },
      generationStrategy: 'none',
      proposedMessage: message,
      skipQuietHoursCheck: bypassQuietHours,
      skipMinGapCheck: true,   // User-requested reminders bypass ignored-count escalation
      proposedAction: 'REMINDER',
    });
    const finalStatus = dispatchResult.status;

    if (finalStatus === 'SUPPRESSED') {
      logger.info('[Reminder] Delivery suppressed by gate (quiet hours or cooldown)', { reminderId, bypassQuietHours, reason: dispatchResult.reason });
      // CRITICAL BUG FIX: If a one-time reminder is suppressed by quiet hours or gate limits,
      // DO NOT mark it completed! Marking it completed kills the reminder permanently without delivery.
      // Instead, defer it: retry after quiet hours (60 min) or cooldown (15 min).
      if (!reminder.recurrence_type) {
        const deferMinutes = dispatchResult.reason === 'QUIET_HOURS' ? 60 : 15;
        const nextTrigger = new Date(Date.now() + deferMinutes * 60 * 1000);
        await supabaseAdmin
          .from('reminders')
          .update({ trigger_at: nextTrigger.toISOString(), updated_at: now.toISOString() })
          .eq('id', reminderId);
        logger.info('[Reminder] One-time reminder delivery suppressed; deferred trigger_at instead of killing', {
          reminderId,
          deferMinutes,
          nextTrigger: nextTrigger.toISOString(),
          reason: dispatchResult.reason,
        });
        return;
      }
      // Still handle recurrence below — the reminder logic continues even if this firing is suppressed.
    } else if (finalStatus === 'FAILED_TRANSIENT') {
      logger.warn('[Reminder] Delivery failed transiently — will retry on next poll', { reminderId });
      return;
    } else if (finalStatus === 'FAILED_TERMINAL') {
      logger.error('[Reminder] Delivery failed terminally (e.g., account deleted)', { reminderId, reason: dispatchResult.reason });
      await supabaseAdmin.from('reminders').update({ status: 'cancelled', updated_at: new Date().toISOString() }).eq('id', reminderId);
      return;
    } else {
      logger.info('[Reminder] Delivered successfully', { reminderId, finalStatus, terminal: dispatchResult.terminal });
      // Update accountability status to 'reminded'
      await supabaseAdmin.from('reminders').update({
        accountability_status: 'reminded',
        last_follow_up_at: now.toISOString(),
        updated_at: now.toISOString()
      }).eq('id', reminderId);
    }

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
    }

    // 4. Nova Autonomous Accountability Check-In (For workout, health, bills, habits, general)
    try {
      const firedAt = now.toISOString();
      const firstCheckAt = new Date(Date.now() + 25 * 60 * 1000); // 25 min follow-up

      await supabaseAdmin.from('nova_agenda').insert({
        user_id: reminder.user_id,
        event_description: reminder.text.substring(0, 500),
        follow_up_question: `User was reminded about: "${reminder.text}". Check warmly and accountably if they did it.`,
        follow_up_after: firstCheckAt.toISOString(),
        source_message: `reminder_accountability_check:${reminder.id}:${firedAt}`,
        status: 'pending',
        next_retry_at: firstCheckAt.toISOString(),
        urgency: reminder.urgency || 'medium',
        is_recurring: false,
        max_retries: 2,
      });
      logger.info('[Reminder] Autonomous accountability check-in queued', { reminderId });
    } catch (agendaErr) {
      logger.warn('[Reminder] Failed to queue check-in agenda', { error: agendaErr instanceof Error ? agendaErr.message : String(agendaErr) });
    }

  }

  /**
   * Phase 9 liveness telemetry wrapper.
   * Calls fireReminder and classifies the outcome as 'dispatched' or 'suppressed'.
   * 'suppressed' covers: not found, future trigger, transient failure, terminal failure, gate block.
   */
  async fireReminderWithStatus(reminderId: string): Promise<'dispatched' | 'suppressed'> {
    try {
      await this.fireReminder(reminderId);
      return 'dispatched';
    } catch {
      return 'suppressed';
    }
  }

  private async generateReminderMessage(reminder: any): Promise<string> {
    const text = reminder.text || 'kuch kaam tha';
    
    try {
      const { userLifeStageEngine } = await import('./UserLifeStageEngine');
      const stageCtx = await userLifeStageEngine.getUserLifeStageContext(reminder.user_id);
      const enrichedDefault = userLifeStageEngine.enrichReminderMessage(text, stageCtx);

      const { complete } = await import('../lib/nvidia');
      const prompt = `You are Nova, an AI companion texting your friend (${stageCtx.userName}) on WhatsApp.
User Life Stage & Real Mission: ${stageCtx.stageLabel}. ${stageCtx.corePurposeSummary}
Daily Lifestyle Rhythm: ${stageCtx.lifestyleRhythm.phaseDescription}

You need to remind them about this: "${text}".
PURPOSE-DRIVEN COMPANION RULES:
- Connect this task to their real-life purpose using their verified goals, livelihood, and lifestyle from the context above.
- Speak as a perceptive, supportive companion.
- DO NOT sound like a robotic alarm clock.
- NEVER use boilerplate formulas like "Arey sun, yaad hai na... Time pe dekh lena!" or "abhi free hai toh start kar de".
- Reference: "${enrichedDefault}"
- Keep it 1-2 natural sentences in conversational Hinglish.

Output ONLY the raw text message. No markdown, no quotes, no labels.`;

      const result = await complete('LEARNING', [
        { role: 'system', content: prompt }
      ], {
        temperature: 0.7,
        maxTokens: 120
      });
      
      let clean = result.trim();
      if (clean.startsWith('"') && clean.endsWith('"')) {
        clean = clean.substring(1, clean.length - 1);
      }
      return clean || enrichedDefault;
    } catch (err) {
      logger.error('Failed to generate dynamic reminder message, falling back to purpose-enriched message', { error: err instanceof Error ? err.message : String(err) });
      try {
        const { userLifeStageEngine } = await import('./UserLifeStageEngine');
        const stageCtx = await userLifeStageEngine.getUserLifeStageContext(reminder.user_id);
        return userLifeStageEngine.enrichReminderMessage(text, stageCtx);
      } catch {
        return `Arey sun, ${text} ke baare me socha tha na? Yaad dila rahi thi!`;
      }
    }
  }

  public calculateNextTrigger(currentTrigger: Date, recurrenceType: string, recurrenceInterval: number, ensureFuture: boolean = true): Date {
    const next = new Date(currentTrigger);
    const advance = (d: Date) => {
      if (recurrenceType === 'minutes') {
        d.setMinutes(d.getMinutes() + recurrenceInterval);
      } else if (recurrenceType === 'hours') {
        d.setHours(d.getHours() + recurrenceInterval);
      } else if (recurrenceType === 'days') {
        d.setDate(d.getDate() + recurrenceInterval);
      } else if (recurrenceType === 'weeks') {
        d.setDate(d.getDate() + (recurrenceInterval * 7));
      } else if (recurrenceType === 'months') {
        const day = d.getDate();
        d.setMonth(d.getMonth() + recurrenceInterval);
        if (d.getDate() !== day) d.setDate(0);
      } else if (recurrenceType === 'years') {
        d.setFullYear(d.getFullYear() + recurrenceInterval);
      } else {
        d.setDate(d.getDate() + 1);
      }
    };

    advance(next);

    // If ensureFuture is enabled, keep advancing until next > now
    if (ensureFuture) {
      const now = new Date();
      let loops = 0;
      while (next.getTime() <= now.getTime() && loops < 1000) {
        advance(next);
        loops++;
      }
    }

    return next;
  }

  /**
   * Given a candidate next trigger date, advance it forward until
   * it falls on a valid day (active_days) and valid month (active_months/year).
   * Supports local timezone offset to avoid UTC date/day shifting.
   */
  public applyDayMonthFilters(
    date: Date,
    activeDays: string[] | null,
    activeMonths: string[] | null,
    activeYear: number | null,
    timezoneOffsetMinutes: number = 330 // Default to IST (UTC+5:30)
  ): Date {
    const DAY_NAMES = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
    const MONTH_NAMES = ['january','february','march','april','may','june','july','august','september','october','november','december'];

    const normDays = activeDays && activeDays.length > 0 ? activeDays.map(d => d.toLowerCase()) : null;
    const normMonths = activeMonths && activeMonths.length > 0 ? activeMonths.map(m => m.toLowerCase()) : null;

    if (!normDays && !normMonths && !activeYear) {
      return date;
    }

    let d = new Date(date);
    let iterations = 0;

    // Advance day by day until all active filters match simultaneously
    while (iterations < 730) {
      const localTimeMs = d.getTime() + timezoneOffsetMinutes * 60 * 1000;
      const localDate = new Date(localTimeMs);

      const dayName = DAY_NAMES[localDate.getUTCDay()];
      const monthName = MONTH_NAMES[localDate.getUTCMonth()];
      const year = localDate.getUTCFullYear();

      const dayMatch = !normDays || normDays.includes(dayName);
      const monthMatch = !normMonths || normMonths.includes(monthName);
      const yearMatch = !activeYear || year === activeYear;

      if (dayMatch && monthMatch && yearMatch) {
        break;
      }

      d.setDate(d.getDate() + 1);
      iterations++;
    }

    return d;
  }
}

export const reminderSchedulerService = new ReminderSchedulerService();
