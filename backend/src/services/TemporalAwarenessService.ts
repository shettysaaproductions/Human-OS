/**
 * TemporalAwarenessService
 * 
 * Deeply integrates the current Day, Date, and Time with the user's learned habits
 * and routines. Determines exactly what "right now" means for the user.
 */

import { supabaseAdmin } from '../lib/supabase';
import { logger } from '../lib/logger';

export interface TemporalContext {
  localTime: Date;
  hour: number;
  dayOfWeek: string;
  isWeekend: boolean;
  activeRoutines: string[];
  isSleepWindow: boolean;
  timeOfDayLabel: string;
}

export class TemporalAwarenessService {
  /**
   * Evaluates the current time context for a user, taking their learned
   * routines into account to determine sleep windows and active habits.
   */
  async getContext(userId: string, tzOffset: number = 5.5): Promise<TemporalContext> {
    const nowLocal = new Date(Date.now() + tzOffset * 3600000);
    const hour = nowLocal.getUTCHours();
    const dayOfWeek = nowLocal.toLocaleDateString('en-US', { weekday: 'long' });
    const isWeekend = ['Saturday', 'Sunday'].includes(dayOfWeek);
    
    let timeOfDayLabel = 'night';
    if (hour >= 5 && hour < 12) timeOfDayLabel = 'morning';
    else if (hour >= 12 && hour < 17) timeOfDayLabel = 'afternoon';
    else if (hour >= 17 && hour < 21) timeOfDayLabel = 'evening';

    let activeRoutines: string[] = [];
    let isSleepWindow = hour >= 23 || hour < 7; // Default sleep window

    try {
      const { data: routines } = await supabaseAdmin
        .from('user_routines')
        .select('*')
        .eq('user_id', userId);

      if (routines && routines.length > 0) {
        // Evaluate if any routine affects the current context
        for (const routine of routines) {
          const lowerDesc = routine.description.toLowerCase();
          
          // Check if this routine applies to today
          const appliesToday = lowerDesc.includes('every day') || 
                               lowerDesc.includes('daily') || 
                               lowerDesc.includes(dayOfWeek.toLowerCase()) ||
                               (isWeekend && lowerDesc.includes('weekend')) ||
                               (!isWeekend && lowerDesc.includes('weekday'));
          
          if (appliesToday) {
            activeRoutines.push(routine.description);
          }

          // Adjust sleep window if they have late night routines (e.g. "Stays out late on Fridays")
          if (appliesToday && (lowerDesc.includes('stays out late') || lowerDesc.includes('late night'))) {
            // Shift sleep window forward
            if (hour >= 23 || hour < 4) {
              isSleepWindow = false; // They are awake right now
            }
          }
        }
      }
    } catch (err) {
      logger.warn('[TemporalAwareness] Failed to fetch routines', { error: err instanceof Error ? err.message : String(err) });
    }

    return {
      localTime: nowLocal,
      hour,
      dayOfWeek,
      isWeekend,
      activeRoutines,
      isSleepWindow,
      timeOfDayLabel
    };
  }
}

export const temporalAwarenessService = new TemporalAwarenessService();
