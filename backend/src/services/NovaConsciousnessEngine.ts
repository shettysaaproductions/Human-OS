/**
 * NovaConsciousnessEngine — The Brain (Two-Tier Architecture)
 *
 * Runs every 15 minutes. Decides if Nova should autonomously reach out.
 * Tier 1: Small LLM (cost-efficient) evaluates context to decide 'shouldReach'.
 * Tier 2: Full LLM generates the deep, emotional, context-aware message.
 */

import { supabaseAdmin } from '../lib/supabase';
import { logger } from '../lib/logger';
import { novaBrain } from './NovaBrainService';
import { temporalAwarenessService } from './TemporalAwarenessService';
const MIN_GAP_MINUTES = 3; // Reduced from 10 — more frequent for active friend experience
const SERVER_BOOT_COOLDOWN_MS = 30 * 1000; // 30s cooldown after boot (was 5 min — caused 5-8min dead zones on Render restarts)
let serverBootTime = Date.now();
// Re-entrancy guard: a pulse that takes longer than the 15-min scheduler interval would
// otherwise run concurrently and double-outreach (and double-increment agenda retries).
let _pulseInProgress = false;

// Human-like response timing (in seconds)

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
      return context.agendaUrgency === 'high' ? 15 : 120; // was 30/240
    }

    // Work hours (morning/afternoon) — moderate gap
    if (['morning', 'afternoon'].includes(context.timeOfDayLabel)) {
      return context.hasAgenda ? 8 : 12; // was 15/25
    }

    // Evening/night — user is likely free, shorter gap
    if (['evening', 'late_night'].includes(context.timeOfDayLabel)) {
      if (context.hasAgenda && context.agendaUrgency === 'high') return 3;
      if (context.hasAgenda) return 5;
      return 8; // was 8/12/15
    }

    // Default
    return 5; // was 12
  }

  async pulse(): Promise<void> {
    if (_pulseInProgress) {
      logger.warn('[NACE] Pulse skipped — previous pulse still running (re-entrancy guard)');
      return;
    }
    _pulseInProgress = true;
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
    } finally {
      _pulseInProgress = false;
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

    // Sleep/busy lock respect: if the user said "good night" / is suppressed, stay
    // silent — UNLESS a high-urgency agenda item (e.g. medical/exam reminder Nova
    // was asked to track) is due right now and can break through.
    const { data: suppression } = await supabaseAdmin
      .from('working_memory')
      .select('value')
      .eq('user_id', userId)
      .eq('key', 'followup_suppressed_until')
      .maybeSingle();
    if (suppression?.value && Date.now() < new Date(suppression.value).getTime()) {
      const { data: urgentAgenda } = await supabaseAdmin
        .from('nova_agenda')
        .select('id')
        .eq('user_id', userId)
        .in('status', ['pending', 'active'])
        .eq('urgency', 'high')
        .lte('next_retry_at', new Date().toISOString())
        .limit(1);
      if (!urgentAgenda || urgentAgenda.length === 0) {
        logger.info('[NACE] Skipping outreach — user is suppressed (sleep/busy lock)', { userId });
        return;
      }
    }

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
    
    // Fetch user presence to calculate dynamic gap
    const { data: presenceData } = await supabaseAdmin
      .from('user_presence')
      .select('status, updated_at')
      .eq('user_id', userId)
      .maybeSingle();
      
    let userPresence = presenceData?.status || 'offline';
    
    // Presence Decay: If marked online but hasn't updated in 10 mins, downgrade to away
    if (userPresence === 'online' && presenceData?.updated_at) {
      const presenceAgeMinutes = (Date.now() - new Date(presenceData.updated_at).getTime()) / 60000;
      if (presenceAgeMinutes > 10) {
        userPresence = 'away';
      }
    }

    // ── ACTIVE USER GUARD ────────────────────────────────────────────────────
    // If the user sent a message in the last 10 minutes, they are clearly active.
    // Don't interrupt an active conversation with NACE proactive messages.
    if (gapMinutes < 10 && userPresence !== 'offline') {
      logger.info('[NACE] Skipping — user is actively engaged (gap < 10 min)', { userId, gapMinutes: Math.round(gapMinutes) });
      return;
    }

    const getEffectiveMinGap = (presence: string): number => {
      switch (presence) {
        case 'typing': return 0;
        case 'online': return 1;      // 1 min for active online users
        case 'away': return 4;        // 4 min if user stepped away
        case 'offline': return 15;    // 15 min if offline
        default: return 2;
      }
    };

    const effectiveMinGap = getEffectiveMinGap(userPresence);
    if (gapMinutes < effectiveMinGap) return;

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

    // --- GATHER FULL CONTEXT (All Engines) ---
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
    // Fetch 10 recent messages (up from 3) for better variety context
    const { data: recentOutreaches } = await supabaseAdmin
      .from('nova_outreach_log')
      .select('message, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(10);
    const recentOutreachSnippet = (recentOutreaches || []).map(o => `- "${o.message}"`).join('\n');

    // ── EXACT-MATCH DEDUP: Never send the same proactive message twice ──────
    // This prevents the bug where "Arey, busy hai kya?" was sent at 12:01 AM and again at 2:10 AM
    // Check last 5 outreach messages for exact or near-exact match against what Tier 2 might generate
    // (We store outreach messages; the check happens AFTER Tier 2 generates, see below)

    // --- TIER 1: The Subconscious Decision (Fast, Cheap) ---
    let abandonmentNote = '';
    let spontaneousThoughtNote = '';

    if (userPresence === 'online' && gapMinutes >= 2 && gapMinutes <= 10) {
      abandonmentNote = "CRITICAL NUDGE: User is actively looking at the chat but hasn't sent anything for a few minutes. They might have stopped typing or are hesitating. Nudge them gently (e.g. 'kuch type kar raha tha?', 'you were saying...?', 'sab theek?'). ";
    } else if (gapMinutes > 180 && !agendaItem && !tContext.isSleepWindow) {
      spontaneousThoughtNote = "SPONTANEOUS SUCCESS PULSE: It's been quiet for a few hours and you have no active agenda. Do NOT ask 'how are you'. Instead, share a spontaneous thought aligned with the user's SUCCESS or GROWTH. E.g., share a quick productivity hack, a profound quote relevant to their struggles, or a sudden insight about a project they mentioned. Be a success-driven companion.";
    }

    const tier1Context = `Time: ${tContext.timeOfDayLabel} (${tContext.hour}:00), Day: ${tContext.dayOfWeek}
Is Sleep Window: ${tContext.isSleepWindow}
User Presence: ${userPresence} (${userPresence === 'online' ? 'actively using app' : userPresence === 'away' ? 'was active recently' : 'not on app'})
Gap Since User Last Messaged: ${Math.round(gapMinutes)} minutes
Min Gap Allowed Right Now: ${effectiveMinGap} minutes (based on presence)
Dynamic Situational Gap: ${dynamicGap} minutes
Pending Agenda Item: ${agendaItem ? agendaItem.event_description + ' [urgency: ' + agendaItem.urgency + ']' : 'None'}
Recent Memories: ${memorySummary || 'None'}
Last Conversation Snippet: ${lastConvSnippet || 'None'}
${abandonmentNote}
${spontaneousThoughtNote}

DECISION RULES (use actual gap values above, not hardcoded numbers):
- User is ONLINE: reach out if gap >= 1 min. Being active means they'll see your message immediately.
- User is AWAY: reach out if gap >= 4 min. They stepped away but will see it soon.
- User is OFFLINE: reach out if gap >= 15 min. They're not active right now.
- High urgency agenda item: ALWAYS reach out during non-sleep hours.
- Morning/afternoon work hours without agenda: only reach if gap > 20 min.
- Evening/night with no agenda: reach out freely if gap >= dynamic gap.
- Sleep window: only high-urgency agenda. Otherwise NO.
- NEVER refuse because of a fixed 45-minute rule — use the presence-based gap above.`;

    let shouldReach = false;
    let triggerType = 'engagement';

    try {
      const decision = await novaBrain.evaluateConsciousnessTier1(tier1Context);
      shouldReach = decision.shouldReach;
      triggerType = decision.triggerType || 'engagement';
    } catch (e) {
      logger.warn('[NACE] Tier 1 failed, using agenda-only fallback');
      // Tighter fallback: only fire if there's a real agenda item (not random)
      if (agendaItem && !tContext.isSleepWindow) shouldReach = true;
      // If user is online with a long gap, nudge even without agenda
      else if (userPresence === 'online' && gapMinutes > 5 && !tContext.isSleepWindow) shouldReach = true;
    }

    if (!shouldReach) return;

    // --- TIER 2: Generation (Full Model) ---

    const tier2Context = `Name: ${profile.preferred_name || 'yaar'}
Time/Day: ${tContext.dayOfWeek}, ${tContext.timeOfDayLabel} (${tContext.hour}:00)
Silence Duration: ${Math.round(gapMinutes / 60)} hours
Trigger: ${triggerType}
Agenda Context: ${agendaItem ? agendaItem.follow_up_question : 'N/A'}
Recent Memories: ${memorySummary}

RECENT OUTREACH MESSAGES (Do NOT repeat or closely rephrase these):
${recentOutreachSnippet || 'None.'}

LAST CONVERSATION (what was actually said — reference this naturally):
${lastConvSnippet || 'No recent conversation.'}
${abandonmentNote}
${spontaneousThoughtNote}`;

    try {
      // Generate the Tier 2 message directly — NACE is already on a scheduled timer, no extra delay needed
      const generated = await novaBrain.evaluateConsciousnessTier2(tier2Context);
      
      if (!generated.message) {
        logger.warn('[NACE] Tier 2 returned empty message', { userId });
        return;
      }

      // ── EXACT-MATCH DEDUP CHECK ──────────────────────────────────────────────
      // Prevent sending the same message twice (e.g. "Arey, busy hai kya?" repeated).
      // Normalize both strings: lowercase, strip punctuation, collapse whitespace.
      const normalize = (s: string) => s.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
      const normalizedNew = normalize(generated.message);
      const recentOutreachMessages = (recentOutreaches || []).map(o => normalize(o.message));
      
      const isDuplicateOutreach = recentOutreachMessages.some(prev => {
        if (prev === normalizedNew) return true;
        // Near-duplicate: if word overlap is > 75%, treat as duplicate
        const prevWords = new Set(prev.split(' ').filter(Boolean));
        const newWords = new Set(normalizedNew.split(' ').filter(Boolean));
        if (prevWords.size === 0 || newWords.size === 0) return false;
        let overlap = 0;
        for (const w of newWords) if (prevWords.has(w)) overlap++;
        const union = new Set([...prevWords, ...newWords]).size;
        return union > 0 && overlap / union >= 0.75;
      });
      
      if (isDuplicateOutreach) {
        logger.warn('[NACE] 🚫 Duplicate outreach detected — skipping to avoid repeating the same message', { userId, message: generated.message.substring(0, 60) });
        return;
      }

      if (agendaItem) {
        const newRetryCount = (agendaItem.retry_count || 0) + 1;
        if (newRetryCount >= (agendaItem.max_retries || 3)) {
          await supabaseAdmin.from('nova_agenda').update({ status: 'expired', updated_at: new Date().toISOString() }).eq('id', agendaItem.id);
        } else {
          let delayHours = 24;
          if (agendaItem.urgency === 'high') delayHours = 4;
          else if (agendaItem.urgency === 'medium') delayHours = 8;
          const nextRetry = new Date(Date.now() + delayHours * 60 * 60 * 1000).toISOString();
          await supabaseAdmin.from('nova_agenda').update({ retry_count: newRetryCount, next_retry_at: nextRetry, updated_at: new Date().toISOString() }).eq('id', agendaItem.id);
        }
      }

      const message = generated.message;

      // Save to chat_history so Nova remembers saying this
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

      // Log to outreach log so MIN_GAP check works correctly.
      // NOTE: schema columns are outreach_type + created_at (NOT type/sent_at — the old
      // insert failed every time, so the anti-spam ledger never filled and MIN_GAP could not
      // throttle outreach).
      await supabaseAdmin.from('nova_outreach_log').insert({
        user_id: userId,
        message,
        outreach_type: agendaItem ? 'agenda_followup' : 'engagement_checkin',
      });

      // Send push notification
      if (profile.push_token) {
        const { sendNovaReplyNotification } = await import('../lib/pushNotifications');
        await sendNovaReplyNotification(profile.push_token, message, conversationId).catch(err =>
          logger.warn('[NACE] Push notification failed', { error: err?.message })
        );
      }

      logger.info('[NACE] Proactive message sent successfully', { userId, messagePreview: message.substring(0, 60) });
    } catch (e) {
      logger.warn('[NACE] Tier 2 generation or send failed', { error: e instanceof Error ? e.message : String(e) });
    }
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
        const { data: profile } = await supabaseAdmin.from('profiles').select('timezone_offset').eq('id', userId).maybeSingle();
        const tzOffset = profile?.timezone_offset || 0;

        const scheduleDescription = entries.map(e => `${e.key}: ${e.value}`).join(', ');
        
        let targetIso = null;
        try {
          const { novaBrain } = await import('./NovaBrainService');
          targetIso = await novaBrain.extractTimeFromRoutine(scheduleDescription, tzOffset);
        } catch (e) {
          logger.warn('[NACE] Failed to extract time from routine via LLM', { error: e instanceof Error ? e.message : String(e) });
        }

        // Default to 30 mins if LLM fails or no specific time found
        let followUpTime = new Date(Date.now() + 30 * 60 * 1000); 
        if (targetIso) {
          const parsedTarget = new Date(targetIso);
          if (parsedTarget.getTime() > Date.now()) {
            followUpTime = parsedTarget;
          }
        }

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

        logger.info('[NACE] Created habit-based trigger for user', { userId, schedule: scheduleDescription.substring(0, 100), followUpTime: followUpTime.toISOString() });
      }
    } catch (err) {
      logger.warn('[NACE] Habit trigger sync failed (non-critical)', {
        error: err instanceof Error ? err.message : String(err)
      });
    }
  }
}

export const novaConsciousnessEngine = new NovaConsciousnessEngine();
