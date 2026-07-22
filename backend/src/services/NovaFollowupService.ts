/**
 * NovaFollowupService — Human-like follow-up scheduling
 *
 * How it works:
 * 1. Called (fire-and-forget) after EVERY chat response is sent
 * 2. Cancels any existing pending follow-up for this user (new conversation = reset clock)
 * 3. Asks the LLM: "Given this conversation, when should I text next, and what should I say?"
 * 4. Writes the scheduled message to nova_followups table
 * 5. ReminderSchedulerService polls every 10s and fires the push notification
 * 6. When user opens app, hydrateMessages picks up the new assistant message from DB
 *
 * Timing is dynamic — the LLM decides based on:
 * - Time of day + user's routine (work hours → longer gaps, evening → shorter)
 * - Conversation mood (busy/rushed → longer, free/happy → shorter)
 * - Last message context (vague open-ended → follow up sooner, concluded → longer)
 * - Whether user explicitly said they're busy/going somewhere
 */

import { supabaseAdmin } from '../lib/supabase';
import { logger } from '../lib/logger';
import { sendPushNotification } from '../lib/pushNotifications';


export class NovaFollowupService {

  /**
   * Queue the next follow-up message from Nova Brain.
   */
  async queueFollowup(
    userId: string,
    conversationId: string,
    message: string,
    delayHours: number
  ): Promise<void> {
    try {
      // Cancel any existing pending follow-up for this user
      await supabaseAdmin
        .from('nova_followups')
        .update({ status: 'cancelled' })
        .eq('user_id', userId)
        .eq('status', 'pending');

      const delayMinutes = Math.min(Math.max(Math.floor(delayHours * 60), 5), 24 * 60);
      const fireAt = new Date(Date.now() + delayMinutes * 60 * 1000);

      await supabaseAdmin.from('nova_followups').insert({
        user_id: userId,
        conversation_id: conversationId,
        message,
        fire_at: fireAt.toISOString(),
        status: 'pending'
      });

      logger.info('[NovaFollowup] Scheduled via Brain', {
        userId,
        delayMinutes,
        message: message.substring(0, 60),
      });
    } catch (err) {
      logger.warn('[NovaFollowup] Error scheduling follow-up (non-critical)', {
        error: err instanceof Error ? err.message : String(err)
      });
    }
  }

  /**
   * Cancel any pending follow-ups for a user (e.g. when they reply).
   */
  async cancelFollowups(userId: string): Promise<void> {
    try {
      await supabaseAdmin
        .from('nova_followups')
        .update({ status: 'cancelled' })
        .eq('user_id', userId)
        .eq('status', 'pending');
    } catch (err) {
      logger.warn('[NovaFollowup] Error cancelling follow-ups', {
        error: err instanceof Error ? err.message : String(err)
      });
    }
  }

  /**
   * Poll and fire any due follow-ups.
   * Called by the same 10s interval that fires user reminders.
   */
  async checkAndFireFollowups(): Promise<void> {
    try {
      const now = new Date().toISOString();
      const { data: due, error } = await supabaseAdmin
        .from('nova_followups')
        .select('*')
        .eq('status', 'pending')
        .lte('fire_at', now);

      if (error) {
        logger.error('[NovaFollowup] Failed to query due followups', { error: error.message });
        return;
      }

      if (!due || due.length === 0) return;

      logger.info(`[NovaFollowup] Firing ${due.length} due follow-up(s)`);

      for (const followup of due) {
        try {
          await this._fireFollowup(followup);
        } catch (err) {
          logger.error('[NovaFollowup] Failed to fire followup', {
            id: followup.id,
            error: err instanceof Error ? err.message : String(err)
          });
        }
      }
    } catch (err) {
      logger.warn('[NovaFollowup] checkAndFireFollowups error', {
        error: err instanceof Error ? err.message : String(err)
      });
    }
  }

  private async _fireFollowup(followup: any): Promise<void> {
    // Mark as sent immediately (prevent double-fire on slow DB)
    const { error: updateErr } = await supabaseAdmin
      .from('nova_followups')
      .update({ status: 'sent' })
      .eq('id', followup.id)
      .eq('status', 'pending'); // optimistic lock

    if (updateErr) {
      logger.warn('[NovaFollowup] Could not lock followup for firing (may be racing)', { id: followup.id });
      return;
    }

    // Insert as Nova's message in chat history
    await supabaseAdmin.from('chat_history').insert({
      user_id: followup.user_id,
      conversation_id: followup.conversation_id,
      role: 'assistant',
      content: followup.message,
    });

    // Fetch push token and send notification
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('push_token, preferred_name')
      .eq('id', followup.user_id)
      .maybeSingle();

    if (profile?.push_token) {
      await sendPushNotification([{
        to: profile.push_token,
        title: 'Nova',
        body: followup.message.length > 100
          ? followup.message.substring(0, 97) + '...'
          : followup.message,
        sound: 'default',
        channelId: 'nova_messages',
        priority: 'high',
        data: {
          type: 'nova_followup',
          conversationId: followup.conversation_id,
        },
      }]);

      logger.info('[NovaFollowup] Push notification sent', { userId: followup.user_id });
    } else {
      logger.warn('[NovaFollowup] No push token for user', { userId: followup.user_id });
    }
  }
}

export const novaFollowupService = new NovaFollowupService();
