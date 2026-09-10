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
import { outboundDispatcherService } from './OutboundDispatcherService';
import type { OutboundSource } from '../types/outbound';
import { resolveUserTzOffsetHours } from './ReminderEngine';
import { userLifeStageEngine } from './UserLifeStageEngine';

// Minimum gap between outreach attempts - set to 1 for online "back-to-back" messaging
// The effective minimum is dynamically calculated based on presence in getEffectiveMinGap()
const MIN_GAP_MINUTES = 1;
const SERVER_BOOT_COOLDOWN_MS = 10 * 1000; // 10s cooldown after boot
let serverBootTime = Date.now();
// Re-entrancy guard: a pulse that takes longer than the 15-min scheduler interval would
// otherwise run concurrently and double-outreach (and double-increment agenda retries).
let _pulseInProgress = false;
let _pulseStartTime = 0;

/**
 * Identifies natural, unasked questions based on known facts and missing dimensions.
 * Crucially checks Entity Wardrobes FIRST so Nova never asks about facts that are
 * already established (e.g. Sakshi's cooking talent or baby Shreshth's age).
 */
export function deriveMissingMemoryCuriosities(
  memories: Array<{ key: string; value: string; memory_type?: string }>,
  workingContext?: Record<string, string>
): string[] {
  const memMap = new Map<string, string>();
  for (const m of memories) {
    if (m.key && m.value) {
      memMap.set(m.key.toLowerCase().trim(), m.value.trim());
    }
  }

  // Check Entity Wardrobes first to prevent asking already-known facts
  const { clusterMemoriesIntoWardrobes } = require('../lib/memoryDomains');
  const clusterResult: any = clusterMemoriesIntoWardrobes(memories, workingContext || {});
  const wardrobes: any[] = Array.isArray(clusterResult) ? clusterResult : (clusterResult?.wardrobes || []);

  const curiosities: string[] = [];

  // 1. Son / Infant check
  const sonW = wardrobes.find((w: any) => (w.domain === 'family' || w.entityType === 'person') && (w.name.toLowerCase().includes('shreshth') || (w.roleTitle && w.roleTitle.toLowerCase().includes('son'))));
  const sonTraits = sonW ? sonW.traits.map((t: any) => `${t.label} ${t.value}`).join(' ').toLowerCase() : '';
  const isSonAgeKnown = sonTraits.includes('month') || sonTraits.includes('mahine') || sonTraits.includes('age') || sonTraits.includes('saal') || memMap.has('son_age');

  if (sonW || memMap.has('son_name')) {
    const sonName = sonW?.name || memMap.get('son_name') || 'beta';
    if (!isSonAgeKnown) {
      curiosities.push(`Son: Name is "${sonName}", but his age is unknown. (e.g. ask warmly: "${sonName} kitne saal ya mahine ka hai?")`);
    } else if (sonTraits.includes('6') || sonTraits.includes('infant') || sonTraits.includes('baby')) {
      // Age is known as infant — do NOT ask about school or age!
    }
  }

  // 2. Wife check — NEVER ask "Sakshi kya karti hai" if skills/traits are known!
  const wifeW = wardrobes.find((w: any) => (w.domain === 'family' || w.entityType === 'person') && (w.name.toLowerCase().includes('sakshi') || (w.roleTitle && w.roleTitle.toLowerCase().includes('wife'))));
  const wifeTraits = wifeW ? wifeW.traits.map((t: any) => `${t.label} ${t.value}`).join(' ').toLowerCase() : '';
  const isWifeSkillsKnown = wifeTraits.includes('cook') || wifeTraits.includes('culinary') || wifeTraits.includes('nail') || wifeTraits.includes('art') || memMap.has('wife_profession') || memMap.has('wife_skills');

  if (wifeW || memMap.has('wife_name')) {
    const wifeName = wifeW?.name || memMap.get('wife_name') || 'wife';
    if (!isWifeSkillsKnown) {
      curiosities.push(`Wife: Name is "${wifeName}", but what she does or her interests are unknown. (e.g. ask casually: "Waise ${wifeName} kya karti hai?")`);
    } else if (wifeTraits.includes('cook')) {
      // High-IQ strategic synergy: If user has food venture (Shetty's Dhaba) and wife is a cook:
      const hasDhaba = wardrobes.some((w: any) => 
        w.name.toLowerCase().includes('dhaba') || 
        w.name.toLowerCase().includes('kitchen') || 
        (w.summary && (w.summary.toLowerCase().includes('dhaba') || w.summary.toLowerCase().includes('cloud kitchen')))
      ) || memories.some(m => /dhaba|kitchen/i.test(m.value) || /dhaba|kitchen/i.test(m.key));

      if (hasDhaba) {
        curiosities.push(`Venture Synergy: ${wifeName} is a passionate cook, and user is launching Shetty's Dhaba cloud kitchen. Explore how ${wifeName}'s signature recipes will anchor the cloud kitchen menu.`);
      }
    }
  }

  // 3. User Work / Profession
  const hasWorkWardrobe = wardrobes.some((w: any) => (w.domain === 'work' || w.entityType === 'business') && (w.name.toLowerCase().includes('conviction') || (w.roleTitle && w.roleTitle.toLowerCase().includes('founder'))));
  if (!hasWorkWardrobe && !memMap.has('profession') && !memMap.has('job') && !memMap.has('company_name') && !memMap.has('occupation')) {
    curiosities.push(`User Work: Job, profession, or current project is unknown. (e.g. "Waise aap kya kaam karte ho?")`);
  }

  // 4. User Location
  if (!memMap.has('city') && !memMap.has('hometown') && !memMap.has('location')) {
    curiosities.push(`User Location: Which city they live in is unknown.`);
  }

  return curiosities;
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
      return context.agendaUrgency === 'high' ? 10 : 120;
    }

    // Work hours (morning/afternoon) — moderate gap
    if (['morning', 'afternoon'].includes(context.timeOfDayLabel)) {
      return context.hasAgenda ? 5 : 15;
    }

    // Evening/night — user is likely free, shorter gap
    if (['evening', 'late_night'].includes(context.timeOfDayLabel)) {
      if (context.hasAgenda && context.agendaUrgency === 'high') return 2;
      if (context.hasAgenda) return 3;
      return 5; // ← was 8: reduced so evening free-time outreach fires
    }

    // Default
    return 5;
  }

  async pulse(): Promise<void> {
    if (_pulseInProgress) {
      // Break lock if stuck for more than 5 minutes
      if (Date.now() - _pulseStartTime > 5 * 60 * 1000) {
         logger.warn('[NACE] Breaking stuck pulse lock (older than 5 minutes)');
         _pulseInProgress = false;
      } else {
         logger.warn('[NACE] Pulse skipped — previous pulse still running (re-entrancy guard)');
         return;
      }
    }
    _pulseInProgress = true;
    _pulseStartTime = Date.now();
    const pulseStartMs = Date.now();
    // runId is a log correlation ID only — never used as durable outbound identity
    const pulseRunId = `nace:pulse:${pulseStartMs}`;

    logger.info('[NACE] Engine started', {
      engine: 'NACE',
      event: 'engine_started',
      runId: pulseRunId,
      startedAt: new Date(pulseStartMs).toISOString(),
    });

    let usersEvaluated = 0;
    // usersEligible: users that passed ALL NACE eligibility gates and proceeded to Tier 2 generation.
    // Distinct from usersEvaluated (all users checked) — a user can be evaluated but suppressed
    // by cooldown, sleep lock, gap check, no-grounded-reason gate, or Tier 1 LLM returning NO.
    let usersEligible = 0;
    let intentsDispatched = 0;
    let intentsSuppressed = 0;

    try {
      // Find active users (last 7 days)
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const { data: activeUsers } = await supabaseAdmin
        .from('chat_history')
        .select('user_id')
        .eq('role', 'user')
        .gte('created_at', sevenDaysAgo);

      if (!activeUsers) {
        logger.info('[NACE] Engine completed', {
          engine: 'NACE', event: 'engine_completed', runId: pulseRunId,
          usersEvaluated: 0, usersEligible: 0, intentsDispatched: 0,
          intentsSuppressed: 0, intentsFailed: 0, outcome: 'healthy_suppressed',
          durationMs: Date.now() - pulseStartMs,
        });
        return;
      }
      const uniqueUserIds = [...new Set(activeUsers.map(u => u.user_id))];
      usersEvaluated = uniqueUserIds.length;

      logger.info(`[NACE] Pulse started for ${uniqueUserIds.length} users`);

      for (const userId of uniqueUserIds) {
        try {
          const result = await this.processUserWithResult(userId);
          intentsDispatched += result.dispatched;
          intentsSuppressed += result.suppressed;
          if (result.dispatched > 0 || result.eligible > 0) usersEligible++;
        } catch (userErr) {
          logger.warn('[NACE] Error processing user', { userId, error: userErr instanceof Error ? userErr.message : String(userErr) });
        }
      }

      logger.info('[NACE] Engine completed', {
        engine: 'NACE',
        event: 'engine_completed',
        runId: pulseRunId,
        startedAt: new Date(pulseStartMs).toISOString(),
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - pulseStartMs,
        usersEvaluated,
        usersEligible, // Users that passed ALL eligibility gates (Tier1 YES or override)
        intentsDispatched,
        intentsSuppressed,
        intentsFailed: 0,
        outcome: intentsDispatched > 0 ? 'healthy' : (usersEligible > 0 ? 'partial' : 'healthy_suppressed'),
        suppressionReasons: {},
      });
    } catch (err) {
      logger.error('[NACE] Pulse failed', { error: err instanceof Error ? err.message : String(err) });
      logger.info('[NACE] Engine completed', {
        engine: 'NACE', event: 'engine_completed', runId: pulseRunId,
        durationMs: Date.now() - pulseStartMs,
        usersEvaluated, intentsDispatched, intentsSuppressed, intentsFailed: 0,
        outcome: 'failed',
      });
    } finally {
      _pulseInProgress = false;
    }
  }

  /** Internal: calls processUser and returns a structured dispatch result. */
  private async processUserWithResult(userId: string): Promise<{ dispatched: number; suppressed: number; eligible: number }> {
    const result = { dispatched: 0, suppressed: 0, eligible: 0 };
    await this.processUser(userId, undefined, result);
    return result;
  }

  async _processUser(userId: string): Promise<void> {
    return this.processUser(userId);
  }

  async processUser(userId: string, opts?: { trigger?: string; awayDurationMinutes?: number | null }, _result?: { dispatched: number; suppressed: number; eligible: number }): Promise<void> {
    const isSessionStart = opts?.trigger === 'session_start';
    const awayDurationMinutes = opts?.awayDurationMinutes ?? null;
    // Coma awareness: Don't reach out right after server boot to avoid spam
    if (Date.now() - serverBootTime < SERVER_BOOT_COOLDOWN_MS) {
      logger.info('[NACE] Skipping outreach — server just booted (coma cooldown)');
      return;
    }

    // 1. Fetch Profile & Temporal Context
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('push_token, preferred_name, timezone_offset, timezone, country')
      .eq('id', userId)
      .maybeSingle();

    if (!profile) return; // No profile at all — can't proceed
    const hasPushToken = !!profile.push_token;
    if (!hasPushToken) {
      logger.warn('[NACE] User has no push_token — will save to DB but skip push notification', { userId });
    }

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

    // Check if user is in a planned busy window
    const { data: busyUntilWM } = await supabaseAdmin
      .from('working_memory')
      .select('value')
      .eq('user_id', userId)
      .eq('key', 'user_busy_until')
      .maybeSingle();

    let busyWindowNote = '';
    if (busyUntilWM?.value) {
      const busyUntil = new Date(busyUntilWM.value).getTime();
      if (Date.now() < busyUntil) {
        // User is still in their busy window — but if they came online, ignore the busy check
        const { data: currentPresence } = await supabaseAdmin
          .from('user_presence')
          .select('status')
          .eq('user_id', userId)
          .maybeSingle();
          
        if (currentPresence?.status !== 'online') {
          logger.info('[NACE] User still in busy window, skipping outreach', { userId });
          return;
        }
        // If they came online during busy time → they might be done! Let NACE proceed.
        busyWindowNote = `User said they'd be busy until ${new Date(busyUntil).toLocaleTimeString()} but just came online — they might be done! Check in naturally.`;
      } else {
        // Busy window expired → clear it and proceed normally
        await supabaseAdmin.from('working_memory')
          .upsert({ user_id: userId, key: 'user_busy_until', value: '', updated_at: new Date().toISOString() }, { onConflict: 'user_id, key' });
        busyWindowNote = `User was busy but their estimated free time has now passed. Check in naturally — "Free ho gaye?"`;
      }
    }

    // Resolve user's timezone in fractional hours (e.g. 5.5 for IST)
    const userTzHours = resolveUserTzOffsetHours(profile || undefined);
    const tContext = await temporalAwarenessService.getContext(userId, userTzHours);

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

    // ── ACTIVE USER GUARD (with stuck conversation rescue) ───────────────────
    // If the user sent a message recently, check if they actually GOT a reply.
    // If Nova never replied (stuck conversation), NACE must rescue.
    if (gapMinutes < 10 && userPresence !== 'offline') {
      // Check: did Nova actually reply to the user's last message?
      const { data: lastAssistantMsg } = await supabaseAdmin
        .from('chat_history')
        .select('created_at, content')
        .eq('user_id', userId)
        .eq('role', 'assistant')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      const lastUserMsgTime = lastUserMsg ? new Date(lastUserMsg.created_at).getTime() : 0;
      const lastAssistantTime = lastAssistantMsg ? new Date(lastAssistantMsg.created_at).getTime() : 0;
      const isFallbackReply = lastAssistantMsg?.content?.includes('mujhe thoda sochne de');

      // Only skip if Nova genuinely replied AFTER the user's last message (and it wasn't a fallback)
      if (lastAssistantTime > lastUserMsgTime && !isFallbackReply) {
        logger.info('[NACE] Skipping — user is actively engaged and Nova replied', { userId, gapMinutes: Math.round(gapMinutes) });
        return;
      }
      // If we reach here, the user is active but Nova didn't reply → allow rescue
      logger.warn('[NACE] User active but Nova has NOT replied — allowing rescue outreach', { userId, gapMinutes: Math.round(gapMinutes) });
    }

    const getEffectiveMinGap = (presence: string): number => {
      switch (presence) {
        case 'typing': return 0;
        case 'online': return 1;    // 1 min for active online users (enables back-to-back)
        case 'away': return 3;      // 3 min if user stepped away
        case 'offline': return 1;   // 1 min base for offline (exponential backoff escalates from here)
        default: return 1;
      }
    };

    let effectiveMinGap = getEffectiveMinGap(userPresence);

    // Count unreplied Nova outreaches since user's last message
    const lastUserMsgTimeStr = lastUserMsg?.created_at || new Date(0).toISOString();

    // BUG-07 / BUG-05 fix: when triggered by session_start, exclude phantom
    // 'followup:unanswered:*' entries written by the faulty unanswered scanner
    // (BUG-05). These polluted ignoredCount causing 720-min escalation gaps that
    // silently blocked every session-start evaluation.
    const outreachQuery = supabaseAdmin
      .from('nova_outreach_log')
      .select('id')
      .eq('user_id', userId)
      .gte('created_at', lastUserMsgTimeStr);

    if (isSessionStart) {
      // Only count real NACE outreach — skip the unanswered-conversation phantom entries
      outreachQuery
        .in('outreach_type', ['agenda_followup', 'engagement_checkin'])
        .not('logical_key', 'like', 'followup:unanswered:%');
    }

    const { data: unrepliedOutreaches } = await outreachQuery;

    const ignoredCount = unrepliedOutreaches?.length || 0;

    // Escalation gap table — increases after each ignored message (Exponential backoff for offline)
    const getEscalatedGap = (ignored: number): number => {
      if (ignored <= 0) return 1;
      if (ignored === 1) return 60;       // 1 hour after first ignored
      if (ignored === 2) return 180;      // 3 hours after second ignored
      if (ignored === 3) return 360;      // 6 hours
      return 720;                         // 12 hours ongoing
    };

    const escalationGap = getEscalatedGap(ignoredCount);
    // Apply as the effective minimum gap (overrides effectiveMinGap if larger)
    if (userPresence === 'online') {
      // If user is actively online, enable "back-to-back" messaging - minimum 1 min floor
      // But still respect escalation if it's HIGHER (prevents ignoring user who went silent)
      // For online: floor is 1 min, but if escalation > 1, use escalation (user ignored us)
      effectiveMinGap = Math.max(1, escalationGap);
    } else {
      // For offline/away: use the escalation gap (exponential backoff applies)
      effectiveMinGap = Math.max(effectiveMinGap, escalationGap);
    }

    let isSleepWindowOverridden = false;
    let midSleepWakeNote = '';
    
    // If we're in sleep window but user just came online AND recently chatted → override sleep guard
    // TIGHTENED: require BOTH fresh presence (< 5min) AND actual recent chat (< 10min)
    // This prevents stale presence from waking NACE during real sleep hours.
    if (tContext.isSleepWindow && userPresence === 'online') {
      const presenceAge = presenceData?.updated_at 
        ? (Date.now() - new Date(presenceData.updated_at).getTime()) / 60000 : 999;
      // User must be BOTH recently active on presence AND have sent a message recently
      if (presenceAge < 5 && gapMinutes < 10) {
        // User is actively chatting during sleep hours → they're awake
        midSleepWakeNote = `It's ${tContext.hour}:00 and the user is AWAKE despite it being their sleep window. React naturally - don't act like a chatbot. Maybe they can't sleep, or woke up for something. Be warm and curious. Don't mention you noticed they're up.`;
        isSleepWindowOverridden = true;
      } else {
        // Presence is stale — user is probably asleep. Do NOT override sleep window.
        logger.info('[NACE] Sleep window — presence is stale, NOT overriding. User likely asleep.', { userId, presenceAge: Math.round(presenceAge), gapMinutes: Math.round(gapMinutes) });
      }
    }

    let shouldReachSilentVisit = false;
    let silentVisitNote = '';

    // If user visited silently 2+ times recently → Nova must reach out NOW, skip gap check
    const { data: silentVisitWm } = await supabaseAdmin
      .from('working_memory')
      .select('value, updated_at')
      .eq('user_id', userId)
      .eq('key', 'silent_visit_count')
      .maybeSingle();

    const silentVisitCount = parseInt(silentVisitWm?.value || '0', 10);
    const lastSilentVisit = silentVisitWm?.updated_at;

    if (silentVisitCount >= 2 && lastSilentVisit) {
      const minSinceSilentVisit = (Date.now() - new Date(lastSilentVisit).getTime()) / 60000;
      if (minSinceSilentVisit < 30) {
        shouldReachSilentVisit = true;
        silentVisitNote = `User has visited the chat screen ${silentVisitCount} times in the last 30 min without sending a message. They want to talk but haven't typed. Initiate conversation naturally.`;
      }
    }

    if (gapMinutes < effectiveMinGap && !shouldReachSilentVisit && !isSleepWindowOverridden) {
      // BUG-07: session_start evaluations bypass the gap check entirely.
      // ProactiveGate enforces cooldown via a 30-min logical key bucket.
      if (!isSessionStart) return;
      logger.info('[NACE] session_start: bypassing gap check — ProactiveGate will enforce 30-min bucket', { userId, gapMinutes: Math.round(gapMinutes), effectiveMinGap });
    }

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

    // ── REMINDER ACK CHECK ─────────────────────────────────────────────────────
    // If this agenda item is a reminder nag loop, check if user replied after
    // the reminder fired. If yes → auto-expire the loop. If no → let NACE nag.
    if (agendaItem?.source_message?.startsWith('reminder_ack_check:')) {
      const firedAt = agendaItem.source_message.replace('reminder_ack_check:', '');
      const { data: userReplyAfter } = await supabaseAdmin
        .from('chat_history')
        .select('id')
        .eq('user_id', userId)
        .eq('role', 'user')
        .gte('created_at', firedAt)
        .limit(1);

      if (userReplyAfter && userReplyAfter.length > 0) {
        // User acknowledged! Auto-expire the nag loop — stop nagging.
        await supabaseAdmin.from('nova_agenda')
          .update({ status: 'completed', updated_at: new Date().toISOString() })
          .eq('id', agendaItem.id);
        logger.info('[NACE] ✅ Reminder acknowledged by user — nag loop stopped', { userId });
        return; // Nothing more to do
      }
      // User has NOT replied since reminder fired → fall through to Tier 2 (re-nag)
      logger.info('[NACE] User has not acknowledged reminder — re-nagging', {
        userId,
        retryCount: agendaItem.retry_count,
        reminder: agendaItem.event_description?.substring(0, 60),
      });
    }

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

    // Do not disturb during sleep, UNLESS:
    // 1. High urgency agenda item exists
    // 2. User is actively chatting (sent a message in last 5 minutes — clearly not sleeping)
    const userIsActivelyChatting = gapMinutes < 5;
    if (tContext.isSleepWindow && !userIsActivelyChatting) {
      if (!agendaItem || agendaItem.urgency !== 'high') {
        logger.info('[NACE] Skipping — sleep window and user is not active', { userId });
        return;
      }
    }

    // --- GATHER FULL CONTEXT (All Engines) ---
    const [memoriesRes, workingMemoriesRes] = await Promise.all([
      supabaseAdmin
        .from('memories')
        .select('key, value, memory_type')
        .eq('user_id', userId)
        .eq('is_archived', false)
        .order('updated_at', { ascending: false })
        .limit(30),
      supabaseAdmin
        .from('working_memory')
        .select('key, value')
        .eq('user_id', userId)
        .not('key', 'in', '("last_proactive_content","silent_visit_count","followup_suppressed_until","user_busy_until")')
        .order('updated_at', { ascending: false })
        .limit(15)
    ]);

    const recentMemories = memoriesRes.data || [];
    const workingMemories = workingMemoriesRes.data || [];

    const workingContextObj: Record<string, string> = {};
    for (const row of workingMemories) {
      workingContextObj[row.key] = typeof row.value === 'object' ? JSON.stringify(row.value) : String(row.value);
    }

    const stageCtx = await userLifeStageEngine.getUserLifeStageContext(userId, recentMemories, workingContextObj);

    // If user is in WORK_FOCUS hours and there is no high-urgency agenda, protect their focus!
    if (stageCtx.lifestyleRhythm.isWorkFocusHours && (!agendaItem || agendaItem.urgency !== 'high') && !userIsActivelyChatting) {
      logger.info('[NACE] Suppressing proactive pulse — user is in WORK_FOCUS shift at ' + (stageCtx.primaryLivelihood?.name || 'work'), { userId });
      return;
    }

    const memorySummary = recentMemories.map(m => `[${m.memory_type}] ${m.key}: ${m.value}`).join('\n');
    const missingMemoryCuriosities = deriveMissingMemoryCuriosities(recentMemories, workingContextObj);
    const missingCuriositiesSummary = missingMemoryCuriosities.length > 0
      ? missingMemoryCuriosities.map(c => `• ${c}`).join('\n')
      : 'None.';
      
    const workingMemorySummary = workingMemories.map(m => `${m.key}: ${m.value}`).join('\n');
    
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

    // Fetch Life Threads (Phase 8) to ground proactive follow-ups
    const { data: lifeThreads } = await supabaseAdmin
      .from('life_threads')
      .select('topic, state, priority, provenance')
      .eq('user_id', userId)
      .in('state', ['active', 'waiting', 'blocked'])
      .order('last_relevant_at', { ascending: false })
      .limit(5);
    const lifeThreadSummary = (lifeThreads || []).map(t => `[${t.state.toUpperCase()}] ${t.topic}: ${t.provenance || ''}`).join('\n');

    // ── DETERMINISTIC RELEVANCE GATE ─────────────────────────────────────────
    // Before invoking Tier 1, ensure there is SOME valid context to speak about.
    // Time alone is NOT a reason. If there is absolutely no recent memory, no working memory,
    // no active chat history, and no agenda, do NOT send a proactive message.
    const hasGroundedReason = !!agendaItem || 
                              shouldReachSilentVisit || 
                              isSleepWindowOverridden || 
                              (recentMemories && recentMemories.length > 0) || 
                              (workingMemories && workingMemories.length > 0) || 
                              (lastConversation && lastConversation.length > 0) ||
                              (lifeThreads && lifeThreads.length > 0) ||
                              missingMemoryCuriosities.length > 0;

    if (!hasGroundedReason) {
      logger.info('[NACE] Deterministic Gate: Skipping — no grounded reason (no agenda, no memory, no chat context, no open threads)', { userId });
      return;
    }

    // ── EXACT-MATCH DEDUP: Never send the same proactive message twice ──────
    // This prevents the bug where "Arey, busy hai kya?" was sent at 12:01 AM and again at 2:10 AM
    // Check last 5 outreach messages for exact or near-exact match against what Tier 2 might generate
    // (We store outreach messages; the check happens AFTER Tier 2 generates, see below)

    // --- TIER 1: The Subconscious Decision (Fast, Cheap) ---
    let abandonmentNote = '';
    let spontaneousThoughtNote = '';

    if (userPresence === 'online' && gapMinutes >= 5 && gapMinutes <= 15) {
      // User is online but not typing — gentle single nudge only (not spam)
      abandonmentNote = "GENTLE SINGLE NUDGE: User is looking at the chat but hasn't said anything for a few minutes. Send ONE casual message (e.g. 'kuch soch raha hai?', 'bata na...'). Do NOT send multiple messages — they can see you. ";
    } else if (userPresence === 'offline' && gapMinutes >= 10 && gapMinutes <= 60) {
      // User went offline recently — send ONE check-in (bathing, eating, commuting, etc.)
      abandonmentNote = "USER JUST LEFT: They were here but went offline. They might be doing something (bathing, eating, commuting). Send ONE message acknowledging they might be busy — don't ask 'where are you' directly, just continue the conversation naturally or share something useful. ";
    } else if (gapMinutes > 120 && !agendaItem && !tContext.isSleepWindow) {
      // Long silence — spontaneous helpful message
      spontaneousThoughtNote = "LONG SILENCE CHECK-IN: It's been quiet for 2+ hours. Don't ask 'how are you'. Instead, share something useful: a thought about their goals, a reminder about something they mentioned, a quick tip, or just say something funny/interesting. Be genuinely helpful. ";
    }

    // BUG-07: Session-start context note for Tier 1
    // Tells the LLM this is a returning-user evaluation, not a routine check-in.
    const sessionStartNote = isSessionStart
      ? `\nSESSION START EVALUATION: User just returned online after ${awayDurationMinutes !== null ? awayDurationMinutes + ' minutes' : 'some time'} away.\nThis is a session-start evaluation, NOT a routine NACE check-in.\nIf there is unresolved context, an active conversation topic, or known family/personal facts with missing natural curiosities (e.g. asking about son's age or wife): recommend YES (triggerType: 'curiosity' or 'engagement').\nIf there is genuinely zero context or user was just spoken to: choose NO.`
      : '';

    const tier1Context = `Time: ${tContext.timeOfDayLabel} (${tContext.hour}:00), Day: ${tContext.dayOfWeek}
Is Sleep Window: ${tContext.isSleepWindow}
User Presence: ${userPresence} (${userPresence === 'online' ? 'actively using app' : userPresence === 'away' ? 'was active recently' : 'not on app'})
Gap Since User Last Messaged: ${Math.round(gapMinutes)} minutes
Min Gap Allowed Right Now: ${effectiveMinGap} minutes (based on presence)
Dynamic Situational Gap: ${dynamicGap} minutes
Pending Agenda Item: ${agendaItem ? agendaItem.event_description + ' [urgency: ' + agendaItem.urgency + ']' : 'None'}
Recent Memories: ${memorySummary || 'None'}
Missing Facts & Natural Curiosity Opportunities:
${missingCuriositiesSummary}
Working Memory: ${workingMemorySummary || 'None'}
Last Conversation Snippet: ${lastConvSnippet || 'None'}
Active Life Threads: ${lifeThreadSummary || 'None'}
${abandonmentNote}
${spontaneousThoughtNote}
${sessionStartNote}
DECISION RULES (use actual gap values above, not hardcoded numbers):
- User is ONLINE: reach out if gap >= 1 min. Being active means they'll see your message immediately — enable back-to-back messaging.
- User is AWAY: reach out if gap >= 3 min. They stepped away but will see it soon.
- User is OFFLINE: reach out if gap >= 1 min initially (exponential backoff applies). They're not active right now.
- Missing Facts / Family Curiosity: If the user recently shared family members (e.g. wife, son) and natural details are missing (e.g. child's age or schooling, spouse), recommend YES with triggerType: 'curiosity' to show genuine care and interest like a best friend.
- High urgency agenda item: ALWAYS reach out during non-sleep hours.
- Morning/afternoon work hours without agenda: only reach if gap > 20 min or there is family/life thread curiosity.
- Evening/night with no agenda: reach out freely if gap >= dynamic gap.
- Sleep window: only high-urgency agenda. Otherwise NO.
- PROACTIVE RESTRAINT: If there is no specific, grounded reason to message (e.g. no agenda, no recent context to follow up on, no missing fact to ask about), choose NO. Time of day alone is NOT a sufficient reason to check in.`;

    let shouldReach = false;
    let triggerType = isSessionStart ? 'session_start' : 'engagement';
    let seenNoReplyContext = ''; // Injected into Tier2 if user saw message but didn't reply

    // ── READ RECEIPT AWARENESS ─────────────────────────────────────────────────
    // If Nova sent a message that the user opened (is_read=true) but never replied to,
    // after 3 minutes Nova should follow up naturally (without revealing she tracks reads).
    try {
      const { data: seenMsg } = await supabaseAdmin
        .from('chat_history')
        .select('id, content, created_at')
        .eq('user_id', userId)
        .eq('role', 'assistant')
        .eq('is_read', true)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (seenMsg) {
        const seenAt = new Date(seenMsg.created_at).getTime();
        const minSinceSeen = (Date.now() - seenAt) / 60000;
        // Check if user replied AFTER this message
        const { data: replyAfter } = await supabaseAdmin
          .from('chat_history')
          .select('id')
          .eq('user_id', userId)
          .eq('role', 'user')
          .gt('created_at', seenMsg.created_at)
          .limit(1);

        // Do NOT nag for 'seen no reply' if the user is explicitly in a busy window
        const isCurrentlyBusy = !!busyWindowNote && !busyWindowNote.includes('might be done');
        if (!replyAfter?.length && minSinceSeen >= 3 && minSinceSeen < 60 && !isCurrentlyBusy && !tContext.isSleepWindow) {
          seenNoReplyContext = `READ BUT NO REPLY: User opened Nova's message "${seenMsg.content.substring(0, 100)}" ${Math.round(minSinceSeen)} min ago but hasn't replied. Follow up naturally — don't repeat the same message, just nudge (e.g. 'Bata na...', share a new thought). NEVER say 'I noticed you read my message'.`;
          logger.info('[NACE] 👁️ Seen-no-reply detected — injecting follow-up context', { userId, minSinceSeen: Math.round(minSinceSeen) });
        }
      }
    } catch (seenErr) {
      // Non-critical — don't let read-receipt check break the whole pulse
      logger.warn('[NACE] Read receipt check failed (non-critical)', { error: seenErr instanceof Error ? seenErr.message : String(seenErr) });
    }

    try {
      const decision = await novaBrain.evaluateConsciousnessTier1(tier1Context);
      shouldReach = decision.shouldReach;
      triggerType = decision.triggerType || 'engagement';
    } catch (e) {
      logger.warn('[NACE] Tier 1 LLM failed — using presence-aware fallback');
      // Presence-aware fallback: reach out if the situation warrants it
      if (agendaItem && !tContext.isSleepWindow) {
        shouldReach = true; // Always fire for pending agenda
      } else if (!tContext.isSleepWindow && gapMinutes >= effectiveMinGap) {
        // Long silence during waking hours → reach out even without agenda
        // This is the key fix: previously only fired if userPresence === 'online'
        shouldReach = true;
        triggerType = 'engagement';
      }
    }

    if (!shouldReach) {
      // Even if Tier1 said no — if user read a message and didn't reply, always follow up
      if (seenNoReplyContext) {
        shouldReach = true;
        triggerType = 'seen_no_reply';
        logger.info('[NACE] Overriding Tier1 NO — seen-no-reply follow-up forced', { userId });
      } else if (shouldReachSilentVisit) {
        shouldReach = true;
        triggerType = 'silent_visits';
        logger.info('[NACE] Overriding Tier1 NO — silent visits follow-up forced', { userId });
      } else if (isSleepWindowOverridden) {
        shouldReach = true;
        triggerType = 'mid_sleep_wake';
        logger.info('[NACE] Overriding Tier1 NO — mid-sleep wake follow-up forced', { userId });
      } else {
        return;
      }
    }

    // --- TIER 2: Generation (Full Model) ---
    // At this point the user passed ALL NACE eligibility gates:
    //   boot cooldown ✓, profile ✓, suppression lock ✓, gap check ✓,
    //   grounded reason ✓, shouldReach ✓ (Tier 1 approved or override).
    // This is the correct point to count as "eligible" — not merely "evaluated".
    if (_result) _result.eligible += 1;


    // Build reminder nag escalation hint for Tier 2
    const isReminderNag = agendaItem?.source_message?.startsWith('reminder_ack_check:');
    const nagRetry = isReminderNag ? (agendaItem?.retry_count || 0) : 0;
    const reminderNagNote = isReminderNag
      ? `REMINDER NAG (attempt ${nagRetry + 1}/10): User has NOT acknowledged the reminder "${agendaItem?.event_description?.substring(0, 100)}". Re-remind them now. Escalate tone based on attempt number — see rule 25. Do NOT use the exact same phrasing as before.`
      : '';

    // Inject emotional escalation tone into Tier2 context
    const getEscalationTone = (ignored: number, gapHours: number): string => {
      if (ignored <= 1) return '';
      if (ignored === 2) return `USER SEEMS BUSY: Nova has texted twice with no reply. Keep it light and understanding — "Busy lag raha hai, koi nahi. Text karna jab free ho."`;
      if (ignored === 3) return `GENUINELY CONCERNED: User hasn't replied in hours. Write a warmer, slightly longer message (2-3 sentences). Show you actually care where they are.`;
      if (ignored === 4) return `LONG SILENCE (${Math.round(gapHours)}h): Write a more heartfelt message (3-4 sentences). Reference last conversation. Genuine, not needy.`;
      return `VERY LONG SILENCE (${Math.round(gapHours)}h): Write a long, emotionally real message (4-5 sentences). Express that you genuinely missed talking. Recall a fond memory from your last conversation. End with a warm open-ended question. This is NOT a notification — it's a real friend reaching out after too long.`;
    };
    const escalationTone = getEscalationTone(ignoredCount, gapMinutes / 60);

    // BUG-07: returning-user context note for Tier 2
    const sessionStartContextNote = isSessionStart && shouldReach
      ? `RETURNING USER OPENING: User just came back online after ${awayDurationMinutes !== null ? awayDurationMinutes + ' min' : 'some time'} away. Do NOT use a generic greeting like "hey" or "kaise ho". Open with ONE specific thing you know about them that is genuinely unresolved, a warm question about their family / missing facts (e.g. asking about Shreshth's age/school or Sakshi), or relevant RIGHT NOW. If there is nothing specific, STAY SILENT (return empty message).`
      : '';

    const tier2Context = `Name: ${profile.preferred_name || stageCtx.userName || 'yaar'}
Time/Day: ${tContext.dayOfWeek}, ${tContext.timeOfDayLabel} (${tContext.hour}:00)
User Life Stage & Real Stakes: ${stageCtx.stageLabel}
Core Purpose & Mission: ${stageCtx.corePurposeSummary}
Daily Lifestyle Phase: ${stageCtx.lifestyleRhythm.phaseDescription}
Silence Duration: ${Math.round(gapMinutes / 60)} hours
Trigger: ${triggerType}
Agenda Context: ${agendaItem ? agendaItem.follow_up_question : 'N/A'}
Recent Memories: ${memorySummary}
Missing Facts & Strategic Curiosities:
${missingCuriositiesSummary}
Working Memory: ${workingMemorySummary || 'None.'}
Active Life Threads: ${lifeThreadSummary || 'None.'}

RECENT OUTREACH MESSAGES (Do NOT repeat or closely rephrase these):
${recentOutreachSnippet || 'None.'}

LAST CONVERSATION (what was actually said — reference this naturally):
${lastConvSnippet || 'No recent conversation.'}
${abandonmentNote}
${spontaneousThoughtNote}
${reminderNagNote}
${seenNoReplyContext}
${busyWindowNote}
${silentVisitNote}
${midSleepWakeNote}
${escalationTone}
${sessionStartContextNote}
PURPOSE-DRIVEN COMPANION DIRECTIVE:
- Speak as a perceptive, supportive life companion who understands their real-world stakes (father of baby Shreshth, family provider, Conviction HR lead, aspiring founder of Shetty's Dhaba).
- NEVER ask questions about facts already known (Sakshi's cooking talent and nail art are known; Shreshth's infant age is known).
- If exploring ventures or family, connect the dots (e.g. how Sakshi's recipes anchor Shetty's Dhaba, or gentle check-in on baby).
- Keep it short (1-2 sentences in natural conversational Hinglish).`;


    try {
      // Generate the Tier 2 message directly — NACE is already on a scheduled timer, no extra delay needed
      const generated = await novaBrain.evaluateConsciousnessTier2(tier2Context);
      
      if (!generated.message) {
        logger.warn('[NACE] Tier 2 returned empty message', { userId });
        return;
      }

      const message = generated.message;

      // ── AUTHORITATIVE PROACTIVE GATE ─────────────────────────────────────────
      // Single DB-backed gate that enforces dedup, cooldown, logical-key idempotency
      // across all proactive engines. Replaces in-memory dedup maps.
      const agendaId = agendaItem?.id ?? 'none';
      // BUG-07: session_start uses its own 30-min bucket so it is never blocked by
      // the routine engagement 1-hour bucket. Each session-start is a distinct event.
      const logicalKey = agendaItem
        ? `nace:agenda:${agendaId}`
        : isSessionStart
          ? `nace:session_start:${userId}:${Math.floor(Date.now() / (30 * 60 * 1000))}` // 30-min bucket
          : `nace:engagement:${userId}:${Math.floor(Date.now() / (60 * 60 * 1000))}`; // 1-hour bucket

      const intentType = agendaItem ? 'agenda_followup' : (isSessionStart ? 'session_start' : 'engagement_checkin');

      // Update agenda retry state BEFORE delivery so a crash doesn't re-fire it immediately
      if (agendaItem) {
        const newRetryCount = (agendaItem.retry_count || 0) + 1;
        if (newRetryCount >= (agendaItem.max_retries || 3)) {
          await supabaseAdmin.from('nova_agenda').update({ status: 'expired', updated_at: new Date().toISOString() }).eq('id', agendaItem.id);
        } else {
          let delayHours = 24;
          if (agendaItem.urgency === 'high') delayHours = 4;
          else if (agendaItem.urgency === 'medium') delayHours = 8;
          const nextRetry = new Date(Date.now() + delayHours * 60 * 60 * 1000).toISOString();
          await supabaseAdmin.from('nova_agenda').update({
            retry_count: newRetryCount, next_retry_at: nextRetry, updated_at: new Date().toISOString()
          }).eq('id', agendaItem.id);
        }
      }

      // Dispatch through OutboundDispatcher
      // idempotencyKey is derived from logicalKey — a stable, caller-supplied durable identity.
      // Do NOT use crypto.randomUUID() here: a retry or restart would produce a different key
      // and break idempotency guarantees.
      const dispatchResult = await outboundDispatcherService.dispatch({
        userId,
        sourceEngine: 'NACE' as OutboundSource,
        intentType,
        logicalKey,
        idempotencyKey: `nace:${logicalKey}`, // Derived from stable logicalKey — safe across retries
        context: {}, // No additional context needed since we use strategy 'none'
        generationStrategy: 'none',
        proposedMessage: message,
        skipQuietHoursCheck: true // NACE already checked
      });
      const finalStatus = dispatchResult.status;

      if (dispatchResult.terminal && dispatchResult.status !== 'FAILED_TERMINAL') {
        if (_result) _result.dispatched += 1;
        logger.info('[NACE] ✅ Proactive message processed by dispatcher', {
          userId, messagePreview: message.substring(0, 60),
          decision: { outreachType: intentType, logicalKey },
          finalStatus
        });
      } else {
        if (_result) _result.suppressed += 1;
        logger.info('[NACE] 🚫 Intent blocked or failed in dispatcher', { userId, finalStatus, reason: dispatchResult.reason });
      }
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
        const { data: profile } = await supabaseAdmin.from('profiles').select('timezone_offset, timezone, country').eq('id', userId).maybeSingle();
        const tzOffset = Math.round(resolveUserTzOffsetHours(profile || undefined) * 60);

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
