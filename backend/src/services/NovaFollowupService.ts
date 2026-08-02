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

// Deduplication cache to prevent duplicate messages
const dedupCache = new Map<string, { lastContent: string, lastSentAt: number }>();

// Per-user cooldown for the "ignored message" follow-up (prevents hammering LLM every 10s)
// Key: userId → timestamp of last ignored-follow-up LLM call
const ignoredFollowupSent = new Map<string, number>();

// Escalation level tracking: how many times Nova has tried to re-engage with no reply
// Key: userId → count. Resets when user replies.
const ignoreEscalationCount = new Map<string, number>();

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

      // Allow as low as 15s for urgent/serious follow-ups
      const baseDelayMinutes = Math.min(Math.max(Math.floor(delayHours * 60), 0.25), 24 * 60); // min 15s
      let delayMinutes = baseDelayMinutes;

      // Inject TriggerEngine for realistic timing adjustments
      const { NovaTriggerEngine } = await import('./NovaTriggerEngine');
      const triggerEngine = new NovaTriggerEngine();
      
      const { data: presenceData } = await supabaseAdmin
        .from('user_presence')
        .select('status')
        .eq('user_id', userId)
        .maybeSingle();

      const userPresence = presenceData?.status || 'offline';
      
      const trigger = await triggerEngine.shouldTrigger({
        userPresence,
        lastUserMessageAt: Date.now(),
        lastNovaReplyAt: Date.now(),
        conversationIntensity: 'casual',
        userActivity: null,
        pendingReminders: 0,
        emotionalState: null
      });

      // If TriggerEngine says we shouldn't send at all right now (e.g. rate limit), delay by 15 min
      if (!trigger.shouldSend && trigger.reason === 'rate_limited') {
        delayMinutes = Math.max(delayMinutes, 15);
      } else {
        // Adjust the base delay slightly using TriggerEngine's micro-delay logic to feel more human
        // (Convert TriggerEngine ms to minutes)
        delayMinutes += (trigger.delayMs / 60000);
      }

      // Fast path: if user is online, delay by 1-2 mins to feel natural. 
      // CRITICAL: If user is TYPING, DO NOT send it in 1 minute. Wait at least 10 minutes to avoid interrupting them!
      if (userPresence === 'typing') {
        delayMinutes = Math.max(delayMinutes, 10);
      } else if (userPresence === 'online') {
        delayMinutes = Math.min(delayMinutes, 2); // 2 minutes max if they are just staring at the screen
      }

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
   * Also resets all in-memory caches so re-engagement can happen fresh.
   */
  async cancelFollowups(userId: string): Promise<void> {
    try {
      await supabaseAdmin
        .from('nova_followups')
        .update({ status: 'cancelled' })
        .eq('user_id', userId)
        .eq('status', 'pending');
      
      // Reset in-memory caches so next ignored-message cycle starts fresh
      dedupCache.delete(userId);
      ignoredFollowupSent.delete(userId);
      ignoreEscalationCount.delete(userId);
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

    // Dedup check before inserting using cache
    const normalizedNew = followup.message.toLowerCase().trim();
    const cached = dedupCache.get(followup.user_id);
    
    // Check if same message sent within last 3 minutes (was 10 — blocked all follow-ups too long)
    if (cached && 
        Date.now() - cached.lastSentAt < 3 * 60 * 1000 && 
        (cached.lastContent === normalizedNew || 
         (normalizedNew.length > 20 && cached.lastContent.includes(normalizedNew.substring(0, 20))) ||
         (cached.lastContent.length > 20 && normalizedNew.includes(cached.lastContent.substring(0, 20))))) {
       logger.warn('[NovaFollowup] Prevented firing duplicate followup', { id: followup.id, userId: followup.user_id });
       return;
    }

    // Update cache
    dedupCache.set(followup.user_id, {
      lastContent: normalizedNew,
      lastSentAt: Date.now()
    });


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
          message: followup.message.length > 500 ? followup.message.substring(0, 497) + '...' : followup.message
        },
      }]);

      logger.info('[NovaFollowup] Push notification sent', { userId: followup.user_id });
    } else {
      logger.warn('[NovaFollowup] No push token for user', { userId: followup.user_id });
    }
  }
  /**
   * Scan for conversations where the last message was from the user (unanswered)
   * and determine the right follow-up time dynamically based on conversation seriousness.
   *
   * - Serious/emotional messages → follow up in ~2 minutes (like a real friend who noticed)
   * - Casual/short messages → follow up in ~10-15 minutes
   * - No strict rule. The goal is to NEVER make the user feel ignored.
   */
  async checkUnansweredConversations(): Promise<void> {
    try {
      // Check messages from the last hour that are from the user
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

      const { data: recentUserMsgs, error: queryErr } = await supabaseAdmin
        .from('chat_history')
        .select('id, user_id, conversation_id, content, created_at, role')
        .gte('created_at', oneHourAgo)
        .eq('role', 'user')
        .order('created_at', { ascending: false });

      if (queryErr) {
        logger.error('[NovaFollowup] Failed to query recent user msgs', { error: queryErr.message });
        return;
      }

      if (!recentUserMsgs || recentUserMsgs.length === 0) return;

      // Group by conversation — keep only the latest message per conversation
      const conversationMap = new Map();
      for (const msg of recentUserMsgs) {
        if (!conversationMap.has(msg.conversation_id)) {
          conversationMap.set(msg.conversation_id, msg);
        }
      }

      for (const [convId, userMsg] of conversationMap.entries()) {
        // Determine how serious/deep this message is
        const content = (userMsg.content || '').toLowerCase();
        const ageMinutes = (Date.now() - new Date(userMsg.created_at).getTime()) / 60000;

        // Serious signals → follow up very quickly (2 min)
        const SERIOUS_SIGNALS = [
          'stressed', 'stressed out', 'tension', 'fight', 'breakup', 'anxiety', 'anxious',
          'depressed', 'crying', 'cried', 'dukhi', 'pareshan', 'takleef', 'bura lag raha',
          'help', 'kya karu', 'samajh nahi', 'confused', 'scared', 'dar lag raha', 'nervous',
          'accident', 'emergency', 'urgent', 'important', 'bata', 'sunlo', 'sunna',
          'miss you', 'miss kar raha', 'miss kar rahi', 'alone', 'akela', 'akeli',
          'rona aa raha', 'bahut bura', 'bahut pareshan', 'kuch hua', 'problem'
        ];
        const isSerious = SERIOUS_SIGNALS.some(s => content.includes(s));
        
        // Personal/emotional but not critical → follow up in ~5 min
        const PERSONAL_SIGNALS = [
          'kaise ho', 'theek ho', 'baat karo', 'suno yaar', 'ek baat', 'batao', 'kya lagta',
          'kya sochte', 'opinion', 'feel', 'feeling', 'mood', 'pyaar', 'love', 'crush',
          'relationship', 'job', 'college', 'exam', 'result', 'interview'
        ];
        const isPersonal = PERSONAL_SIGNALS.some(s => content.includes(s));

        // Determine the cutoff based on seriousness:
        const cutoffMinutes = isSerious ? 1 : isPersonal ? 2 : 3; // was 2/4/6

        // Not old enough yet — skip for now
        if (ageMinutes < cutoffMinutes) continue;

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

        // Add additional check: was ANY assistant message sent in the last 2 minutes?
        // This handles cases where conversationId rotated or time filtering is slightly off
        const { data: recentAssistantMsgs } = await supabaseAdmin
          .from('chat_history')
          .select('id')
          .eq('user_id', userMsg.user_id)
          .eq('role', 'assistant')
          .gte('created_at', new Date(Date.now() - 90 * 1000).toISOString()) // 90s guard (was 2 min)
          .limit(1);

        if (recentAssistantMsgs && recentAssistantMsgs.length > 0) {
           continue; // Reply already sent recently
        }

        // It is stuck! Check if a follow-up is already queued OR recently sent (cooldown)
        const { data: recentFollowups } = await supabaseAdmin
          .from('nova_followups')
          .select('id')
          .eq('user_id', userMsg.user_id)
          .in('status', ['pending', 'sent'])
          .gte('created_at', new Date(Date.now() - 60 * 1000).toISOString()) // 1 min cooldown (was 5 min)
          .limit(1);
          
        if (recentFollowups && recentFollowups.length > 0) {
          continue; // Already has a pending or recently sent follow-up
        }

        // Schedule a follow-up right now using an LLM-generated context-aware message
        logger.info('[NovaFollowup] Detected stuck conversation, scheduling double-text', { userId: userMsg.user_id, convId });
        
        // Generate a context-aware follow-up rather than a generic hard-coded one
        let doubleTextMsg = "Hey?";
        try {
          const { novaBrain } = await import('./NovaBrainService');
          const lastContent = userMsg.content?.substring(0, 200) || '';
          const generated = await novaBrain.evaluateConsciousnessTier2(
            `Name: yaar\nSituation: User sent this message ${Math.round((Date.now() - new Date(userMsg.created_at).getTime()) / 60000)} minutes ago but got no reply yet: "${lastContent}"\nGenerate a very short (1 sentence max) casual Hinglish follow-up message as if you just noticed you haven't replied. Warm, not pushy. Like a friend who genuinely just noticed.`
          );
          if (generated?.message && generated.message.length < 200) {
            doubleTextMsg = generated.message;
          }
        } catch (e) {
          logger.warn('[NovaFollowup] LLM double-text generation failed, using fallback', { error: e instanceof Error ? e.message : String(e) });
        }
        
        await this.queueFollowup(userMsg.user_id, convId, doubleTextMsg, 0); // fire immediately
      }

    } catch (err) {
      logger.warn('[NovaFollowup] checkUnansweredConversations error', {
        error: err instanceof Error ? err.message : String(err)
      });
    }
  }

  /**
   * Detect when Nova sent a message and the user SAW it but didn't reply.
   * Uses escalating follow-up logic:
   *   Level 1 (90s-3min ignored): Short warm nudge
   *   Level 2 (3-6min ignored):   Topic change / new question
   *   Level 3 (6-15min ignored):  Genuinely concerned check-in
   *   Level 4 (15min+ ignored):   Give space, casual low-pressure note
   * 
   * Rate-limited to 1 LLM call per user per 3 minutes (in-memory cooldown).
   */
  async checkIgnoredNovaMessages(): Promise<void> {
    try {
      // Look for Nova messages sent 15min - 60min ago
      // We don't want to double text immediately like a needy robot! Wait at least 15 mins.
      const sixtyMinAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const fifteenMinAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();

      const { data: recentNovaMsgs, error } = await supabaseAdmin
        .from('chat_history')
        .select('id, user_id, conversation_id, content, created_at, meta')
        .eq('role', 'assistant')
        .gte('created_at', sixtyMinAgo)
        .lte('created_at', fifteenMinAgo)
        .order('created_at', { ascending: false });

      if (error || !recentNovaMsgs || recentNovaMsgs.length === 0) return;

      // Group by user — keep only the most recent Nova message per user
      const userMap = new Map<string, typeof recentNovaMsgs[0]>();
      for (const msg of recentNovaMsgs) {
        if (!userMap.has(msg.user_id)) {
          userMap.set(msg.user_id, msg);
        }
      }

      for (const [userId, novaMsg] of userMap.entries()) {
        // 🔒 Per-user LLM cooldown: max 1 ignored-follow-up LLM call per 3 minutes
        const lastSent = ignoredFollowupSent.get(userId) || 0;
        if (Date.now() - lastSent < 3 * 60 * 1000) continue;

        // Skip if user is currently typing (don't interrupt them!)
        const { data: presence } = await supabaseAdmin
          .from('user_presence')
          .select('status')
          .eq('user_id', userId)
          .maybeSingle();
        if (presence?.status === 'typing') {
          continue;
        }

        // Skip if Nova's last message evaluated the user as BUSY (e.g. user said "bye" or "10 mins")
        if (novaMsg.meta?.situationBrief?.includes('USER AVAILABILITY: User signalled they are BUSY')) {
          continue;
        }

        // Skip if user replied after Nova's message
        const { data: userReply } = await supabaseAdmin
          .from('chat_history')
          .select('id')
          .eq('user_id', userId)
          .eq('role', 'user')
          .gt('created_at', novaMsg.created_at)
          .limit(1);
        if (userReply && userReply.length > 0) {
          // User replied — reset escalation
          ignoreEscalationCount.delete(userId);
          continue;
        }

        // Skip if Nova already sent ANOTHER message after this one (within last 3 min)
        const { data: newerNova } = await supabaseAdmin
          .from('chat_history')
          .select('id, created_at')
          .eq('user_id', userId)
          .eq('role', 'assistant')
          .gt('created_at', novaMsg.created_at)
          .order('created_at', { ascending: false })
          .limit(1);
        if (newerNova && newerNova.length > 0) {
          const newerNovaAge = (Date.now() - new Date(newerNova[0].created_at).getTime()) / 1000;
          if (newerNovaAge < 180) continue; // Nova sent something < 3 min ago
        }

        // Skip if a follow-up is already queued in the next minute
        const { data: recentFollowups } = await supabaseAdmin
          .from('nova_followups')
          .select('id')
          .eq('user_id', userId)
          .eq('status', 'pending')
          .gte('created_at', new Date(Date.now() - 60 * 1000).toISOString())
          .limit(1);
        if (recentFollowups && recentFollowups.length > 0) continue;

        // Calculate ignore duration and escalation level
        const ageMinutes = (Date.now() - new Date(novaMsg.created_at).getTime()) / 60000;
        const escalation = (ignoreEscalationCount.get(userId) || 0) + 1;
        ignoreEscalationCount.set(userId, escalation);

        // Generate escalation-appropriate prompt based on age and count
        let escalationPrompt = '';
        if (escalation === 1) {
          // Level 1: First check-in after 15-30 mins
          escalationPrompt = `You sent: "${novaMsg.content.substring(0, 120)}" — ${Math.round(ageMinutes)} min ago. User hasn't replied. Send ONE short, professional yet caring nudge to check if they are busy or working. Examples: "Looks like you're busy, everything good?", "Are you in the middle of something?", "Ping me when you are free."`;
        } else if (escalation === 2) {
          // Level 2: Second check-in
          escalationPrompt = `User has ignored you twice over ${Math.round(ageMinutes)} minutes. Send a very brief, supportive note assuming they are focused on work/goals. E.g., "Must be deep in work, keep it up!", "No rush to reply, focus on your tasks."`;
        } else {
          // Level 3: Give space gracefully
          escalationPrompt = `User has gone silent for ${Math.round(ageMinutes)} minutes. Give them space — send one super short low-pressure note like "Take your time, let's catch up later!" and then stop trying.`;
        }

        logger.info('[NovaFollowup] Ignored message detected, generating escalation follow-up', { 
          userId, ageMinutes: Math.round(ageMinutes), escalation 
        });

        // Mark cooldown BEFORE LLM call
        ignoredFollowupSent.set(userId, Date.now());

        let followUpMsg = 'Bol na yaar 👀';
        try {
          const { novaBrain } = await import('./NovaBrainService');
          const generated = await novaBrain.evaluateConsciousnessTier2(
            `Name: yaar\nSituation: ${escalationPrompt}\nOutput ONE short Hinglish message only. Max 1 sentence.`
          );
          if (generated?.message && generated.message.length < 150) {
            followUpMsg = generated.message;
          }
        } catch (e) {
          logger.warn('[NovaFollowup] LLM escalation gen failed, using fallback', { escalation });
        }

        // Level 3: stop escalating after giving space
        if (escalation >= 3) {
          ignoreEscalationCount.delete(userId); // Reset so NACE takes over
        }

        await this.queueFollowup(userId, novaMsg.conversation_id, followUpMsg, 0);
      }
    } catch (err) {
      logger.warn('[NovaFollowup] checkIgnoredNovaMessages error', {
        error: err instanceof Error ? err.message : String(err)
      });
    }
  }
}

export const novaFollowupService = new NovaFollowupService();
