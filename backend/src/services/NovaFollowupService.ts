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
import { saveAssistantMessage } from './ChatHistoryHelpers';
import { logger } from '../lib/logger';
import { sendNovaReplyNotification } from '../lib/pushNotifications';
import { proactiveGate } from './ProactiveGate';

// NOTE: Global proactive cooldown is now enforced by ProactiveGate (DB-backed).
// lastProactiveSentAt and GLOBAL_PROACTIVE_COOLDOWN_MS removed — they reset on server restart.


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
const UNSEEN_MAX_CHECK_INS = 5;          // up to 5 offline check-ins with exponential backoff
const UNSEEN_COUNTER_KEY = 'nova_ignored_deferred_count';

// Exponential backoff schedule for OFFLINE users (hours):
// Attempt 1 → 1 min, 2 → 2 min, 3 → 4 min, 4 → 8 min, 5 → 16 min, then 3-4h cap
// After UNSEEN_MAX_CHECK_INS consecutive ignores, give full 24h space.
function offlineBackoffHours(attempt: number): number {
  if (attempt <= 0) return 1 / 60; // 1 minute
  const minuteBackoff = Math.pow(2, attempt); // 1, 2, 4, 8, 16 mins
  const cappedMinutes = Math.min(minuteBackoff, 3.5 * 60); // cap at 3.5 hours
  return cappedMinutes / 60;
}

export function classifyUnavailability(text: string): { type: 'sleep' | 'busy'; hours: number } | null {
  const lower = text.toLowerCase();
  if (TRULY_SLEEP_SIGNALS.some(s => lower.includes(s))) return { type: 'sleep', hours: SLEEP_LOCK_HOURS };
  if (SLEEP_SIGNALS.some(s => lower.includes(s))) return { type: 'busy', hours: BUSY_LOCK_HOURS };
  return null;
}

export class NovaFollowupService {

  /**
   * Get user's local hour from their timezone_offset (stored in minutes, e.g. 330 = IST).
   * Returns the hour (0-23) in the user's local timezone.
   */
  private async _getUserLocalHour(userId: string): Promise<number> {
    try {
      const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('timezone_offset')
        .eq('id', userId)
        .maybeSingle();
      const tzOffsetMinutes = profile?.timezone_offset ?? 0; // default UTC
      const now = new Date();
      const localMs = now.getTime() + (tzOffsetMinutes * 60 * 1000);
      return new Date(localMs).getUTCHours();
    } catch {
      return new Date().getUTCHours(); // fallback to UTC
    }
  }

  /**
   * Check if the user's local time is in quiet hours (11 PM – 7:30 AM).
   * Returns true if proactive messages should be suppressed.
   */
   private async _isQuietHours(userId: string): Promise<boolean> {
    const hour = await this._getUserLocalHour(userId);
    // Quiet: 23:00–23:59 (11 PM–midnight) and 00:00–06:59 (midnight–7 AM)
    // We only have integer hours, so we allow from hour 7 onwards (7:00 AM+).
    return hour >= 23 || hour < 7;
  }

  /**
   * Check if the user has received a follow-up after the last assistant message
   * without replying in between. Prevents infinite follow-up chaining.
   * Returns true if Nova already sent a follow-up that wasn't answered.
   */
  private async _hasUnansweredFollowup(userId: string): Promise<boolean> {
    try {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      // Get the most recent assistant message
      const { data: lastAssistant } = await supabaseAdmin
        .from('chat_history')
        .select('id, created_at, meta')
        .eq('user_id', userId)
        .eq('role', 'assistant')
        .gte('created_at', oneHourAgo)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!lastAssistant) return false;

      // Check if there was a user reply after it
      const { data: userReply } = await supabaseAdmin
        .from('chat_history')
        .select('id')
        .eq('user_id', userId)
        .eq('role', 'user')
        .gt('created_at', lastAssistant.created_at)
        .limit(1)
        .maybeSingle();

      if (userReply) return false; // User replied → chain is broken

      // Check if this assistant message came from a follow-up service (not the main chat)
      const source = lastAssistant.meta?.source;
      const isFollowupSource = source === 'NovaFollowupService' || source === 'NovaConsciousnessEngine';

      // If the last assistant message was from a follow-up service and user hasn't replied,
      // we already sent one follow-up → don't chain another
      if (isFollowupSource) return true;

      return false;
    } catch {
      return false; // fail open
    }
  }

  /**
   * Queue the next follow-up message from Nova Brain.
   */
  async queueFollowup(
    userId: string,
    conversationId: string,
    message: string,
    delayHours: number,
    opts?: { cancelExisting?: boolean; isOnlineNudge?: boolean }
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

      // Minimum follow-up gate:
      // - Online nudge (user is actively in app) → 1 minute minimum so Nova can be back-to-back
      // - All other follow-ups → 15 minutes minimum (prevents the 36-message spam pattern)
      const isOnlineNudge = opts?.isOnlineNudge ?? false;
      const MINIMUM_FOLLOWUP_MINUTES = isOnlineNudge ? 1 : 15;
      // Guard against a missing/invalid delay from the LLM
      const safeDelayHours = Number.isFinite(delayHours) ? delayHours : 0.5;
      const baseDelayMinutes = safeDelayHours === 0 ? 0 : Math.min(Math.max(Math.floor(safeDelayHours * 60), MINIMUM_FOLLOWUP_MINUTES), 24 * 60);
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
      
      // Mark all unreplied outreaches as replied — resets DB-backed ignored count
      await proactiveGate.markReplied(userId, new Date().toISOString());

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
    try {
      // P0-3: Active Conversation Debounce
      // Check if user sent a message in this conversation after the followup was created
      const { data: recentUserMsg } = await supabaseAdmin
        .from('chat_history')
        .select('id, created_at')
        .eq('conversation_id', followup.conversation_id)
        .eq('role', 'user')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (recentUserMsg) {
        // If the user's message is newer than the followup's created_at, they already replied.
        if (new Date(recentUserMsg.created_at) > new Date(followup.created_at)) {
          logger.info('[NovaFollowup] Cancelled followup: user already replied to the conversation', { followupId: followup.id });
          await supabaseAdmin.from('nova_followups').update({ status: 'cancelled' }).eq('id', followup.id);
          return;
        }
      }

      // Fetch timezone offset and profile data for ProactiveGate and Push
      const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('timezone_offset, push_token')
        .eq('id', followup.user_id)
        .maybeSingle();
      const tzOffset = profile?.timezone_offset ?? 0;

      // P0-1: Single Authoritative Proactive Pipeline
      const gateDecision = await proactiveGate.acquire(followup.user_id, {
        outreachType: 'proactive', 
        logicalKey: `followup:fired:${followup.id}`,
        logicalKeyWindowMinutes: 60, // duplicate suppression
        skipQuietHoursCheck: false,  // P0-2: ALWAYS check quiet hours at FIRE time
        skipMinGapCheck: false,      // P0-2: ALWAYS check burden at FIRE time
        proposedMessage: followup.message,
        timezoneOffsetMinutes: tzOffset,
      });

      if (!gateDecision.allowed) {
        // P0-2: Blocked by timing, presence, or burden at fire time
        logger.info('[NovaFollowup] Deferred/Blocked follow-up at fire time', { 
          id: followup.id, 
          blockedBy: gateDecision.blockedBy,
          detail: gateDecision.detail
        });
        
        // Cancel if blocked by duplicate logic, else leave pending to retry later
        if (gateDecision.blockedBy === 'duplicate_logical_key' || gateDecision.blockedBy === 'duplicate_content') {
           await supabaseAdmin.from('nova_followups').update({ status: 'cancelled' }).eq('id', followup.id);
        }
        return; 
      }

      // Atomic claim — only one concurrent poll wins.
      const { data: locked, error: updateErr } = await supabaseAdmin
        .from('nova_followups')
        .update({ status: 'sent' })
        .eq('id', followup.id)
        .eq('status', 'pending') // optimistic lock
        .select('id');

      if (updateErr || !locked || locked.length === 0) {
        logger.warn('[NovaFollowup] Could not lock followup for firing (may be racing)', { id: followup.id });
        await proactiveGate.release(gateDecision.outreachId);
        return;
      }

      try {
        // Deliver FIRST — insert as Nova's message in chat history.
        const insertErr = await saveAssistantMessage(
          followup.user_id,
          followup.conversation_id,
          followup.message,
          'NovaFollowupService',
          undefined,
          { sourceType: 'followup', outreachLogId: gateDecision.outreachId }   // P0-C: attribution
        ).then(() => null).catch((e: any) => e);

        if (insertErr) throw new Error(`chat_history insert failed: ${insertErr.message}`);

        // Commit the gate reservation
        await proactiveGate.commit(gateDecision.outreachId, followup.message);

        // Fetch push token and send notification via unified method
        if (profile?.push_token) {
          // P0-1: Use the canonical sendNovaReplyNotification instead of manual FCM payload
          await sendNovaReplyNotification(
            profile.push_token,
            followup.message,
            followup.conversation_id
          ).catch((e) => {
             logger.warn('[NovaFollowup] Failed to send push notification (non-critical)', { error: e.message });
          });
        }
      } catch (err) {
        // Delivery failed — revert the claim so the next poll retries, and release gate
        logger.error('[NovaFollowup] Delivery failed, reverting followup to pending for retry', {
          id: followup.id,
          error: err instanceof Error ? err.message : String(err)
        });
        await proactiveGate.release(gateDecision.outreachId);
        await supabaseAdmin
          .from('nova_followups')
          .update({ status: 'pending' })
          .eq('id', followup.id)
          .eq('status', 'sent');
        throw err;
      }
    } catch (err) {
       logger.error('[NovaFollowup] Unexpected error in _fireFollowup', { error: err instanceof Error ? err.message : String(err) });
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
        // ── QUIET HOURS GUARD (Fix #1) ─────────────────────────────────────────
        if (await this._isQuietHours(userMsg.user_id)) {
          // Check if user messaged within last 10 min (they just sent this message, so yes)
          // Since this IS a response to a user message, we allow it during quiet hours
          // but only if the user message is recent (within 10 min)
          const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
          const userMsgTime = new Date(userMsg.created_at).toISOString();
          if (userMsgTime < tenMinAgo) {
            continue; // User's message was old — don't follow up in quiet hours
          }
        }

        // ── PROACTIVE GATE (replaces in-memory global cooldown) ──────────────────
        // DB-backed gate ensures cross-engine dedup even after server restart.
        const profile = await supabaseAdmin
          .from('profiles')
          .select('timezone_offset')
          .eq('id', userMsg.user_id)
          .maybeSingle();
        const tzOffset = profile.data?.timezone_offset ?? 0;

        const unanswGateDecision = await proactiveGate.acquire(userMsg.user_id, {
          outreachType: 'engagement_checkin',
          logicalKey: `followup:unanswered:${convId}:${userMsg.id}`,
          logicalKeyWindowMinutes: 30,
          skipQuietHoursCheck: true, // already checked above
          skipMinGapCheck: true,     // unanswered = Nova failed to reply, not spam
          timezoneOffsetMinutes: tzOffset,
        });

        if (!unanswGateDecision.allowed) {
          logger.info('[NovaFollowup] Unanswered gate blocked', { userId: userMsg.user_id, blockedBy: unanswGateDecision.blockedBy });
          continue;
        }

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
        const cutoffMinutes = isSerious ? 2 : isPersonal ? 3 : 5;

        // Not old enough yet — skip for now
        if (ageMinutes < cutoffMinutes) continue;

        const { data: newerMsgs } = await supabaseAdmin
          .from('chat_history')
          .select('id, role, content')
          .eq('conversation_id', convId)
          .eq('role', 'assistant')  // BUG-05 fix: must be an assistant reply, not just any message
          .gt('created_at', userMsg.created_at)
          .limit(1);

        if (newerMsgs && newerMsgs.length > 0) {
          if (newerMsgs[0].content === 'Hmm... mujhe thoda sochne de, main abhi batati hu thodi der me.') {
            logger.info('[NovaFollowup] Found fallback reply, treating conversation as stuck', { convId });
          } else {
            // Nova replied with a real message after this user message. Not stuck.
            // BUG-05: Release the gate reservation so this valid reply doesn't pollute ignoredCount
            await proactiveGate.release(unanswGateDecision.outreachId);
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
      // ── QUIET HOURS GUARD (Fix #1) ─────────────────────────────────────────
      // Suppress all unsolicited follow-ups during 11 PM – 7:30 AM local time.
      // Only allow if the user sent a message within the last 10 minutes (they're awake).
      const quietUsers = new Set<string>();
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
        // ── QUIET HOURS GUARD: Check per-user local time ─────────────────────────
        if (quietUsers.has(userId)) {
          // User is in quiet hours and didn't message recently
          continue;
        }
        const isQuiet = await this._isQuietHours(userId);
        if (isQuiet) {
          // Check if user messaged within last 10 min — if so, they're awake
          const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
          const { data: recentUserMsg } = await supabaseAdmin
            .from('chat_history')
            .select('id')
            .eq('user_id', userId)
            .eq('role', 'user')
            .gte('created_at', tenMinAgo)
            .limit(1)
            .maybeSingle();
          if (!recentUserMsg) {
            quietUsers.add(userId);
            continue; // Suppress all proactive follow-ups in quiet hours
          }
        }

        // ── PROACTIVE GATE: replaces in-memory _checkProactiveCooldown ──────────────
        // DB-backed gate enforces cross-engine dedup even after Render restart.
        const ignoredGateDecision = await proactiveGate.acquire(userId, {
          outreachType: 'engagement_checkin',
          logicalKey: `followup:ignored:${novaMsg.id}`,
          logicalKeyWindowMinutes: 60,
          skipQuietHoursCheck: true, // already checked above
          skipMinGapCheck: false,    // gate enforces escalation cooldown
        });

        if (!ignoredGateDecision.allowed) {
          logger.info('[NovaFollowup] Ignored-message gate blocked', {
            userId, blockedBy: ignoredGateDecision.blockedBy, msgId: novaMsg.id
          });
          continue;
        }

        // Reserve outreachId — will release if generation fails
        const ignoredOutreachId = ignoredGateDecision.outreachId;

        // ── ANTI-CHAINING GUARD: Don't follow up on our own follow-ups ──────────────
        if (await this._hasUnansweredFollowup(userId)) {
          logger.info('[NovaFollowup] Unanswered follow-up already exists — not chaining', { userId });
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
          await supabaseAdmin.from('working_memory').delete().eq('user_id', userId).eq('key', 'ignore_escalation_count');
          await proactiveGate.release(ignoredOutreachId); // release — not spam, user replied
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

        // ── SEEN: user is actively in-app → escalating nudges, then give space ──
        // User is ONLINE — Nova must keep the conversation going!
        // Escalation: nudge 1 (warm), nudge 2 (different angle), nudge 3 → give space
        if (activelyInApp) {
          const { data: escData } = await supabaseAdmin.from('working_memory').select('value').eq('user_id', userId).eq('key', 'ignore_escalation_count').maybeSingle();
          const escalation = parseInt(escData?.value || '0', 10) + 1;
          await supabaseAdmin.from('working_memory').upsert({ user_id: userId, key: 'ignore_escalation_count', value: String(escalation), expires_at: new Date(Date.now() + 2 * 3600e3).toISOString() }, { onConflict: 'user_id,key' });

          // Hard cap: after 3 online nudges with no reply, give space (don't harass)
          if (escalation > 3) {
            await supabaseAdmin.from('working_memory').delete().eq('user_id', userId).eq('key', 'ignore_escalation_count');
            await this._writeSuppression(userId, 1); // 1h cooldown, not 24h
            logger.info('[NovaFollowup] Online escalation cap — brief cooldown', { userId, escalation });
            continue;
          }

          const escalationPrompts: Record<number, string> = {
            1: `You sent: "${novaMsg.content.substring(0, 120)}" — ${Math.round(ageMinutes)} min ago. User is ONLINE RIGHT NOW and hasn't replied. Send ONE short, warm nudge. Vary the angle — don't just say "busy ho?". E.g., try teasing them, sharing a thought, or asking one specific thing.`,
            2: `Your first nudge was ignored. User is STILL online. Try a completely DIFFERENT approach — a joke, a new topic, or something curious. Do NOT repeat any phrase from your previous message.`,
            3: `User is still not replying despite being online. Send ONE very low-pressure closing note. E.g., "Chal theek hai, jab free ho bata dena.".`
          };
          const escalationFallbacks: Record<number, string> = {
            1: 'Arey, busy hai kya? Jab time mile tab batana!',
            2: 'Btw, kuch interesting chal raha tha... baat karte hain?',
            3: 'Chal theek hai yaar, jab free ho toh ping kar dena.'
          };

          const prompt = escalationPrompts[escalation] || escalationPrompts[3];
          const fallback = escalationFallbacks[escalation] || escalationFallbacks[3];

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

          logger.info('[NovaFollowup] Online (left on read) — queuing nudge', { userId, ageMinutes: Math.round(ageMinutes), escalation });
          try {
            await this.queueFollowup(userId, novaMsg.conversation_id, msg, 0, { isOnlineNudge: true });
            await proactiveGate.commit(ignoredOutreachId, msg);
          } catch {
            await proactiveGate.release(ignoredOutreachId);
          }
          continue;
        }

        // ── UNSEEN: user is offline → exponential backoff check-ins ──
        // Backoff schedule: 1min → 2min → 4min → 8min → 16min → (cap 3.5h) → 24h give space
        const { data: countRow } = await supabaseAdmin
          .from('working_memory')
          .select('value')
          .eq('user_id', userId)
          .eq('key', UNSEEN_COUNTER_KEY)
          .maybeSingle();
        const unseenCount = parseInt(countRow?.value || '0', 10) || 0;

        if (unseenCount >= UNSEEN_MAX_CHECK_INS) {
          await this._writeSuppression(userId, 24);
          logger.info('[NovaFollowup] Offline backoff cap reached — giving 24h space', { userId, count: unseenCount });
          continue;
        }

        // Compute exponential backoff delay
        const backoffHours = offlineBackoffHours(unseenCount);
        const backoffMinutes = Math.round(backoffHours * 60);

        let deferredMsg = 'Arre, kaisa chal raha? Bas check kar raha tha — kabhi free ho toh bata dena.';
        try {
          const { novaBrain } = await import('./NovaBrainService');
          const gen = await novaBrain.evaluateConsciousnessTier2(
            `Name: yaar\nSituation: You sent "${novaMsg.content.substring(0, 100)}" ${Math.round(ageMinutes)} min ago. User is offline and hasn't replied (attempt ${unseenCount + 1}). Send ONE short, very low-pressure check-in. Vary your angle completely from previous nudges — different energy each time.`
          );
          if (gen?.message && gen.message.length < 150 && !gen.message.includes('Bol na')) deferredMsg = gen.message;
        } catch (e) {
          logger.warn('[NovaFollowup] Offline check-in gen failed, using fallback');
        }

        try {
          await this.queueFollowup(userId, novaMsg.conversation_id, deferredMsg, backoffHours, { cancelExisting: false });
          await proactiveGate.commit(ignoredOutreachId, deferredMsg);
        } catch {
          await proactiveGate.release(ignoredOutreachId);
        }

        await supabaseAdmin.from('working_memory').upsert({
          user_id: userId,
          key: UNSEEN_COUNTER_KEY,
          value: String(unseenCount + 1),
          expires_at: new Date(Date.now() + 48 * 3600e3).toISOString()
        }, { onConflict: 'user_id,key' });

        logger.info('[NovaFollowup] Offline exponential backoff check-in booked', {
          userId, ageMinutes: Math.round(ageMinutes), backoffMinutes, attempt: unseenCount + 1
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

export function _clearFollowupCachesForTest() {
  // Caches removed for P0 remediation
}
