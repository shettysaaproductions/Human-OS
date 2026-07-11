import { supabaseAdmin } from '../lib/supabase';
import { logger } from '../lib/logger';

export interface Reminder {
  id?: string;
  user_id: string;
  title: string;
  body?: string;
  scheduled_at: Date;
  repeat_pattern?: string;
  repeat_times?: string[];
  is_active?: boolean;
}

export class ReminderService {
  async createReminder(reminder: Reminder): Promise<Reminder> {
    logger.info('Creating reminder', { userId: reminder.user_id, title: reminder.title });
    const { data, error } = await supabaseAdmin
      .from('reminders')
      .insert({
        user_id: reminder.user_id,
        title: reminder.title,
        body: reminder.body,
        scheduled_at: reminder.scheduled_at.toISOString(),
        repeat_pattern: reminder.repeat_pattern,
        repeat_times: reminder.repeat_times,
        is_active: true
      })
      .select()
      .single();

    if (error) {
      logger.error('Failed to create reminder', { error: error.message });
      throw new Error(`Failed to create reminder: ${error.message}`);
    }

    return data;
  }

  async getUpcomingReminders(userId: string, limit: number = 5): Promise<Reminder[]> {
    const { data, error } = await supabaseAdmin
      .from('reminders')
      .select('*')
      .eq('user_id', userId)
      .eq('is_active', true)
      .gte('scheduled_at', new Date().toISOString())
      .order('scheduled_at', { ascending: true })
      .limit(limit);

    if (error) {
      logger.error('Failed to get upcoming reminders', { error: error.message });
      return [];
    }

    return data;
  }
}

export const reminderService = new ReminderService();
