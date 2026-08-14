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

// ── Sleep / unavailability signal classification ──────────────────────────────
// Shared by queueFollowup's guard, chat.ts's immediate lock (recordUnavailability),
// and the unseen-check-in path in checkIgnoredNovaMessages.
const SLEEP_SIGNALS = [
  'soone ja', 'so ja', 'so raha hoon', 'so rahi hoon', 'neend aa', 'raat ko so',
  'going to sleep', 'going to bed', 'sleeping now', 'good night', 'goodnight',
  'gn ', 'gn\n', 'bye', 'byee', 'byebye', 'chalta hoon', 'chalti hoon',
  'chalte hai', 'nikal raha', 'nikal rahi', 'baad mein baat', 'baad mein reply',
  'call aaya', 'meeting me hoon', 'busy hoon', 'baad mein baat karta', 'abhi baad me',
  'so jaunga', 'so jaungi', 'sone wala hoon', 'nap le raha', 'nap le rahi'
];
// Subset that means the user is genuinely asleep → long (8h) lock. Everything else in
// SLEEP_SIGNALS is "busy / stepping away" → short (2h) lock.
const TRULY_SLEEP_SIGNALS = [
  'soone ja', 'so ja', 'so raha', 'so rahi', 'neend aa',
  'going to sleep', 'going to bed', 'sleeping now', 'good night', 'goodnight',
  'gn ', 'so jaunga', 'so jaungi', 'sone wala', 'nap le'
];
const SLEEP_LOCK_HOURS = 8;
const BUSY_LOCK_HOURS = 2;

// ── Seen/unseen classification for checkIgnoredNovaMessages ───────────────────
// A user counts as "seen / left on read" only if they are ACTIVELY in the app right
// now (status online + a heartbeat within the last few minutes). A stale 'online'
// (app killed) or a backgrounded 'away' must NOT trigger the quick nudge.
const SEEN_RECENCY_MS = 5 * 60 * 1000;  // heartbeat must be within 5 min
const UNSEEN_CHECK_IN_HOURS = 3.5;      // 3–4h deferred check-in after an unseen Nova message
const UNSEEN_MAX_CHECK_INS = 3;         // up to 3 check-ins, then give space (user's choice)
const UNSEEN_COUNTER_KEY = 'nova_ignored_deferred_count';

export function classifyUnavailability(text: string): { type: 'sleep' | 'busy'; hours: number } | null {
  const lower = text.toLowerCase();
  if (TRULY_SLEEP_SIGNALS.some(s => lower.includes(s))) return { type: 'sleep', hours: SLEEP_LOCK_HOURS };
  if (SLEEP_SIGNALS.some(s => lower.includes(s))) return { type: 'busy', hours: BUSY_LOCK_HOURS };
  return null;
}

export class NovaFollowupService {

  /**
   * Queue the next follow-up message from Nova Brain.
   */
  async queueFollowup(
    userId: string,
    conversationId: string,
    message: string,
    delayHours: number,
    opts?: { cancelExisting?: boolean }
  ): Promise<void> {
    try {
      // ── SLEEP & UNAVAILABILITY GUARD ─────────────────────────────────────────
      // Before queuing ANY follow-up, check if the user recently said they are
      // sleeping, going somewhere, or explicitly said they're busy/unavailable.
      // If so, suppress all follow-ups for the appropriate duration.
      // (Only the MOST RECENT user message counts — if the user has sent anything
      // since the sleep signal, they are clearly awake and active again.)
      const unavailability = await this._detectUnavailability(userId);
      if (unavailability) {
        logger.info(`[NovaFollowup] 🛑 Sleep/unavailability detected — suppressing for ${unavailability.hours}h`, { userId });
        await this._writeSuppression(userId, unavailability.hours);
        await this._cancelPendingFollowups(userId);
        return; // Do NOT queue a follow-up
      }

      const cancelExisting = opts?.cancelExisting ?? true;
      if (cancelExisting) {
        await this._cancelPendingFollowups(userId);
      }

      // MINIMUM 15 MINUTES for any follow-up. Never follow up in seconds.
      // The old 0.25 min (15s) minimum caused the 36-message spam. Real friends don't text every 4 minutes.
      const MINIMUM_FOLLOWUP_MINUTES = 15;
      // Guard against a missing/invalid delay from the LLM: Math.floor(undefined * 60) is
      // NaN, which would make fireAt an Invalid Date and .toISOString() throw, silently
      // dropping the follow-up (caught by the non-critical handler below).
      const safeDelayHours = Number.isFinite(delayHours) ? delayHours : 0.5;
      const baseDelayMinutes = Math.min(Math.max(Math.floor(safeDelayHours * 60), MINIMUM_FOLLOWUP_MINUTES), 24 * 60);
      let delayMinutes = baseDelayMinutes;

      // Inject TriggerEngine for realistic timing adjustments.
      // Use the shared singleton so the 30 req/min rate limit is actually tracked —
      // a fresh `new NovaTriggerEngine()` has an empty requestTimestamps every call,
      // so the rate limit could never fire.
      const { novaTriggerEngine } = await import('./NovaTriggerEngine');
      
      const { data: presenceData } = await supabaseAdmin
        .from('user_presence')
        .select('status')
        .eq('user_id', userId)
        .maybeSingle();

      const userPresence = presenceData?.status || 'offline';
      
      const trigger = await novaTriggerEngine.shouldTrigger({
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

      // Fast path: if user is typing, give them plenty of time.
      if (userPresence === 'typing') {
        delayMinutes = Math.max(delayMinutes, 10);
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

      // Clear DB suppression — user replied, so Nova can re-engage in future sessions.
      // Also clear the unseen check-in counter (DB-persisted so it survives restarts).
      await supabaseAdmin
        .from('working_memory')
        .delete()
        .eq('user_id', userId)
        .in('key', ['followup_suppressed_until', UNSEEN_COUNTER_KEY]);
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
    // Sleep-lock respect: never fire a pre-queued follow-up while the user is
    // suppressed (e.g. they said "good night"). Leave it pending so it fires after
    // the suppression clears, or gets cancelled by the sleep-guard.
    try {
      const { data: suppression } = await supabaseAdmin
        .from('working_memory')
        .select('value')
        .eq('user_id', followup.user_id)
        .eq('key', 'followup_suppressed_until')
        .maybeSingle();
      if (suppression?.value && new Date(suppression.value).getTime() > Date.now()) {
        logger.info('[NovaFollowup] Deferred follow-up: user is suppressed (sleep/busy)', { id: followup.id, userId: followup.user_id });
        return; // leave pending — fires after suppression clears
      }
    } catch (err) {
      logger.warn('[NovaFollowup] Suppression check failed during fire — proceeding', {
        error: err instanceof Error ? err.message : String(err)
      });
    }

    // Dedup check BEFORE claiming, so a duplicate doesn't consume the claim.
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

    // Atomic claim — only one concurrent poll wins (prevents double-fire). `.select('id')`
    // is REQUIRED: without it supabase-js returns { data: null } whether 0 or 1 rows matched,
    // so a losing poll could not distinguish "I won" from "I lost" and would fire anyway.
    const { data: locked, error: updateErr } = await supabaseAdmin
      .from('nova_followups')
      .update({ status: 'sent' })
      .eq('id', followup.id)
      .eq('status', 'pending') // optimistic lock
      .select('id');

    if (updateErr || !locked || locked.length === 0) {
      logger.warn('[NovaFollowup] Could not lock followup for firing (may be racing)', { id: followup.id });
      return;
    }

    try {
      // Deliver FIRST — insert as Nova's message in chat history. If this fails the
      // follow-up must be retried, not silently dropped (the old code marked it 'sent'
      // before delivery, so any failure permanently lost the message).
      const { error: insertErr } = await supabaseAdmin.from('chat_history').insert({
        user_id: followup.user_id,
        conversation_id: followup.conversation_id,
        role: 'assistant',
        content: followup.message,
      });
      if (insertErr) throw new Error(`chat_history insert failed: ${insertErr.message}`);

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
    } catch (err) {
      // Delivery failed — revert the claim so the next poll retries, and clear the
      // dedup cache so the retry isn't blocked by the recent-sent check.
      logger.error('[NovaFollowup] Delivery failed, reverting followup to pending for retry', {
        id: followup.id,
        error: err instanceof Error ? err.message : String(err)
      });
      dedupCache.delete(followup.user_id);
      await supabaseAdmin
        .from('nova_followups')
        .update({ status: 'pending' })
        .eq('id', followup.id)
        .eq('status', 'sent');
      throw err;
    }

    // Delivery succeeded — now it's safe to remember the message for dedup.
    dedupCache.set(followup.user_id, {
      lastContent: normalizedNew,
      lastSentAt: Date.now()
    });
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
        // CRITICAL FIX: Old values (1/2/3 min) were firing BEFORE the LLM (30s timeout)
        // had time to respond, creating a cascade: Nova times out → stuck detector fires
        // immediately → queues fallback → user sees "Busy lag raha hai" instead of a reply.
        // New values give the LLM + async pipeline enough time to complete.
        const cutoffMinutes = isSerious ? 5 : isPersonal ? 7 : 10;

        // Not old enough yet — skip for now
        if (ageMinutes < cutoffMinutes) continue;

        const { data: newerMsgs } = await supabaseAdmin
          .from('chat_history')
          .select('id, content')
          .eq('conversation_id', convId)
          .gt('created_at', userMsg.created_at)
          .limit(1);

        if (newerMsgs && newerMsgs.length > 0) {
          if (newerMsgs[0].content === 'Hmm... mujhe thoda sochne de, main abhi batati hu thodi der me.') {
            logger.info('[NovaFollowup] Found fallback reply, treating conversation as stuck', { convId });
          } else {
            // Nova (or someone) replied a real message after this message. It's not stuck.
            continue;
          }
        }

        // Add additional check: was ANY assistant message sent in the last 2 minutes?
        // This handles cases where conversationId rotated or time filtering is slightly off
        const { data: recentAssistantMsgs } = await supabaseAdmin
          .from('chat_history')
          .select('id, content')
          .eq('user_id', userMsg.user_id)
          .eq('role', 'assistant')
          .gte('created_at', new Date(Date.now() - 90 * 1000).toISOString()) // 90s guard (was 2 min)
          .limit(1);

        if (recentAssistantMsgs && recentAssistantMsgs.length > 0) {
           if (recentAssistantMsgs[0].content === 'Hmm... mujhe thoda sochne de, main abhi batati hu thodi der me.') {
             // Fallback doesn't count as a real reply
           } else {
             continue; // Real reply already sent recently
           }
        }

        // It is stuck! Check if a follow-up is already queued (fire_at in the future)
        // OR recently sent (cooldown). The "queued with a future fire_at" check is what
        // prevents the re-queue loop: this poll runs every 10s, but a queued follow-up's
        // fire_at is ~15 min out — the old 5-minute created_at window expired before it
        // fired, so every poll cancelled it and queued a NEW one (+15 min each time),
        // postponing delivery to ~75 min and churning DB rows.
        const nowIso = new Date().toISOString();
        const fiveMinAgoIso = new Date(Date.now() - 5 * 60 * 1000).toISOString();
        const [pendingFuture, recentSent] = await Promise.all([
          supabaseAdmin
            .from('nova_followups')
            .select('id')
            .eq('user_id', userMsg.user_id)
            .eq('status', 'pending')
            .gt('fire_at', nowIso)
            .limit(1),
          supabaseAdmin
            .from('nova_followups')
            .select('id')
            .eq('user_id', userMsg.user_id)
            .eq('status', 'sent')
            .gte('created_at', fiveMinAgoIso)
            .limit(1),
        ]);

        if ((pendingFuture.data && pendingFuture.data.length > 0) ||
            (recentSent.data && recentSent.data.length > 0)) {
          continue; // A follow-up is already scheduled to fire, or one was just sent
        }

        // Schedule a follow-up right now using an LLM-generated context-aware message
        logger.info('[NovaFollowup] Detected stuck conversation, scheduling double-text', { userId: userMsg.user_id, convId });
        
        // Generate a context-aware follow-up rather than a generic hard-coded one
        // FALLBACK: Use a neutral "I missed your message" tone — NOT "busy lag raha hai"
        // because saying the user is busy when Nova is the one who didn't reply is wrong.
        let doubleTextMsg = "Arre yaar, lagta hai mera message pehunch nahi gaya — phir se baat karte hain!";
        try {
          const { novaBrain } = await import('./NovaBrainService');
          const lastContent = userMsg.content?.substring(0, 200) || '';
          const generated = await novaBrain.evaluateConsciousnessTier2(
            `Name: yaar\nSituation: User sent this message ${Math.round((Date.now() - new Date(userMsg.created_at).getTime()) / 60000)} minutes ago but got no reply yet: "${lastContent}"\nGenerate a short casual Hinglish reply directly answering their message. Make it sound natural, as if you just got a chance to respond. Do NOT say the user is busy or apologize heavily, just answer them.`
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
        // Per-user LLM cooldown: max 1 ignored-follow-up LLM call per 3 minutes
        const lastSent = ignoredFollowupSent.get(userId) || 0;
        if (Date.now() - lastSent < 3 * 60 * 1000) continue;

        // Skip if user replied after Nova's message
        const { data: userReply } = await supabaseAdmin
          .from('chat_history')
          .select('id')
          .eq('user_id', userId)
          .eq('role', 'user')
          .gt('created_at', novaMsg.created_at)
          .limit(1);
        if (userReply && userReply.length > 0) {
          ignoreEscalationCount.delete(userId);
          continue;
        }

        // Skip if Nova already sent another message after this one (within last 2h)
        const { data: newerNova } = await supabaseAdmin
          .from('chat_history')
          .select('id, created_at')
          .eq('user_id', userId)
          .eq('role', 'assistant')
          .gt('created_at', novaMsg.created_at)
          .order('created_at', { ascending: false })
          .limit(1);
        if (newerNova && newerNova.length > 0) {
          const novaAgeMin = (Date.now() - new Date(newerNova[0].created_at).getTime()) / 60000;
          if (novaAgeMin < 120) continue;
        }

        // ── SEEN vs UNSEEN classification ──────────────────────────────────────
        const { data: presence } = await supabaseAdmin
          .from('user_presence')
          .select('status, updated_at')
          .eq('user_id', userId)
          .maybeSingle();

        const presenceAt = presence?.updated_at ? new Date(presence.updated_at).getTime() : 0;
        const isOnline = presence?.status === 'online' || presence?.status === 'typing';
        const activelyInApp = isOnline && Date.now() - presenceAt < SEEN_RECENCY_MS;

        // Skip if Nova's last message was marked BUSY
        if (novaMsg.meta?.situationBrief?.includes('USER AVAILABILITY: User signalled they are BUSY')) {
          continue;
        }

        // Suppression lock check (sleep/busy/24h give-space)
        const { data: suppression } = await supabaseAdmin
          .from('working_memory')
          .select('value')
          .eq('user_id', userId)
          .eq('key', 'followup_suppressed_until')
          .maybeSingle();
        if (suppression?.value && Date.now() < new Date(suppression.value).getTime()) {
          continue;
        }

        // Skip if a follow-up is already pending within 2h
        const { data: recentPending } = await supabaseAdmin
          .from('nova_followups')
          .select('id')
          .eq('user_id', userId)
          .eq('status', 'pending')
          .gte('created_at', new Date(Date.now() - 120 * 60 * 1000).toISOString())
          .limit(1);
        if (recentPending && recentPending.length > 0) continue;

        const ageMinutes = (Date.now() - new Date(novaMsg.created_at).getTime()) / 60000;

        // ── SEEN: user is actively in-app → quick 15-30 min nudge ──────────────
        if (activelyInApp) {
          const escalation = (ignoreEscalationCount.get(userId) || 0) + 1;
          ignoreEscalationCount.set(userId, escalation);

          let prompt = '';
          let fallback = '';
          if (escalation === 1) {
            prompt = `You sent: "${novaMsg.content.substring(0, 120)}" — ${Math.round(ageMinutes)} min ago. User is ONLINE RIGHT NOW and hasn't replied yet — left on read. Send ONE short, casual nudge. E.g., "Arey, busy ho kya?", "Kaam me phasa hai kya?";`;
            fallback = 'Arey, busy hai kya? Jab time mile tab batana!';
          } else {
            prompt = `User has ignored you over ${Math.round(ageMinutes)} minutes. Send a brief, low-pressure closing note and stop. E.g., "Catch up later!";`;
            fallback = 'Koi na, kaam pe focus kar. Phir baat karte hain!';
          }

          ignoredFollowupSent.set(userId, Date.now());

          let msg = fallback;
          try {
            const { novaBrain } = await import('./NovaBrainService');
            const gen = await novaBrain.evaluateConsciousnessTier2(
              `Name: yaar\nSituation: ${prompt}\nOutput ONE short Hinglish message only. Max 1 sentence.`
            );
            if (gen?.message && gen.message.length < 150 && !gen.message.includes('Bol na')) msg = gen.message;
          } catch (e) {
            logger.warn('[NovaFollowup] LLM gen failed', { escalation });
          }

          if (escalation >= 2) {
            ignoreEscalationCount.delete(userId);
            await this._writeSuppression(userId, 24);
          }

          logger.info('[NovaFollowup] Seen (left on read) — queuing nudge', { userId, ageMinutes: Math.round(ageMinutes), escalation });
          await this.queueFollowup(userId, novaMsg.conversation_id, msg, 0);
          continue;
        }

        // ── UNSEEN: user is offline → deferred 3.5h check-in (up to UNSEEN_MAX_CHECK_INS) ──
        const { data: countRow } = await supabaseAdmin
          .from('working_memory')
          .select('value')
          .eq('user_id', userId)
          .eq('key', UNSEEN_COUNTER_KEY)
          .maybeSingle();
        const unseenCount = parseInt(countRow?.value || '0', 10) || 0;

        if (unseenCount >= UNSEEN_MAX_CHECK_INS) {
          await this._writeSuppression(userId, 24);
          logger.info('[NovaFollowup] Unseen cap reached — giving space', { userId, count: unseenCount });
          continue;
        }

        let deferredMsg = 'Arre, kaisa chal raha? Bas check kar raha tha — kabhi free ho toh bata dena.';
        ignoredFollowupSent.set(userId, Date.now());
        try {
          const { novaBrain } = await import('./NovaBrainService');
          const gen = await novaBrain.evaluateConsciousnessTier2(
            `Name: yaar\nSituation: You sent "${novaMsg.content.substring(0, 100)}" ${Math.round(ageMinutes)} min ago. User hasn't been online since. Send ONE short, very low-pressure check-in that does NOT demand a reply. E.g., "No rush, just thinking about you — jab free ho tab baat karte hain.";`
          );
          if (gen?.message && gen.message.length < 150 && !gen.message.includes('Bol na')) deferredMsg = gen.message;
        } catch (e) {
          logger.warn('[NovaFollowup] Unseen check-in gen failed, using fallback');
        }

        const checkInAtMs = new Date(novaMsg.created_at).getTime() + UNSEEN_CHECK_IN_HOURS * 3600e3;
        await this._writeSuppression(userId, (checkInAtMs - Date.now()) / 3600e3);
        await this.queueFollowup(userId, novaMsg.conversation_id, deferredMsg, (checkInAtMs - Date.now()) / 3600e3, { cancelExisting: false });

        await supabaseAdmin.from('working_memory').upsert({
          user_id: userId,
          key: UNSEEN_COUNTER_KEY,
          value: String(unseenCount + 1),
          expires_at: new Date(Date.now() + 48 * 3600e3).toISOString()
        }, { onConflict: 'user_id,key' });

        logger.info('[NovaFollowup] Unseen — deferred check-in booked', {
          userId, ageMinutes: Math.round(ageMinutes), checkInAt: new Date(checkInAtMs).toISOString(), count: unseenCount + 1
        });
      }
    } catch (err) {
      logger.warn('[NovaFollowup] checkIgnoredNovaMessages error', {
        error: err instanceof Error ? err.message : String(err)
      });
    }
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  private async _writeSuppression(userId: string, hours: number): Promise<void> {
    const until = new Date(Date.now() + Math.max(0, hours) * 60 * 60 * 1000);
    await supabaseAdmin.from('working_memory').upsert({
      user_id: userId,
      key: 'followup_suppressed_until',
      value: until.toISOString(),
      expires_at: until.toISOString()
    }, { onConflict: 'user_id,key' });
  }

  private async _cancelPendingFollowups(userId: string): Promise<void> {
    await supabaseAdmin
      .from('nova_followups')
      .update({ status: 'cancelled' })
      .eq('user_id', userId)
      .eq('status', 'pending');
  }

  private async _detectUnavailability(userId: string): Promise<{ type: 'sleep' | 'busy'; hours: number } | null> {
    const twelveHoursAgo = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
    const { data: recentUserMsgs } = await supabaseAdmin
      .from('chat_history')
      .select('content, created_at')
      .eq('user_id', userId)
      .eq('role', 'user')
      .gte('created_at', twelveHoursAgo)
      .order('created_at', { ascending: false })
      .limit(5);
    const newestMsg = recentUserMsgs && recentUserMsgs.length > 0 ? recentUserMsgs[0] : null;
    if (!newestMsg?.content) return null;
    return classifyUnavailability(newestMsg.content);
  }

  /**
   * Immediately record a sleep/unavailability signal from a user's raw message.
   * Writes the DB suppression lock (8h sleep / 2h busy) and cancels pending
   * follow-ups so NACE and the follow-up engines stay silent.
   * Returns true if a lock was written, false otherwise.
   * The caller should call cancelFollowups() when this returns false.
   */
  async recordUnavailability(userId: string, hours: number): Promise<boolean> {
    try {
      logger.info(`[NovaFollowup] 🛑 Immediate unavailability lock — suppressing for ${hours}h`, { userId });
      const until = new Date(Date.now() + hours * 60 * 60 * 1000);
      await supabaseAdmin.from('working_memory').upsert({
        user_id: userId,
        key: 'followup_suppressed_until',
        value: until.toISOString(),
        expires_at: until.toISOString()
      }, { onConflict: 'user_id,key' });
      // Cancel all pending follow-ups (same as the sleep-guard in queueFollowup)
      await supabaseAdmin
        .from('nova_followups')
        .update({ status: 'cancelled' })
        .eq('user_id', userId)
        .eq('status', 'pending');
      return true;
    } catch (err) {
      logger.warn('[NovaFollowup] Error writing unavailability lock', {
        error: err instanceof Error ? err.message : String(err)
      });
      return false;
    }
  }
}

export const novaFollowupService = new NovaFollowupService();
