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
    const isUserRequested = reminder.is_auto === false;
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
      // Still handle recurrence below — the reminder logic continues even if this firing is suppressed.
    } else if (finalStatus === 'FAILED_TRANSIENT') {
      logger.warn('[Reminder] Delivery failed transiently — will retry on next poll', { reminderId });
      // Do NOT advance recurrence — leave the reminder in current state so the next
      // checkAndFireReminders poll retries with the same idempotencyKey.
      return;
    } else if (finalStatus === 'FAILED_TERMINAL') {
      logger.error('[Reminder] Delivery failed terminally (e.g., account deleted)', { reminderId, reason: dispatchResult.reason });
      // Terminal — mark reminder cancelled to prevent infinite retry.
      await supabaseAdmin.from('reminders').update({ status: 'cancelled', updated_at: new Date().toISOString() }).eq('id', reminderId);
      return;
    } else {
      logger.info('[Reminder] Delivered successfully', { reminderId, finalStatus, terminal: dispatchResult.terminal });
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

      // Respectful check-in: ONLY for genuinely critical/emergency reminders (health, deadlines).
      // Never nag every 2 minutes for general/lifestyle reminders — silence is respect.
      try {
        const reminderText = reminder.text.toLowerCase();

        const isCritical = [
          'medicine', 'tablet', 'pill', 'dawai', 'dawa', 'doctor',
          'hospital', 'injection', 'dose', 'medication',   // health
          'flight', 'train', 'ticket', 'exam', 'interview', // high stakes
          'emergency', 'urgent',
        ].some(k => reminderText.includes(k));

        if (isCritical) {
          const firedAt = now.toISOString();
          const firstCheckAt = new Date(Date.now() + 15 * 60 * 1000); // 15 min gap, not 2 min

          await supabaseAdmin.from('nova_agenda').insert({
            user_id: reminder.user_id,
            event_description: reminder.text.substring(0, 500),
            follow_up_question: `User was reminded about critical task: "${reminder.text}". Check warmly if completed.`,
            follow_up_after: firstCheckAt.toISOString(),
            source_message: `reminder_ack_check:${firedAt}`,
            status: 'pending',
            next_retry_at: firstCheckAt.toISOString(),
            urgency: 'high',
            is_recurring: false, // Do not loop endlessly
            max_retries: 2,      // Max 2 gentle attempts
          });
          logger.info('[Reminder] Respectful check-in queued for critical task', { reminderId });
        }
      } catch (agendaErr) {
        logger.warn('[Reminder] Failed to queue check-in agenda', { error: agendaErr instanceof Error ? agendaErr.message : String(agendaErr) });
      }

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
- Connect this task to their real-life purpose (e.g. if PF/bank details, it clears 15k capital to launch Shetty's Dhaba cloud kitchen; if interview/hiring, it scales Conviction HR; if family, it supports baby Shreshth and Sakshi).
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
      const day = next.getDate();
      next.setMonth(next.getMonth() + recurrenceInterval);
      if (next.getDate() !== day) next.setDate(0);
    } else if (recurrenceType === 'years') {
      next.setFullYear(next.getFullYear() + recurrenceInterval);
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
