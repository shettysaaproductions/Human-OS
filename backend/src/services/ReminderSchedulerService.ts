import { supabaseAdmin } from '../lib/supabase';
import { logger } from '../lib/logger';
import { sendPushNotification } from '../lib/pushNotifications';
import crypto from 'crypto';

export class ReminderSchedulerService {
  /**
   * Schedule a reminder by creating a database record
   */
  async scheduleReminder(userId: string, text: string, triggerAt: Date, recurrenceType?: string, recurrenceInterval?: number): Promise<any> {
    const { data: reminder, error } = await supabaseAdmin
      .from('reminders')
      .insert({
        user_id: userId,
        text,
        trigger_at: triggerAt.toISOString(),
        recurrence_type: recurrenceType || null,
        recurrence_interval: recurrenceInterval || null,
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
    const triggerTime = new Date(reminder.trigger_at);
    
    // Safety check: if trigger time is in the future, do not fire yet
    if (triggerTime > now) {
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
      content: `🔔 Reminder: ${reminder.text}`
    });

    // 3. Handle recurrence or mark completed
    if (reminder.recurrence_type && reminder.recurrence_interval) {
      const nextTrigger = this.calculateNextTrigger(
        triggerTime,
        reminder.recurrence_type,
        reminder.recurrence_interval
      );
      await supabaseAdmin
        .from('reminders')
        .update({ trigger_at: nextTrigger.toISOString(), updated_at: new Date().toISOString() })
        .eq('id', reminderId);
      logger.info('Recurring reminder rescheduled', { reminderId, nextTrigger });
    } else {
      await supabaseAdmin
        .from('reminders')
        .update({ status: 'completed', updated_at: new Date().toISOString() })
        .eq('id', reminderId);
      logger.info('One-off reminder fired and completed', { reminderId });
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
          body: reminder.text.length > 100 ? reminder.text.substring(0, 97) + '...' : reminder.text,
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

  private calculateNextTrigger(currentTrigger: Date, recurrenceType: string, recurrenceInterval: number): Date {
    const next = new Date(currentTrigger);
    if (recurrenceType === 'hours') {
      next.setHours(next.getHours() + recurrenceInterval);
    } else if (recurrenceType === 'days') {
      next.setDate(next.getDate() + recurrenceInterval);
    } else {
      // Default fallback
      next.setDate(next.getDate() + 1);
    }
    return next;
  }
}

export const reminderSchedulerService = new ReminderSchedulerService();
