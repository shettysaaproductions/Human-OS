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
import { chatCompletion } from '../lib/nvidia';
import { sendPushNotification } from '../lib/pushNotifications';
import crypto from 'crypto';

interface FollowupDecision {
  shouldFollowUp: boolean;
  delayMinutes: number;       // minutes from now to send
  message: string;            // what Nova will say
  reason: string;             // internal reasoning (for logs)
}

const FOLLOWUP_DECISION_PROMPT = `You are Nova's internal scheduling engine. Given a recent conversation snippet and current context, decide:
1. Should Nova follow up? (sometimes no — if conversation was conclusive or user said bye)
2. How many minutes from now? (be realistic — can be 5 mins, 30 mins, 2 hours, 6 hours)
3. What should Nova say? (short, warm, natural — NOT "Hey I was just checking in" — be specific to the conversation)

Context rules:
- If user said "bye", "ttyl", "later", "gtg", "busy", "in a meeting" → wait 2-4 hours
- If user is at work/office → wait until evening (6+ hours)  
- If conversation just ended naturally with no clear closure → follow up in 10-30 mins
- If user seems happy and chatty → shorter gap (5-20 mins)
- If it's late night (10pm-7am user time) → don't follow up until morning
- If user asked something and you answered → check back in 15-30 mins
- Vary your timing — don't be predictable

Respond ONLY with valid JSON, no markdown, no explanation:
{
  "shouldFollowUp": true,
  "delayMinutes": 15,
  "message": "Btw how did that go?",
  "reason": "User mentioned something they were about to do, natural check-in"
}`;

export class NovaFollowupService {

  /**
   * Schedule the next follow-up after a conversation turn.
   * Call this fire-and-forget after every chat response.
   */
  async scheduleFollowup(
    userId: string,
    conversationId: string,
    recentMessages: { role: string; content: string }[],
    userLocalHour: number,   // 0-23, user's local time
    userCountry: string
  ): Promise<void> {
    try {
      // Cancel any existing pending follow-up for this user
      // (new message = reset the clock)
      await supabaseAdmin
        .from('nova_followups')
        .update({ status: 'cancelled' })
        .eq('user_id', userId)
        .eq('status', 'pending');

      // Don't schedule during sleep hours (10pm – 7am user time)
      if (userLocalHour >= 22 || userLocalHour < 7) {
        logger.info('[NovaFollowup] Skipping — user is in sleep hours', { userId, userLocalHour });
        return;
      }

      // Build conversation snippet (last 6 messages for context)
      const snippet = recentMessages.slice(-6)
        .map(m => `${m.role === 'user' ? 'User' : 'Nova'}: ${m.content.substring(0, 200)}`)
        .join('\n');

      const contextNote = `Current user local time: ${userLocalHour}:00 (${userCountry}). ` +
        `It is ${userLocalHour < 12 ? 'morning' : userLocalHour < 17 ? 'afternoon' : 'evening'}.`;

      // Ask LLM to decide follow-up timing and content
      const decisionRaw = await chatCompletion([
        { role: 'system', content: FOLLOWUP_DECISION_PROMPT },
        { role: 'user', content: `${contextNote}\n\nRecent conversation:\n${snippet}` }
      ], {
        maxTokens: 200,
        temperature: 0.8,
        response_format: { type: 'json_object' }
      });

      let decision: FollowupDecision;
      try {
        decision = JSON.parse(decisionRaw) as FollowupDecision;
      } catch {
        logger.warn('[NovaFollowup] Failed to parse LLM decision JSON', { raw: decisionRaw });
        return;
      }

      if (!decision.shouldFollowUp || !decision.message || decision.delayMinutes <= 0) {
        logger.info('[NovaFollowup] LLM decided no follow-up needed', { userId, reason: decision.reason });
        return;
      }

      // Cap to reasonable bounds
      const delayMinutes = Math.min(Math.max(decision.delayMinutes, 3), 12 * 60);
      const fireAt = new Date(Date.now() + delayMinutes * 60 * 1000);

      await supabaseAdmin.from('nova_followups').insert({
        user_id: userId,
        conversation_id: conversationId,
        message: decision.message,
        fire_at: fireAt.toISOString(),
        status: 'pending',
        context_summary: decision.reason?.substring(0, 200) || null,
      });

      logger.info('[NovaFollowup] Scheduled', {
        userId,
        delayMinutes,
        fireAt: fireAt.toISOString(),
        message: decision.message.substring(0, 60),
      });

    } catch (err) {
      // Fully fire-and-forget — never crash the chat flow
      logger.warn('[NovaFollowup] Error scheduling follow-up (non-critical)', {
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
