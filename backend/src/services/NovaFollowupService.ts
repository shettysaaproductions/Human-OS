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
  /**
   * Scan for conversations where the last message was from the user (unanswered)
   * and 10+ minutes old, and queue a double-text follow-up.
   */
  async checkUnansweredConversations(): Promise<void> {
    try {
      // 10 minutes ago
      const cutoffTime = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      // Wait, let's just query chat_history directly to find recently stuck conversations.
      // Since it's a bit heavy to query all, we query messages from the last hour that are from the user.
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      
      const { data: recentUserMsgs, error: queryErr } = await supabaseAdmin
        .from('chat_history')
        .select('id, user_id, conversation_id, content, created_at, role')
        .gte('created_at', oneHourAgo)
        .lte('created_at', cutoffTime)
        .eq('role', 'user')
        .order('created_at', { ascending: false });

      if (queryErr) {
        logger.error('[NovaFollowup] Failed to query recent user msgs', { error: queryErr.message });
        return;
      }

      if (!recentUserMsgs || recentUserMsgs.length === 0) return;

      // Group by conversation to find the absolute latest message per conversation
      const conversationMap = new Map();
      for (const msg of recentUserMsgs) {
        if (!conversationMap.has(msg.conversation_id)) {
          conversationMap.set(msg.conversation_id, msg);
        }
      }

      // For each conversation, we must verify that this user message is truly the LAST message
      // (meaning Nova never replied)
      for (const [convId, userMsg] of conversationMap.entries()) {
        const { data: newerMsgs } = await supabaseAdmin
          .from('chat_history')
          .select('id')
          .eq('conversation_id', convId)
          .gt('created_at', userMsg.created_at)
          .limit(1);

        if (newerMsgs && newerMsgs.length > 0) {
          // Nova (or someone) replied after this message. It's not stuck.
          continue;
        }

        // It is stuck! Check if a follow-up is already queued
        const { data: pendingFollowup } = await supabaseAdmin
          .from('nova_followups')
          .select('id')
          .eq('user_id', userMsg.user_id)
          .eq('status', 'pending')
          .limit(1);
          
        if (pendingFollowup && pendingFollowup.length > 0) {
          continue; // Already has a pending follow-up
        }

        // Schedule a follow-up right now
        logger.info('[NovaFollowup] Detected stuck conversation, scheduling double-text', { userId: userMsg.user_id, convId });
        const doubleTextMsg = "Hey, sab theek? Tune reply nahi kiya?";
        await this.queueFollowup(userMsg.user_id, convId, doubleTextMsg, 0); // delay 0 hours = fire immediately
      }

    } catch (err) {
      logger.warn('[NovaFollowup] checkUnansweredConversations error', {
        error: err instanceof Error ? err.message : String(err)
      });
    }
  }
}

export const novaFollowupService = new NovaFollowupService();
