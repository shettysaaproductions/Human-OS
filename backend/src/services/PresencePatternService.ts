import { supabaseAdmin } from '../lib/supabase';
import { logger } from '../lib/logger';

export type PresencePattern = 
  | 'ACTIVE_CHATTING'
  | 'IGNORING_LURKING'
  | 'BUSY_INTERMITTENT'
  | 'AWAY_ASLEEP'
  | 'UNKNOWN';

export const presencePatternService = {
  /**
   * Analyzes the last 3 hours of presence history and chat history
   * to determine the user's current behavior pattern.
   */
  async getBehaviorPattern(userId: string): Promise<{ pattern: PresencePattern; description: string }> {
    try {
      const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();

      // Get recent presence history
      const { data: presenceHistory, error: presenceError } = await supabaseAdmin
        .from('user_presence_history')
        .select('*')
        .eq('user_id', userId)
        .gte('created_at', threeHoursAgo)
        .order('created_at', { ascending: false });

      if (presenceError) throw presenceError;

      // Get recent user messages
      const { data: recentMessages, error: chatError } = await supabaseAdmin
        .from('chat_history')
        .select('created_at, role, is_read')
        .eq('user_id', userId)
        .gte('created_at', threeHoursAgo)
        .order('created_at', { ascending: false });

      if (chatError) throw chatError;

      const userMessages = (recentMessages || []).filter(m => m.role === 'user');

      if (!presenceHistory || presenceHistory.length === 0) {
        return { pattern: 'AWAY_ASLEEP', description: 'User has been offline for hours.' };
      }

      const latestPresence = presenceHistory[0];
      const isCurrentlyOnline = latestPresence.status === 'online' || latestPresence.status === 'typing';

      if (isCurrentlyOnline) {
        if (userMessages.length >= 3) {
          return { pattern: 'ACTIVE_CHATTING', description: 'User is online and sending messages frequently.' };
        } else if (presenceHistory.filter(p => p.status === 'online' || p.status === 'typing').length >= 3) {
           return { pattern: 'IGNORING_LURKING', description: 'User has been coming online/typing multiple times but not sending messages.' };
        } else {
           return { pattern: 'BUSY_INTERMITTENT', description: 'User is online but only briefly or intermittently.' };
        }
      } else {
         if (latestPresence.status === 'away') {
             return { pattern: 'AWAY_ASLEEP', description: 'User is marked as away.' };
         }
         return { pattern: 'AWAY_ASLEEP', description: 'User is offline.' };
      }

    } catch (error) {
      logger.error('Failed to get behavior pattern', { error, userId });
      return { pattern: 'UNKNOWN', description: 'Pattern unknown due to error.' };
    }
  }
};
