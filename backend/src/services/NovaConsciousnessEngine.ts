/**
 * NovaConsciousnessEngine — The Brain (Two-Tier Architecture)
 *
 * Runs every 15 minutes. Decides if Nova should autonomously reach out.
 * Tier 1: Small LLM (cost-efficient) evaluates context to decide 'shouldReach'.
 * Tier 2: Full LLM generates the deep, emotional, context-aware message.
 */

import { supabaseAdmin } from '../lib/supabase';
import { novaBrain } from './NovaBrainService';
import { logger } from '../lib/logger';
import { sendPushNotification } from '../lib/pushNotifications';
import { temporalAwarenessService } from './TemporalAwarenessService';
import crypto from 'crypto';

const MIN_GAP_MINUTES = 45; // Absolute minimum between consecutive outreach (safety floor)
const SERVER_BOOT_COOLDOWN_MS = 5 * 60 * 1000; // Don't reach out within 5 min of server boot
let serverBootTime = Date.now();

// Human-like response timing (in seconds)
const HUMAN_TIMING = {
  quick: { min: 15, max: 30 },       // 15-30s (user just replied)
  normal: { min: 45, max: 90 },      // 45-90s (natural pause)
  thoughtful: { min: 120, max: 180 } // 2-3min (deep thought)
};

function randomBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function getNextMessageDelay(userLastReplyMs: number): number {
  const secondsSinceReply = (Date.now() - userLastReplyMs) / 1000;
  
  if (secondsSinceReply < 60) {
    return randomBetween(HUMAN_TIMING.quick.min, HUMAN_TIMING.quick.max) * 1000;
  } else if (secondsSinceReply < 300) {
    return randomBetween(HUMAN_TIMING.normal.min, HUMAN_TIMING.normal.max) * 1000;
  } else {
    return randomBetween(HUMAN_TIMING.thoughtful.min, HUMAN_TIMING.thoughtful.max) * 1000;
  }
}

// NVIDIA rate limit safety
const RATE_LIMIT = {
  maxRequestsPerMinute: 30,
  windowMs: 60000,
  requests: [] as number[]
};

function canSendMessage(): boolean {
  const now = Date.now();
  RATE_LIMIT.requests = RATE_LIMIT.requests.filter(t => now - t < RATE_LIMIT.windowMs);
  return RATE_LIMIT.requests.length < RATE_LIMIT.maxRequestsPerMinute;
}

function recordMessageSent(): void {
  RATE_LIMIT.requests.push(Date.now());
}

export class NovaConsciousnessEngine {

  /**
   * Calculate dynamic gap based on situation instead of a fixed timer.
   * User free → 15 min gap, User busy → 60 min, Important task pending → 30 min.
   */
  private _calculateDynamicGap(context: {
    isSleepWindow: boolean;
    gapMinutes: number;
    hasAgenda: boolean;
    agendaUrgency?: string;
    timeOfDayLabel: string;
  }): number {
    // Sleep window — very long gap unless high urgency
    if (context.isSleepWindow) {
      return context.agendaUrgency === 'high' ? 60 : 480; // 1 hr or 8 hrs
    }

    // Work hours (morning/afternoon) — longer gap, don't disturb
    if (['morning', 'afternoon'].includes(context.timeOfDayLabel)) {
      return context.hasAgenda ? 45 : 90; // 45 min if task pending, else 90 min
    }

    // Evening/night — user is likely free, shorter gap
    if (['evening', 'late_night'].includes(context.timeOfDayLabel)) {
      if (context.hasAgenda && context.agendaUrgency === 'high') return 20;
      if (context.hasAgenda) return 30;
      return 45; // Casual check-in
    }

    // Default
    return 30;
  }

  async pulse(): Promise<void> {
    try {
      // Find active users (last 7 days)
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const { data: activeUsers } = await supabaseAdmin
        .from('chat_history')
        .select('user_id')
        .eq('role', 'user')
        .gte('created_at', sevenDaysAgo);

      if (!activeUsers) return;
      const uniqueUserIds = [...new Set(activeUsers.map(u => u.user_id))];

      logger.info(`[NACE] Pulse started for ${uniqueUserIds.length} users`);

      for (const userId of uniqueUserIds) {
        try {
          await this._processUser(userId);
        } catch (userErr) {
          logger.warn('[NACE] Error processing user', { userId, error: userErr instanceof Error ? userErr.message : String(userErr) });
        }
      }
      logger.info('[NACE] Pulse completed');
    } catch (err) {
      logger.error('[NACE] Pulse failed', { error: err instanceof Error ? err.message : String(err) });
    }
  }

  private async _processUser(userId: string): Promise<void> {
    // Coma awareness: Don't reach out right after server boot to avoid spam
    if (Date.now() - serverBootTime < SERVER_BOOT_COOLDOWN_MS) {
      logger.info('[NACE] Skipping outreach — server just booted (coma cooldown)');
      return;
    }

    // 1. Fetch Profile & Temporal Context
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('push_token, preferred_name, timezone_offset')
      .eq('id', userId)
      .maybeSingle();

    if (!profile?.push_token) return;

    const tContext = await temporalAwarenessService.getContext(userId, profile.timezone_offset);

    // 2. Fetch Recent Outreach to enforce MIN_GAP
    const { data: recentOutreach } = await supabaseAdmin
      .from('nova_outreach_log')
      .select('created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (recentOutreach) {
      const minutesSinceLast = (Date.now() - new Date(recentOutreach.created_at).getTime()) / 60000;
      if (minutesSinceLast < MIN_GAP_MINUTES) {
        return; // Absolute floor — never outreach faster than 15 min
      }
    }

    // 2.5 Fetch Recent Assistant Chat (don't reach out if Nova just spoke)
    const { data: recentAssistantChat } = await supabaseAdmin
      .from('chat_history')
      .select('created_at')
      .eq('user_id', userId)
      .eq('role', 'assistant')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (recentAssistantChat) {
      const minutesSinceLastReply = (Date.now() - new Date(recentAssistantChat.created_at).getTime()) / 60000;
      if (minutesSinceLastReply < MIN_GAP_MINUTES) {
        return; // Nova just spoke — absolute floor
      }
    }

    // 3. Last user message gap
    const { data: lastUserMsg } = await supabaseAdmin
      .from('chat_history')
      .select('created_at, content')
      .eq('user_id', userId)
      .eq('role', 'user')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const gapMinutes = lastUserMsg ? (Date.now() - new Date(lastUserMsg.created_at).getTime()) / 60000 : 0;
    // If user was active within MIN_GAP_MINUTES — don't interrupt. Skip entirely (save LLM cost).
    if (gapMinutes < MIN_GAP_MINUTES) return;

    // 4. Pending Agenda
    const { data: pendingAgenda } = await supabaseAdmin
      .from('nova_agenda')
      .select('*')
      .eq('user_id', userId)
      .in('status', ['pending', 'active'])
      .lte('next_retry_at', new Date().toISOString())
      .order('next_retry_at', { ascending: true })
      .limit(1);

    const agendaItem = (pendingAgenda && pendingAgenda.length > 0) ? pendingAgenda[0] : null;

    // Calculate dynamic gap based on situation
    const dynamicGap = this._calculateDynamicGap({
      isSleepWindow: tContext.isSleepWindow,
      gapMinutes,
      hasAgenda: !!agendaItem,
      agendaUrgency: agendaItem?.urgency,
      timeOfDayLabel: tContext.timeOfDayLabel
    });

    // Enforce dynamic gap against last outreach
    if (recentOutreach) {
      const minutesSinceLast = (Date.now() - new Date(recentOutreach.created_at).getTime()) / 60000;
      if (minutesSinceLast < Math.max(dynamicGap, MIN_GAP_MINUTES)) {
        return; // Too soon based on situational gap
      }
    }

    // Do not disturb during sleep, unless it's a high urgency agenda
    if (tContext.isSleepWindow) {
      if (!agendaItem || agendaItem.urgency !== 'high') {
        return;
      }
    }

    // --- TIER 1: The Subconscious Decision (Fast, Cheap) ---
    // Now includes richer context for intelligent gap decisions
    const tier1Context = `Time: ${tContext.timeOfDayLabel} (${tContext.hour}:00), Day: ${tContext.dayOfWeek}
Is Sleep Window: ${tContext.isSleepWindow}
User Gap: ${Math.round(gapMinutes / 60)} hours (${Math.round(gapMinutes)} minutes)
Dynamic Gap Applied: ${dynamicGap} minutes
Pending Agenda: ${agendaItem ? agendaItem.event_description : 'None'}
Agenda Urgency: ${agendaItem?.urgency || 'none'}

DECISION RULES:
- If user has been free for ${dynamicGap}+ minutes AND there's something meaningful to say, reach out.
- If user has a pending high-urgency task/goal, ALWAYS reach out during non-sleep hours.
- If user is likely busy (work hours), only reach out for important agenda items.
- If user seems free (evening, weekend), casual check-ins are OK.
- NEVER reach out if the gap is less than ${MIN_GAP_MINUTES} minutes.`;

    let shouldReach = false;
    let triggerType = 'engagement';

    try {
      const decision = await novaBrain.evaluateConsciousnessTier1(tier1Context);
      shouldReach = decision.shouldReach;
      triggerType = decision.triggerType || 'engagement';
    } catch (e) {
      logger.warn('[NACE] Tier 1 failed, defaulting to logic-based fallback');
      // Fallback logic
      if (agendaItem && !tContext.isSleepWindow) shouldReach = true;
      else if (gapMinutes > 120 && !tContext.isSleepWindow && Math.random() > 0.5) shouldReach = true;
    }

    if (!shouldReach) return;

    // --- TIER 2: Generation (Full Model) ---
    const { data: recentMemories } = await supabaseAdmin
      .from('memories')
      .select('key, value, memory_type')
      .eq('user_id', userId)
      .eq('is_archived', false)
      .order('updated_at', { ascending: false })
      .limit(5);

    const memorySummary = (recentMemories || []).map(m => `[${m.memory_type}] ${m.key}: ${m.value}`).join('\n');
    
    // Fetch last 6 chat messages for TIER2 context (so outreach is grounded in real conversation)
    const { data: lastConversation } = await supabaseAdmin
      .from('chat_history')
      .select('role, content')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(6);
    const lastConvSnippet = (lastConversation || []).reverse()
      .map((m: any) => `${m.role === 'user' ? 'User' : 'Nova'}: ${m.content.substring(0, 150)}`)
      .join('\n');

    // Fetch recent outreach to pass to Tier 2 (to prevent repetitive messages)
    const { data: recentOutreaches } = await supabaseAdmin
      .from('nova_outreach_log')
      .select('message')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(3);
    const recentOutreachSnippet = (recentOutreaches || []).map(o => `- "${o.message}"`).join('\n');

    const tier2Context = `Name: ${profile.preferred_name || 'yaar'}
Time/Day: ${tContext.dayOfWeek}, ${tContext.timeOfDayLabel} (${tContext.hour}:00)
Silence Duration: ${Math.round(gapMinutes / 60)} hours
Trigger: ${triggerType}
Agenda Context: ${agendaItem ? agendaItem.follow_up_question : 'N/A'}
Recent Memories: ${memorySummary}

RECENT OUTREACH MESSAGES (Do NOT repeat or closely rephrase these):
${recentOutreachSnippet || 'None.'}

LAST CONVERSATION (what was actually said — reference this naturally):
${lastConvSnippet || 'No recent conversation.'}`;

    try {
      const generated = await novaBrain.evaluateConsciousnessTier2(tier2Context);

      if (generated.message) {
        await this._sendOutreach(userId, profile, generated.message, triggerType, generated.tone, gapMinutes);
        if (agendaItem) {
          const newRetryCount = (agendaItem.retry_count || 0) + 1;
          if (newRetryCount >= (agendaItem.max_retries || 3)) {
            await supabaseAdmin.from('nova_agenda').update({ status: 'expired', updated_at: new Date().toISOString() }).eq('id', agendaItem.id);
          } else {
            // Calculate next retry time based on urgency
            let delayHours = 24; // Default to next day
            if (agendaItem.urgency === 'high') delayHours = 4;
            else if (agendaItem.urgency === 'medium') delayHours = 12;
            
            // Backoff logic: double the delay on each retry
            delayHours = delayHours * Math.pow(2, newRetryCount - 1);
            
            const nextRetryAt = new Date(Date.now() + delayHours * 60 * 60 * 1000).toISOString();
            await supabaseAdmin.from('nova_agenda').update({ 
              status: 'active', 
              retry_count: newRetryCount,
              next_retry_at: nextRetryAt,
              updated_at: new Date().toISOString() 
            }).eq('id', agendaItem.id);
          }
        }
      }
    } catch (e) {
      logger.warn('[NACE] Tier 2 generation failed', { error: e instanceof Error ? e.message : String(e) });
    }
  }

  private async _sendOutreach(userId: string, profile: any, message: string, type: string, tone: string, gapMinutes: number) {
    if (!canSendMessage()) {
      logger.warn('[NACE] Rate limit reached. Aborting outreach.');
      return;
    }
    recordMessageSent();

    // Human-like timing delay
    const userLastReplyMs = Date.now() - (gapMinutes * 60 * 1000);
    const delayMs = getNextMessageDelay(userLastReplyMs);
    logger.info(`[NACE] Applying human-like delay of ${delayMs}ms before sending`);
    await new Promise(r => setTimeout(r, delayMs));

    const { data: latestChat } = await supabaseAdmin
      .from('chat_history')
      .select('conversation_id')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const conversationId = latestChat?.conversation_id || crypto.randomUUID();

    await supabaseAdmin.from('chat_history').insert({
      user_id: userId,
      conversation_id: conversationId,
      role: 'assistant',
      content: message,
    });

    if (profile.push_token) {
      await sendPushNotification([{
        to: profile.push_token,
        title: 'Nova',
        body: message.length > 100 ? message.substring(0, 97) + '...' : message,
        sound: 'default',
        channelId: 'nova_messages',
        priority: 'high',
        ttl: 3600,
        data: { type: 'nova_consciousness', conversationId },
      }]);
    }

    await supabaseAdmin.from('nova_outreach_log').insert({
      user_id: userId,
      outreach_type: type,
      message,
      reason: tone,
    });
  }

  async expireOldAgendaItems(): Promise<void> {
    // Delete pending/active items older than 7 days since their follow up after
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    await supabaseAdmin
      .from('nova_agenda')
      .update({ status: 'expired', updated_at: new Date().toISOString() })
      .in('status', ['pending', 'active'])
      .lt('follow_up_after', cutoff);
  }
  /**
   * Creates habit-based agenda items from working_memory schedule data.
   * For example, if user's logout time is 8:30 PM, create an outreach trigger at 8:35 PM.
   * Called once per pulse cycle.
   */
  async syncHabitTriggers(): Promise<void> {
    try {
      // Find all users with schedule-related working memory
      const scheduleKeys = ['logout', 'login', 'work', 'gym', 'sleep', 'routine', 'schedule', 'office'];
      const { data: scheduleMemories } = await supabaseAdmin
        .from('working_memory')
        .select('user_id, key, value, expires_at')
        .gt('expires_at', new Date().toISOString());

      if (!scheduleMemories || scheduleMemories.length === 0) return;

      // Filter for schedule-relevant entries
      const relevantEntries = scheduleMemories.filter(wm =>
        scheduleKeys.some(k => wm.key.toLowerCase().includes(k) || wm.value.toLowerCase().includes(k))
      );

      if (relevantEntries.length === 0) return;

      // Group by user
      const userSchedules = new Map<string, typeof relevantEntries>();
      for (const entry of relevantEntries) {
        const existing = userSchedules.get(entry.user_id) || [];
        existing.push(entry);
        userSchedules.set(entry.user_id, existing);
      }

      for (const [userId, entries] of userSchedules) {
        // Check if we already have a habit-based agenda item for today
        const today = new Date().toISOString().split('T')[0];
        const { data: existingAgenda } = await supabaseAdmin
          .from('nova_agenda')
          .select('id')
          .eq('user_id', userId)
          .eq('source_message', 'habit_trigger')
          .gte('created_at', today + 'T00:00:00Z')
          .limit(1);

        if (existingAgenda && existingAgenda.length > 0) continue; // Already have today's triggers

        // Create a habit-based agenda item
        const scheduleDescription = entries.map(e => `${e.key}: ${e.value}`).join(', ');
        const followUpTime = new Date(Date.now() + 30 * 60 * 1000); // 30 mins from now as default

        await supabaseAdmin.from('nova_agenda').insert({
          user_id: userId,
          event_description: `Daily habit check-in based on schedule: ${scheduleDescription.substring(0, 300)}`,
          follow_up_question: 'Check in based on their known daily routine and schedule',
          follow_up_after: followUpTime.toISOString(),
          source_message: 'habit_trigger',
          status: 'pending',
          next_retry_at: followUpTime.toISOString(),
          urgency: 'low',
          is_recurring: true,
        });

        logger.info('[NACE] Created habit-based trigger for user', { userId, schedule: scheduleDescription.substring(0, 100) });
      }
    } catch (err) {
      logger.warn('[NACE] Habit trigger sync failed (non-critical)', {
        error: err instanceof Error ? err.message : String(err)
      });
    }
  }
}

export const novaConsciousnessEngine = new NovaConsciousnessEngine();
