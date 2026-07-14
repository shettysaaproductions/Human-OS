import { supabaseAdmin } from '../lib/supabase';
import { logger } from '../lib/logger';

export interface Reminder {
  id?: string;
  user_id: string;
  text: string;
  trigger_at: Date;
  recurrence_type?: string;
  recurrence_interval?: number;
  recurrence_limit?: number;
  recurrence_count?: number;
  active_days?: string[];
  active_months?: string[];
  active_year?: number;
  end_at?: Date;
  is_auto?: boolean;
  notes?: string;
  status?: string;
}

export class ReminderService {
  async getUpcomingReminders(userId: string, limit: number = 10): Promise<any[]> {
    const { data, error } = await supabaseAdmin
      .from('reminders')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'active')
      .gte('trigger_at', new Date().toISOString())
      .order('trigger_at', { ascending: true })
      .limit(limit);

    if (error) {
      logger.error('Failed to get upcoming reminders', { error: error.message });
      return [];
    }

    return data || [];
  }
}

export const reminderService = new ReminderService();
