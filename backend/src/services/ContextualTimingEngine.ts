/**
 * ContextualTimingEngine.ts — Phase 3C-B Deterministic Contextual Timing Engine
 *
 * ARCHITECTURAL INVARIANTS:
 * 1. ATTENTION != OUTREACH: Decouples internal attention from external user interruption.
 * 2. DETERMINISTIC TIMING: Evaluates timing gates strictly via code heuristics (0 LLM calls).
 * 3. EXPLICIT TIMING STATES: NOW, SOON, WAIT, QUIET, BLOCKED, EXPIRED.
 * 4. GOVERNED OUTREACH ELIGIBILITY: PROACTIVE_ELIGIBLE, DEFER, SUPPRESS, EXPIRED.
 * 5. CONVERSATION PROTECTION: Prevents derailing active chat Topic A with unrelated Topic B.
 * 6. FAIL-SAFE CONSERVATISM: Missing or failing context defaults to WAIT/DEFER.
 * 7. ZERO DIRECT MESSAGING: 0 push dispatches, 0 chat message inserts.
 * 8. ZERO DESTRUCTIVE RETENTION: 0 memory deletions, 0 source deletions.
 */

import { supabaseAdmin } from '../lib/supabase';
import { logger } from '../lib/logger';
import { qt } from '../lib/queryTracker';
import {
  TimingState,
  OutreachEligibility,
  TimingConfidence,
  OutreachSourceClass,
  TimingReasonCode,
  TimingContext,
  WatchtowerTimingDecision,
  WATCHTOWER_TIMING_LIMITS,
  generateTimingFingerprint,
} from '../types/watchtowerTiming';
import { WatchtowerAttentionDecision } from '../types/watchtowerAttention';

export interface TimingEngineSummary {
  userId: string;
  totalEvaluated: number;
  nowCount: number;
  soonCount: number;
  waitCount: number;
  quietCount: number;
  blockedCount: number;
  expiredCount: number;
  proactiveEligibleCount: number;
  decisionsPersisted: number;
  llmCalls: number;
  durationMs: number;
}

export class ContextualTimingEngine {
  /**
   * Evaluates contextual timing for all active attention decisions of a user.
   */
  async evaluateUserTiming(
    userId: string,
    prebuiltContext?: TimingContext
  ): Promise<TimingEngineSummary> {
    const startedAt = Date.now();
    const summary: TimingEngineSummary = {
      userId,
      totalEvaluated: 0,
      nowCount: 0,
      soonCount: 0,
      waitCount: 0,
      quietCount: 0,
      blockedCount: 0,
      expiredCount: 0,
      proactiveEligibleCount: 0,
      decisionsPersisted: 0,
      llmCalls: 0,
      durationMs: 0,
    };

    if (!userId) return summary;

    try {
      // 1. Assemble Deterministic Timing Context
      const context = prebuiltContext || (await this.assembleTimingContext(userId));

      // 2. Fetch Active Attention Decisions from Phase 3B
      const activeDecisions = await this.fetchActiveAttentionDecisions(userId);
      summary.totalEvaluated = activeDecisions.length;

      // 3. Evaluate Timing State for each Attention Decision
      for (const att of activeDecisions) {
        const timingDecision = this.evaluateTiming(userId, att, context);

        if (timingDecision.timingState === 'NOW') summary.nowCount += 1;
        if (timingDecision.timingState === 'SOON') summary.soonCount += 1;
        if (timingDecision.timingState === 'WAIT') summary.waitCount += 1;
        if (timingDecision.timingState === 'QUIET') summary.quietCount += 1;
        if (timingDecision.timingState === 'BLOCKED') summary.blockedCount += 1;
        if (timingDecision.timingState === 'EXPIRED') summary.expiredCount += 1;

        if (timingDecision.outreachEligibility === 'PROACTIVE_ELIGIBLE') {
          summary.proactiveEligibleCount += 1;
        }

        // 4. Persist Timing Decision Log (Bounded Observability)
        const persisted = await this.persistTimingDecision(timingDecision);
        if (persisted) summary.decisionsPersisted += 1;
      }

      summary.durationMs = Date.now() - startedAt;

      logger.info('[ContextualTimingEngine] Completed timing evaluation', {
        userId,
        evaluated: summary.totalEvaluated,
        now: summary.nowCount,
        soon: summary.soonCount,
        quiet: summary.quietCount,
        eligible: summary.proactiveEligibleCount,
        durationMs: summary.durationMs,
      });

      return summary;
    } catch (err: any) {
      logger.error('[ContextualTimingEngine] Timing evaluation error', { userId, error: err?.message });
      summary.durationMs = Date.now() - startedAt;
      return summary;
    }
  }

  /**
   * Assembles a complete, deterministic TimingContext from existing DB records (0 LLM calls).
   */
  async assembleTimingContext(userId: string): Promise<TimingContext> {
    const nowUtc = new Date();

    try {
      const [profileRes, presenceRes, sessionRes, chatRes, outreachRes] = await Promise.all([
        qt.track('timing_fetch_profile', 'profiles', () =>
          supabaseAdmin.from('profiles').select('timezone, preferred_name').eq('id', userId).maybeSingle()
        ),
        qt.track('timing_fetch_presence', 'user_presence', () =>
          supabaseAdmin.from('user_presence').select('status, last_active_at, last_typing_at').eq('user_id', userId).maybeSingle()
        ),
        qt.track('timing_fetch_session', 'conversation_sessions', () =>
          supabaseAdmin
            .from('conversation_sessions')
            .select('id, state, current_topic, last_message_at')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle()
        ),
        qt.track('timing_fetch_chat', 'chat_history', () =>
          supabaseAdmin
            .from('chat_history')
            .select('role, content, created_at')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(5)
        ),
        qt.track('timing_fetch_outreach', 'nova_outreach_log', () =>
          supabaseAdmin
            .from('nova_outreach_log')
            .select('id, outreach_type, created_at, user_replied')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(20)
        ),
      ]);

      const rawTimezone = profileRes.data?.timezone || '';
      const isTzValid = this.isValidTimezone(rawTimezone);
      const timezone = isTzValid ? rawTimezone.trim() : '';
      const nowLocal = isTzValid ? this.deriveLocalDateTime(nowUtc, timezone) : nowUtc;
      const localHour = isTzValid ? nowLocal.getHours() + nowLocal.getMinutes() / 60 : 0;

      // Quiet Hours Evaluation (Default: 23:00 to 07:30 local)
      // If timezone is invalid/missing, isQuietHours is true (conservative fail-safe)
      const isQuietHours =
        !isTzValid ||
        localHour >= WATCHTOWER_TIMING_LIMITS.DEFAULT_QUIET_HOURS_START ||
        localHour < WATCHTOWER_TIMING_LIMITS.DEFAULT_QUIET_HOURS_END;

      // Presence & Message Gap Analysis
      const presence = presenceRes.data;
      const presenceStatus = (presence?.status as 'online' | 'away' | 'offline' | 'typing') || 'offline';

      const recentMessages = chatRes.data || [];
      const lastUserMsg = recentMessages.find(m => m.role === 'user');
      let gapMinutesSinceLastMessage: number | null = null;
      let isUserInActiveTurn = false;

      if (lastUserMsg?.created_at) {
        gapMinutesSinceLastMessage = Math.max(
          0,
          Math.floor((nowUtc.getTime() - new Date(lastUserMsg.created_at).getTime()) / (1000 * 60))
        );
        // Active turn if user spoke within last 3 minutes or is currently typing
        isUserInActiveTurn = gapMinutesSinceLastMessage < 3 || presenceStatus === 'typing';
      }

      // Outreach History Analysis
      const outreachLogs = outreachRes.data || [];
      const oneHourAgo = nowUtc.getTime() - 60 * 60 * 1000;
      const twentyFourHoursAgo = nowUtc.getTime() - 24 * 60 * 60 * 1000;

      const touchesLast24Hours = outreachLogs.filter(o => new Date(o.created_at).getTime() >= twentyFourHoursAgo).length;
      const touchesLast1Hour = outreachLogs.filter(o => new Date(o.created_at).getTime() >= oneHourAgo).length;

      let lastOutreachMinutesAgo: number | null = null;
      if (outreachLogs.length > 0) {
        lastOutreachMinutesAgo = Math.max(
          0,
          Math.floor((nowUtc.getTime() - new Date(outreachLogs[0].created_at).getTime()) / (1000 * 60))
        );
      }

      // Calculate consecutive ignored outreaches
      let consecutiveIgnoredCount = 0;
      for (const log of outreachLogs) {
        if (!log.user_replied) {
          consecutiveIgnoredCount += 1;
        } else {
          break; // Stop counting once user replied
        }
      }

      const currentChatTopic = sessionRes.data?.current_topic || null;

      return {
        userId,
        nowUtc,
        nowLocal,
        timezone,
        localHour,
        isQuietHours,
        presenceStatus,
        isUserInActiveTurn,
        gapMinutesSinceLastMessage,
        currentChatTopic,
        touchesLast24Hours,
        touchesLast1Hour,
        lastOutreachMinutesAgo,
        consecutiveIgnoredCount,
        minutesSinceTopicMentioned: null,
        hasUserAcknowledgedTopic: false,
      };
    } catch (err: any) {
      logger.warn('[ContextualTimingEngine] Context assembly failed, using conservative fail-safe', {
        userId,
        error: err?.message,
      });

      // Fail-Safe Conservative Context
      return {
        userId,
        nowUtc,
        nowLocal: nowUtc,
        timezone: '',
        localHour: 0,
        isQuietHours: true, // Conservative default
        presenceStatus: 'offline',
        isUserInActiveTurn: true, // Conservative default
        gapMinutesSinceLastMessage: 0,
        currentChatTopic: null,
        touchesLast24Hours: 5, // Conservative ceiling
        touchesLast1Hour: 1,
        lastOutreachMinutesAgo: 0,
        consecutiveIgnoredCount: 0,
        minutesSinceTopicMentioned: null,
        hasUserAcknowledgedTopic: false,
      };
    }
  }

  /**
   * Evaluates deterministic timing gates in strict hierarchical order.
   */
  evaluateTiming(
    userId: string,
    attention: WatchtowerAttentionDecision,
    ctx: TimingContext
  ): WatchtowerTimingDecision {
    const now = Date.now();
    const sourceClass = this.classifyOutreachSource(attention.targetType, attention.evidence);
    const ttlDays = WATCHTOWER_TIMING_LIMITS.TIMING_LOG_TTL_DAYS;
    const expiresAt = new Date(now + ttlDays * 24 * 60 * 60 * 1000).toISOString();

    // ── GATE 1: EXPIRED CHECK ────────────────────────────────────────────────
    if (
      attention.status === 'EXPIRED' ||
      (attention.expiresAt && new Date(attention.expiresAt).getTime() <= now)
    ) {
      return this.buildDecision(
        userId,
        attention,
        'EXPIRED',
        'EXPIRED',
        'HIGH_CONFIDENCE',
        sourceClass,
        'EXPIRED',
        ctx,
        expiresAt,
        'Attention decision or event has passed expiration threshold.'
      );
    }

    // ── GATE 2: ALREADY HANDLED CHECK ────────────────────────────────────────
    if (
      attention.status === 'ACTED' ||
      (attention.scores && attention.scores.alreadyHandledPenalty >= 80)
    ) {
      return this.buildDecision(
        userId,
        attention,
        'BLOCKED',
        'SUPPRESS',
        'HIGH_CONFIDENCE',
        sourceClass,
        'ALREADY_HANDLED',
        ctx,
        expiresAt,
        'Item is already handled, completed, or cancelled.'
      );
    }

    // ── GATE 3: EXPLICIT STOP / DISMISSED CHECK ──────────────────────────────
    if (attention.status === 'DISMISSED') {
      return this.buildDecision(
        userId,
        attention,
        'BLOCKED',
        'SUPPRESS',
        'HIGH_CONFIDENCE',
        sourceClass,
        'USER_STOPPED',
        ctx,
        expiresAt,
        'User explicitly stopped or dismissed this attention item.'
      );
    }

    // ── GATE 4: USER DEFERRED / LATER CHECK ──────────────────────────────────
    if (attention.deferUntil && new Date(attention.deferUntil).getTime() > now) {
      return this.buildDecision(
        userId,
        attention,
        'WAIT',
        'DEFER',
        'HIGH_CONFIDENCE',
        sourceClass,
        'USER_DEFERRED',
        ctx,
        expiresAt,
        `Item deferred by user until ${attention.deferUntil}`,
        attention.deferUntil
      );
    }

    // ── GATE 5: LOW PRIORITY / IGNORE CHECK ──────────────────────────────────
    if (attention.attentionClass === 'IGNORE') {
      return this.buildDecision(
        userId,
        attention,
        'BLOCKED',
        'SUPPRESS',
        'HIGH_CONFIDENCE',
        sourceClass,
        'LOW_PRIORITY',
        ctx,
        expiresAt,
        'Low priority or non-actionable background signal.'
      );
    }

    // ── GATE 6: SUPERVISORY WATCH CHECK ──────────────────────────────────────
    if (attention.attentionClass === 'WATCH') {
      return this.buildDecision(
        userId,
        attention,
        'WAIT',
        'DEFER',
        'HIGH_CONFIDENCE',
        sourceClass,
        'LOW_PRIORITY',
        ctx,
        expiresAt,
        'High importance but low urgency; kept in supervisory watch.'
      );
    }

    // ── GATE 7: INTERNAL SYSTEM SIGNAL CHECK ─────────────────────────────────
    if (attention.targetType === 'guardian_signal') {
      return this.buildDecision(
        userId,
        attention,
        'WAIT',
        'DEFER',
        'HIGH_CONFIDENCE',
        sourceClass,
        'INTERNAL_SIGNAL',
        ctx,
        expiresAt,
        'Internal system integrity signal; no direct user outreach required.'
      );
    }

    // ── GATE 8: MISSING TIMEZONE / CONTEXT FAIL-SAFE ─────────────────────────
    if (!ctx.timezone || !this.isValidTimezone(ctx.timezone)) {
      return this.buildDecision(
        userId,
        attention,
        'WAIT',
        'DEFER',
        'LOW_CONFIDENCE',
        sourceClass,
        'MISSING_TIMEZONE',
        ctx,
        expiresAt,
        'User timezone missing, invalid, or uncertain; defaulting to WAIT/DEFER fail-safe.'
      );
    }

    // ── GATE 9: QUIET HOURS CHECK (23:00 to 07:30) ───────────────────────────
    if (ctx.isQuietHours) {
      // Explicit Urgent Deadline Override Check
      const isUrgentWithDeadline =
        attention.attentionClass === 'URGENT' &&
        attention.scores &&
        attention.scores.deadlineProximity >= 90;

      if (isUrgentWithDeadline) {
        // Can proceed with MEDIUM_CONFIDENCE under strict deadline proximity
        return this.buildDecision(
          userId,
          attention,
          'NOW',
          'PROACTIVE_ELIGIBLE',
          'MEDIUM_CONFIDENCE',
          sourceClass,
          'DEADLINE_IMMINENT',
          ctx,
          expiresAt,
          'Urgent deadline approaching within <2h; overrides quiet hours.'
        );
      }

      const morningSlot = new Date(ctx.nowLocal);
      morningSlot.setHours(7, 30, 0, 0);
      if (morningSlot.getTime() <= ctx.nowLocal.getTime()) {
        morningSlot.setDate(morningSlot.getDate() + 1);
      }

      return this.buildDecision(
        userId,
        attention,
        'QUIET',
        'DEFER',
        'HIGH_CONFIDENCE',
        sourceClass,
        'QUIET_HOURS',
        ctx,
        expiresAt,
        'Current local time is in Quiet Hours (23:00–07:30).',
        morningSlot.toISOString()
      );
    }

    // ── GATE 10: CONSECUTIVE IGNORED LIMIT (Max 3) ───────────────────────────
    if (ctx.consecutiveIgnoredCount >= WATCHTOWER_TIMING_LIMITS.CONSECUTIVE_IGNORED_CAP) {
      return this.buildDecision(
        userId,
        attention,
        'BLOCKED',
        'SUPPRESS',
        'HIGH_CONFIDENCE',
        sourceClass,
        'ALREADY_TOLD',
        ctx,
        expiresAt,
        'User has ignored 3+ consecutive proactive outreaches; cooling down.'
      );
    }

    // ── GATE 11: RECENT OUTREACH COOLDOWN (<60 min) ──────────────────────────
    if (ctx.lastOutreachMinutesAgo !== null && ctx.lastOutreachMinutesAgo < 60) {
      return this.buildDecision(
        userId,
        attention,
        'SOON',
        'DEFER',
        'HIGH_CONFIDENCE',
        sourceClass,
        'RECENT_OUTREACH',
        ctx,
        expiresAt,
        `Recent outreach sent ${ctx.lastOutreachMinutesAgo}m ago; in micro-cooldown.`
      );
    }

    // ── GATE 12: ACTIVE CONVERSATION & TOPIC COLLISION ───────────────────────
    if (ctx.isUserInActiveTurn) {
      // Check topic relevance
      const targetEntity = (attention.evidence?.data?.text || attention.evidence?.data?.topic || '').toLowerCase();
      const activeTopic = (ctx.currentChatTopic || '').toLowerCase();

      const isTopicRelevant = activeTopic.length > 0 && targetEntity.length > 0 && activeTopic.includes(targetEntity);

      if (isTopicRelevant) {
        return this.buildDecision(
          userId,
          attention,
          'NOW',
          'PROACTIVE_ELIGIBLE',
          'HIGH_CONFIDENCE',
          sourceClass,
          'RELEVANT_CONVERSATION',
          ctx,
          expiresAt,
          'Attention item is directly relevant to the user active chat topic.'
        );
      }

      return this.buildDecision(
        userId,
        attention,
        'SOON',
        'DEFER',
        'HIGH_CONFIDENCE',
        sourceClass,
        'ACTIVE_CONVERSATION',
        ctx,
        expiresAt,
        'User is in an active conversation on another topic; deferring to avoid derailment.'
      );
    }

    // ── GATE 13: CONVERSATIONAL LULL / READY WINDOW (Default NOW) ───────────
    if (attention.attentionClass === 'URGENT' || attention.attentionClass === 'ACTIONABLE') {
      return this.buildDecision(
        userId,
        attention,
        'NOW',
        'PROACTIVE_ELIGIBLE',
        'HIGH_CONFIDENCE',
        sourceClass,
        'READY_NOW',
        ctx,
        expiresAt,
        'Timing criteria met: receptive user, clear window, actionable priority.'
      );
    }

    // Default Fallback
    return this.buildDecision(
      userId,
      attention,
      'SOON',
      'DEFER',
      'HIGH_CONFIDENCE',
      sourceClass,
      'LOW_PRIORITY',
      ctx,
      expiresAt,
      'Item has moderate attention; awaiting optimal conversational opportunity.'
    );
  }

  /**
   * Persists a timing decision record into watchtower_timing_logs (Bounded Observability).
   */
  async persistTimingDecision(decision: WatchtowerTimingDecision): Promise<boolean> {
    try {
      const { error } = await qt.track(
        'watchtower_persist_timing_log',
        'watchtower_timing_logs',
        () =>
          supabaseAdmin
            .from('watchtower_timing_logs')
            .upsert(
              {
                user_id: decision.userId,
                attention_decision_id: decision.attentionDecisionId,
                timing_state: decision.timingState,
                outreach_eligibility: decision.outreachEligibility,
                confidence: decision.confidence,
                source_class: decision.sourceClass,
                burden_count_24h: decision.burdenCount24h,
                reason_code: decision.reasonCode,
                rejection_reason: decision.rejectionReason,
                defer_until: decision.deferUntil,
                context_snapshot: decision.contextSnapshot,
                fingerprint: decision.fingerprint,
                expires_at: decision.expiresAt,
              },
              { onConflict: 'user_id, fingerprint' }
            )
      );

      if (error) {
        logger.warn('[ContextualTimingEngine] Non-fatal error persisting timing log', { error: error.message });
        return false;
      }

      return true;
    } catch (err: any) {
      logger.warn('[ContextualTimingEngine] Non-fatal exception persisting timing log', { error: err?.message });
      return false;
    }
  }

  // ── HELPER UTILITIES ───────────────────────────────────────────────────────

  private classifyOutreachSource(targetType: string, _evidence?: any): OutreachSourceClass {
    switch (targetType) {
      case 'reminder':
        return 'USER_REQUESTED';
      case 'cognitive_doubt':
        return 'COGNITIVE_CLARIFICATION';
      case 'guardian_signal':
        return 'SYSTEM_REQUIRED';
      case 'life_thread':
      default:
        return 'AUTONOMOUS_PROACTIVE';
    }
  }

  private buildDecision(
    userId: string,
    attention: WatchtowerAttentionDecision,
    timingState: TimingState,
    outreachEligibility: OutreachEligibility,
    confidence: TimingConfidence,
    sourceClass: OutreachSourceClass,
    reasonCode: TimingReasonCode,
    ctx: TimingContext,
    expiresAt: string,
    rejectionReason?: string,
    deferUntil?: string | null
  ): WatchtowerTimingDecision {
    const attentionId = attention.id || attention.fingerprint || 'att_default';
    const contextHash = `${ctx.isQuietHours ? 'quiet' : 'awake'}_${ctx.isUserInActiveTurn ? 'active' : 'idle'}_${ctx.presenceStatus}`;
    const fingerprint = generateTimingFingerprint(userId, attentionId, sourceClass, timingState, contextHash);

    return {
      userId,
      attentionDecisionId: attention.id || null,
      timingState,
      outreachEligibility,
      confidence,
      sourceClass,
      burdenCount24h: ctx.touchesLast24Hours,
      reasonCode,
      rejectionReason: rejectionReason || null,
      deferUntil: deferUntil || null,
      contextSnapshot: {
        localHour: ctx.localHour,
        presenceStatus: ctx.presenceStatus,
        isUserInActiveTurn: ctx.isUserInActiveTurn,
        gapMinutes: ctx.gapMinutesSinceLastMessage,
        touches24h: ctx.touchesLast24Hours,
        touches1h: ctx.touchesLast1Hour,
      },
      fingerprint,
      expiresAt,
    };
  }

  /**
   * Validates if a timezone string is a recognized, valid IANA or standard timezone.
   * Returns false for missing, malformed, non-string, or invalid timezone identifiers.
   */
  isValidTimezone(tz: string | null | undefined): boolean {
    if (!tz || typeof tz !== 'string') return false;
    const trimmed = tz.trim();
    if (!trimmed) return false;
    const lower = trimmed.toLowerCase();
    if (lower === 'null' || lower === 'undefined' || lower === 'none' || lower === 'invalid') return false;
    try {
      Intl.DateTimeFormat(undefined, { timeZone: trimmed });
      return true;
    } catch {
      return false;
    }
  }

  private deriveLocalDateTime(utcDate: Date, timezone: string): Date {
    if (!this.isValidTimezone(timezone)) return utcDate;
    try {
      const options: Intl.DateTimeFormatOptions = {
        timeZone: timezone.trim(),
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        second: 'numeric',
        hour12: false,
      };
      const formatter = new Intl.DateTimeFormat('en-US', options);
      const parts = formatter.formatToParts(utcDate);

      const map: Record<string, number> = {};
      for (const p of parts) {
        if (p.type !== 'literal') {
          map[p.type] = parseInt(p.value, 10);
        }
      }

      return new Date(map.year, map.month - 1, map.day, map.hour, map.minute, map.second);
    } catch {
      return utcDate;
    }
  }

  private async fetchActiveAttentionDecisions(userId: string): Promise<WatchtowerAttentionDecision[]> {
    try {
      const now = new Date().toISOString();
      const { data, error } = await qt.track(
        'timing_fetch_attention_decisions',
        'watchtower_attention_decisions',
        () =>
          supabaseAdmin
            .from('watchtower_attention_decisions')
            .select('*')
            .eq('user_id', userId)
            .in('status', ['READY', 'WATCHING', 'DEFERRED', 'PENDING'])
            .gt('expires_at', now)
            .limit(10)
      );

      if (error || !data) return [];
      return data.map((r: any) => ({
        id: r.id,
        userId: r.userId || r.user_id,
        targetType: r.targetType || r.target_type,
        targetId: r.targetId || r.target_id,
        attentionClass: r.attentionClass || r.attention_class,
        status: r.status,
        scores: r.scores || {
          importance: r.importance || 0,
          urgency: r.urgency || 0,
          goalRelevance: r.goal_relevance || 0,
          deadlineProximity: r.deadline_proximity || 0,
          novelty: r.novelty || 0,
          confidence: r.confidence || 0,
          recency: r.recency || 0,
          alreadyHandledPenalty: r.already_handled_penalty || 0,
          interruptionCost: r.interruption_cost || 0,
          compositeScore: r.composite_score || 0,
        },
        evidence: r.evidence || {},
        reason: r.reason,
        recommendedAction: r.recommendedAction || r.recommended_action,
        deferUntil: r.deferUntil || r.defer_until,
        fingerprint: r.fingerprint,
        createdAt: r.createdAt || r.created_at,
        updatedAt: r.updatedAt || r.updated_at,
        expiresAt: r.expiresAt || r.expires_at,
      })) as WatchtowerAttentionDecision[];
    } catch (err: any) {
      logger.warn('[ContextualTimingEngine] Error fetching attention decisions', { userId, error: err?.message });
      return [];
    }
  }
}

export const contextualTimingEngine = new ContextualTimingEngine();
