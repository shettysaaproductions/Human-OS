/**
 * WatchtowerAttentionEngine.ts — Phase 3B Watchtower Attention & Priority Engine
 *
 * ARCHITECTURAL INVARIANTS:
 * 1. DECIDES "WHAT DESERVES NOVA'S ATTENTION NOW?": Bounded priority and actionability.
 * 2. SEPARATION OF IMPORTANCE VS URGENCY: Never collapses distinct dimensions into one scalar.
 * 3. DETERMINISTIC FIRST: Priority scoring is rule-based; 0 LLM calls for healthy users.
 * 4. STRUCTURED ATTENTION CLASSES: IGNORE, WATCH, ATTENTION, ACTIONABLE, URGENT.
 * 5. NO DIRECT USER MESSAGING: Dispatches zero messages; informs ProactiveGate/NACE only.
 * 6. NO DESTRUCTIVE RETENTION: 0 memory deletions, 0 source deletions.
 * 7. USER FAIRNESS & BOUNDS: Max 10 decisions, max 3 actionable, max 1 urgent per user.
 */

import crypto from 'crypto';
import { supabaseAdmin } from '../lib/supabase';
import { logger } from '../lib/logger';
import { qt } from '../lib/queryTracker';
import {
  AttentionClass,
  AttentionStatus,
  AttentionTargetType,
  AttentionScoreComponents,
  WatchtowerAttentionDecision,
  AttentionEvaluationContext,
  AttentionEngineSummary,
  WATCHTOWER_ATTENTION_LIMITS,
} from '../types/watchtowerAttention';
import { WatchtowerCognitiveSignal } from '../types/watchtowerHeartbeat';

/**
 * Computes deterministic SHA-256 fingerprint for attention decisions.
 */
export function generateAttentionFingerprint(
  userId: string,
  targetType: string,
  targetId: string,
  evidenceHash: string,
  contextHash: string
): string {
  const normUser = (userId || '').trim().toLowerCase();
  const normType = (targetType || '').trim().toLowerCase();
  const normId = (targetId || '').trim().toLowerCase();
  const payload = `${normUser}|${normType}|${normId}|${evidenceHash}|${contextHash}`;
  return crypto.createHash('sha256').update(payload).digest('hex');
}

export class WatchtowerAttentionEngine {
  /**
   * Evaluates attention and priority for all active candidate signals of a user.
   */
  async evaluateUserAttention(
    userId: string,
    context?: AttentionEvaluationContext
  ): Promise<AttentionEngineSummary> {
    const startedAt = Date.now();
    const summary: AttentionEngineSummary = {
      userId,
      totalEvaluated: 0,
      decisionsCreated: 0,
      decisionsUpdated: 0,
      decisionsExpired: 0,
      urgentCount: 0,
      actionableCount: 0,
      watchCount: 0,
      attentionCount: 0,
      ignoreCount: 0,
      llmCalls: 0,
      durationMs: 0,
    };

    if (!userId) return summary;

    try {
      // 1. Fetch User Context and Active Signals
      const [activeSignals, activeDoubts, activeThreads, activeReminders] = await Promise.all([
        this.fetchActiveSignals(userId),
        this.fetchActiveDoubts(userId),
        this.fetchActiveLifeThreads(userId),
        this.fetchActiveReminders(userId),
      ]);

      const goalTopics = new Set(activeThreads.map(t => (t.topic || t.canonical_key || '').toLowerCase().trim()));
      const rawCandidates: Array<{
        targetType: AttentionTargetType;
        targetId: string;
        sourceData: Record<string, any>;
      }> = [];

      // A. Cognitive Signals
      for (const sig of activeSignals) {
        rawCandidates.push({
          targetType: 'guardian_signal',
          targetId: sig.id || sig.fingerprint || `sig_${sig.category}_${sig.entity}`,
          sourceData: sig,
        });
      }

      // B. Cognitive Doubts (Phase 2F-C)
      for (const d of activeDoubts) {
        rawCandidates.push({
          targetType: 'cognitive_doubt',
          targetId: d.id,
          sourceData: d,
        });
      }

      // C. Active LifeThreads / Goals
      for (const t of activeThreads) {
        rawCandidates.push({
          targetType: 'life_thread',
          targetId: t.id,
          sourceData: t,
        });
      }

      // D. Active Reminders
      for (const r of activeReminders) {
        rawCandidates.push({
          targetType: 'reminder',
          targetId: r.id,
          sourceData: r,
        });
      }

      summary.totalEvaluated = rawCandidates.length;

      // 2. Score and Classify Candidates Deterministically
      const decisions: WatchtowerAttentionDecision[] = [];

      for (const cand of rawCandidates) {
        const scores = this.computeDeterministicScores(cand.targetType, cand.sourceData, goalTopics, context);
        const classification = this.classifyAttention(cand.targetType, scores, cand.sourceData, context);

        const evidenceObj = {
          targetType: cand.targetType,
          targetId: cand.targetId,
          data: cand.sourceData,
          scores,
        };

        const evidenceHash = crypto
          .createHash('sha256')
          .update(JSON.stringify(evidenceObj))
          .digest('hex');

        const contextHash = context?.isUserInActiveConversation ? 'active_chat' : 'idle';
        const fingerprint = generateAttentionFingerprint(userId, cand.targetType, cand.targetId, evidenceHash, contextHash);

        const ttlHours = WATCHTOWER_ATTENTION_LIMITS.ATTENTION_DEFAULT_TTL_HOURS;
        const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000).toISOString();

        decisions.push({
          userId,
          targetType: cand.targetType,
          targetId: cand.targetId,
          attentionClass: classification.attentionClass,
          status: classification.status,
          scores,
          evidence: evidenceObj,
          reason: classification.reason,
          recommendedAction: classification.recommendedAction,
          deferUntil: classification.deferUntil,
          fingerprint,
          expiresAt,
        });
      }

      // 3. Enforce User Attention Fairness and Limits
      const rankedDecisions = this.rankAndCapDecisions(decisions);

      // 4. Persist Decisions to DB
      for (const dec of rankedDecisions) {
        const res = await this.upsertAttentionDecision(dec);
        if (res === 'created') summary.decisionsCreated += 1;
        if (res === 'updated') summary.decisionsUpdated += 1;

        if (dec.attentionClass === 'URGENT') summary.urgentCount += 1;
        if (dec.attentionClass === 'ACTIONABLE') summary.actionableCount += 1;
        if (dec.attentionClass === 'ATTENTION') summary.attentionCount += 1;
        if (dec.attentionClass === 'WATCH') summary.watchCount += 1;
        if (dec.attentionClass === 'IGNORE') summary.ignoreCount += 1;
      }

      // 5. Clean Expired Attention Records
      summary.decisionsExpired = await this.expireStaleAttentionDecisions(userId);
      summary.durationMs = Date.now() - startedAt;

      logger.info('[WatchtowerAttention] Evaluated user attention', {
        userId,
        evaluated: summary.totalEvaluated,
        urgent: summary.urgentCount,
        actionable: summary.actionableCount,
        watch: summary.watchCount,
        durationMs: summary.durationMs,
      });

      return summary;
    } catch (err: any) {
      logger.error('[WatchtowerAttention] Error evaluating attention for user', { userId, error: err?.message });
      summary.durationMs = Date.now() - startedAt;
      return summary;
    }
  }

  /**
   * Computes deterministic priority scores across all 9 components.
   */
  computeDeterministicScores(
    targetType: AttentionTargetType,
    data: Record<string, any>,
    goalTopics: Set<string>,
    context?: AttentionEvaluationContext
  ): AttentionScoreComponents {
    let importance = 30;
    let urgency = 10;
    let goalRelevance = 10;
    let deadlineProximity = 0;
    let novelty = 70;
    let confidence = 80;
    let recency = 60;
    let alreadyHandledPenalty = 0;
    let interruptionCost = 20;

    const now = Date.now();

    // ── 1. Target Type Specific Scoring ──────────────────────────────────────
    if (targetType === 'reminder') {
      const normUrgency = (data.urgency || '').toLowerCase();
      importance = normUrgency === 'high' ? 85 : normUrgency === 'medium' ? 65 : 45;
      if (data.trigger_at) {
        const triggerMs = new Date(data.trigger_at).getTime();
        const diffHours = (triggerMs - now) / (1000 * 60 * 60);

        if (diffHours < 0 && diffHours > -24) {
          // Triggered recently (<24h overdue)
          urgency = 90;
          deadlineProximity = 95;
        } else if (diffHours >= 0 && diffHours <= 24) {
          // Due in next 24h
          urgency = 85;
          deadlineProximity = 90;
        } else if (diffHours > 24 && diffHours <= 72) {
          // Due in 2–3 days
          urgency = 60;
          deadlineProximity = 65;
        } else if (diffHours > 72 && diffHours <= 168) {
          // Due in 1 week
          urgency = 35;
          deadlineProximity = 40;
        } else {
          // Future / distant
          urgency = 15;
          deadlineProximity = 15;
        }
      }

      // Check handled status
      const normStatus = (data.status || '').toLowerCase();
      if (normStatus === 'completed' || normStatus === 'cancelled') {
        alreadyHandledPenalty = 95;
      }
    } else if (targetType === 'life_thread') {
      const normPri = (data.priority || '').toUpperCase();
      importance = normPri === 'HIGH' ? 85 : normPri === 'MEDIUM' ? 65 : 40;
      goalRelevance = 85; // LifeThreads represent user's strategic goals directly
      urgency = (data.state || '').toLowerCase() === 'active' ? 50 : 20;

      const deadlineVal = data.next_relevant_time || data.deadline;
      if (deadlineVal) {
        const deadlineMs = new Date(deadlineVal).getTime();
        const diffDays = (deadlineMs - now) / (1000 * 60 * 60 * 24);
        if (diffDays <= 2 && diffDays >= 0) {
          urgency = 85;
          deadlineProximity = 90;
        } else if (diffDays > 2 && diffDays <= 7) {
          urgency = 60;
          deadlineProximity = 60;
        } else if (diffDays > 7 && diffDays <= 30) {
          urgency = 35;
          deadlineProximity = 35;
        } else {
          urgency = 15;
          deadlineProximity = 10;
        }
      }

      if (data.state === 'completed' || data.state === 'archived') {
        alreadyHandledPenalty = 90;
      }
    } else if (targetType === 'cognitive_doubt') {
      importance = data.urgency === 'high' ? 75 : 60;
      urgency = data.priority === 'NEXT' ? 65 : 30;
      confidence = Math.round((data.confidence || 0.8) * 100);

      // Check doubt cooldown and lifetime presentation bounds
      const presentationCount = data.presentation_count || 0;
      if (presentationCount >= 3 || data.status === 'resolved' || data.status === 'dismissed') {
        alreadyHandledPenalty = 90;
      }
    } else if (targetType === 'guardian_signal') {
      // Internal system integrity signals
      if (data.severity === 'critical') importance = 75;
      else if (data.severity === 'high') importance = 60;
      else if (data.severity === 'medium') importance = 45;
      else importance = 25;

      // Internal technical issues have low direct user-facing urgency
      urgency = data.category === 'repair_required' ? 50 : 20;
      confidence = 90;

      if (data.status === 'resolved' || data.status === 'consumed') {
        alreadyHandledPenalty = 95;
      }
    } else if (targetType === 'memory_change') {
      importance = data.lifecycle_state === 'CURRENT' ? 65 : 30;
      urgency = 20;
      if (data.lifecycle_state === 'SUPERSEDED' || data.lifecycle_state === 'INVALIDATED') {
        alreadyHandledPenalty = 90;
      }
    }

    // ── 2. Goal Relevance Matching ───────────────────────────────────────────
    const itemText = (data.title || data.text || data.topic || data.entity || '').toLowerCase();
    for (const goal of goalTopics) {
      if (goal && itemText.includes(goal)) {
        goalRelevance = Math.max(goalRelevance, 80);
        break;
      }
    }

    // ── 3. Interruption Cost Context ─────────────────────────────────────────
    if (context?.isUserInActiveConversation) {
      interruptionCost = 75; // Higher cost to interrupt active conversation with unrelated topics
    }
    if (context?.lastOutreachMinutesAgo && context.lastOutreachMinutesAgo < 60) {
      interruptionCost = Math.max(interruptionCost, 70); // Recent outreach cooldown
    }

    // ── 4. Composite Score Normalization (0–100) ─────────────────────────────
    // Weighted formula:
    // 35% Importance + 25% Urgency + 20% GoalRelevance + 10% Deadline + 10% Confidence - Penalty
    let rawScore =
      importance * 0.35 +
      urgency * 0.25 +
      goalRelevance * 0.20 +
      deadlineProximity * 0.10 +
      confidence * 0.10;

    if (alreadyHandledPenalty > 0) {
      rawScore -= alreadyHandledPenalty * 0.8;
    }

    const compositeScore = Math.max(0, Math.min(100, Math.round(rawScore)));

    return {
      importance,
      urgency,
      goalRelevance,
      deadlineProximity,
      novelty,
      confidence,
      recency,
      alreadyHandledPenalty,
      interruptionCost,
      compositeScore,
    };
  }

  /**
   * Classifies an item into an AttentionClass and AttentionStatus.
   */
  classifyAttention(
    targetType: AttentionTargetType,
    scores: AttentionScoreComponents,
    data: Record<string, any>,
    _context?: AttentionEvaluationContext
  ): {
    attentionClass: AttentionClass;
    status: AttentionStatus;
    reason: string;
    recommendedAction?: string;
    deferUntil?: string | null;
  } {
    // 1. Handled or Penalized -> IGNORE / ACTED
    if (scores.alreadyHandledPenalty >= 80 || scores.compositeScore < 25) {
      return {
        attentionClass: 'IGNORE',
        status: scores.alreadyHandledPenalty >= 80 ? 'ACTED' : 'DISMISSED',
        reason: 'Item is already handled, resolved, or has low composite score.',
      };
    }

    // 2. High Interruption Cost -> DEFERRED (Important but unsuitable timing)
    if (scores.interruptionCost >= 70 && scores.importance >= 60 && scores.urgency < 80) {
      const deferHours = WATCHTOWER_ATTENTION_LIMITS.DEFERRED_COOLDOWN_HOURS;
      const deferUntil = new Date(Date.now() + deferHours * 60 * 60 * 1000).toISOString();
      return {
        attentionClass: 'WATCH',
        status: 'DEFERRED',
        reason: 'High importance item deferred due to active user conversation or recent outreach.',
        deferUntil,
      };
    }

    // 3. High Importance + High Urgency -> URGENT
    if (scores.importance >= 70 && scores.urgency >= 70) {
      return {
        attentionClass: 'URGENT',
        status: 'READY',
        reason: 'Time-critical item with high user importance and immediate deadline proximity.',
        recommendedAction: this.deriveRecommendedAction(targetType, data),
      };
    }

    // 4. High Importance + Low Urgency (e.g. Birthday in 6 months, distant goal) -> WATCH
    if (scores.importance >= 50 && scores.urgency <= 30 && targetType !== 'guardian_signal') {
      return {
        attentionClass: 'WATCH',
        status: 'WATCHING',
        reason: 'High strategic importance but low time urgency; keep in supervisory awareness.',
      };
    }

    // 5. Actionable Task / Goal / Reminder -> ACTIONABLE
    if (
      (scores.importance >= 55 && scores.urgency >= 40) ||
      (scores.importance >= 55 && scores.goalRelevance >= 60 && scores.urgency >= 35)
    ) {
      return {
        attentionClass: 'ACTIONABLE',
        status: 'READY',
        reason: 'Concrete actionable next step aligned with active goals or impending deadline.',
        recommendedAction: this.deriveRecommendedAction(targetType, data),
      };
    }

    // 6. Moderate Importance / System Integrity -> ATTENTION
    if (scores.importance >= 45) {
      return {
        attentionClass: 'ATTENTION',
        status: 'WATCHING',
        reason: 'Item warrants supervisory attention when opportune window arises.',
        recommendedAction: this.deriveRecommendedAction(targetType, data),
      };
    }

    // Default -> IGNORE
    return {
      attentionClass: 'IGNORE',
      status: 'DISMISSED',
      reason: 'Low priority / non-actionable background signal.',
    };
  }

  /**
   * Ranks decisions by composite score and enforces user fairness caps.
   */
  private rankAndCapDecisions(decisions: WatchtowerAttentionDecision[]): WatchtowerAttentionDecision[] {
    // Sort descending by composite score, then importance, then urgency
    const sorted = [...decisions].sort((a, b) => {
      if (b.scores.compositeScore !== a.scores.compositeScore) {
        return b.scores.compositeScore - a.scores.compositeScore;
      }
      if (b.scores.importance !== a.scores.importance) {
        return b.scores.importance - a.scores.importance;
      }
      return b.scores.urgency - a.scores.urgency;
    });

    let urgentCount = 0;
    let actionableCount = 0;
    const capped: WatchtowerAttentionDecision[] = [];

    for (const d of sorted) {
      if (capped.length >= WATCHTOWER_ATTENTION_LIMITS.MAX_ATTENTION_DECISIONS_PER_USER) {
        break;
      }

      // Enforce max urgent cap (1 per user)
      if (d.attentionClass === 'URGENT') {
        if (urgentCount >= WATCHTOWER_ATTENTION_LIMITS.MAX_URGENT_PER_USER) {
          d.attentionClass = 'ACTIONABLE'; // Demote surplus urgent
        } else {
          urgentCount += 1;
        }
      }

      // Enforce max actionable cap (3 per user)
      if (d.attentionClass === 'ACTIONABLE') {
        if (actionableCount >= WATCHTOWER_ATTENTION_LIMITS.MAX_ACTIONABLE_PER_USER) {
          d.attentionClass = 'ATTENTION'; // Demote surplus actionable
        } else {
          actionableCount += 1;
        }
      }

      capped.push(d);
    }

    return capped;
  }

  /**
   * Upserts attention decision into database.
   */
  private async upsertAttentionDecision(
    decision: WatchtowerAttentionDecision
  ): Promise<'created' | 'updated' | 'error'> {
    try {
      const { data, error } = await qt.track(
        'watchtower_upsert_attention',
        'watchtower_attention_decisions',
        () =>
          supabaseAdmin
            .from('watchtower_attention_decisions')
            .upsert(
              {
                user_id: decision.userId,
                target_type: decision.targetType,
                target_id: decision.targetId,
                attention_class: decision.attentionClass,
                status: decision.status,
                importance: decision.scores.importance,
                urgency: decision.scores.urgency,
                goal_relevance: decision.scores.goalRelevance,
                deadline_proximity: decision.scores.deadlineProximity,
                novelty: decision.scores.novelty,
                confidence: decision.scores.confidence,
                recency: decision.scores.recency,
                already_handled_penalty: decision.scores.alreadyHandledPenalty,
                interruption_cost: decision.scores.interruptionCost,
                composite_score: decision.scores.compositeScore,
                evidence: decision.evidence,
                reason: decision.reason,
                recommended_action: decision.recommendedAction,
                defer_until: decision.deferUntil,
                fingerprint: decision.fingerprint,
                updated_at: new Date().toISOString(),
                expires_at: decision.expiresAt,
              },
              { onConflict: 'user_id, fingerprint' }
            )
            .select('id')
      );

      if (error) {
        logger.warn('[WatchtowerAttention] Error upserting decision', { error: error.message });
        return 'error';
      }

      return (data || []).length > 0 ? 'created' : 'updated';
    } catch (err: any) {
      logger.error('[WatchtowerAttention] Exception upserting decision', { error: err?.message });
      return 'error';
    }
  }

  /**
   * Fetches active, actionable attention decisions for Nova/ProactiveGate awareness.
   */
  async getActionableAttention(userId: string): Promise<WatchtowerAttentionDecision[]> {
    if (!userId) return [];

    try {
      const now = new Date().toISOString();
      const { data, error } = await qt.track(
        'watchtower_get_actionable_attention',
        'watchtower_attention_decisions',
        () =>
          supabaseAdmin
            .from('watchtower_attention_decisions')
            .select('*')
            .eq('user_id', userId)
            .in('status', ['READY', 'WATCHING'])
            .in('attention_class', ['URGENT', 'ACTIONABLE', 'ATTENTION'])
            .gt('expires_at', now)
            .order('composite_score', { ascending: false })
            .limit(5)
      );

      if (error || !data) return [];
      return data as WatchtowerAttentionDecision[];
    } catch (err: any) {
      logger.warn('[WatchtowerAttention] Error fetching actionable attention', { userId, error: err?.message });
      return [];
    }
  }

  /**
   * Expires stale or completed attention decisions.
   */
  private async expireStaleAttentionDecisions(userId: string): Promise<number> {
    try {
      const now = new Date().toISOString();
      const { data, error } = await qt.track(
        'watchtower_expire_attention',
        'watchtower_attention_decisions',
        () =>
          supabaseAdmin
            .from('watchtower_attention_decisions')
            .update({ status: 'EXPIRED' })
            .eq('user_id', userId)
            .in('status', ['READY', 'WATCHING', 'DEFERRED'])
            .lte('expires_at', now)
            .select('id')
      );

      if (error || !data) return 0;
      return data.length;
    } catch (err: any) {
      logger.warn('[WatchtowerAttention] Error expiring attention decisions', { userId, error: err?.message });
      return 0;
    }
  }

  // ── HELPER DATA FETCHERS ───────────────────────────────────────────────────

  private async fetchActiveSignals(userId: string): Promise<WatchtowerCognitiveSignal[]> {
    const now = new Date().toISOString();
    const { data } = await qt.track('watchtower_fetch_signals_for_att', 'watchtower_cognitive_signals', () =>
      supabaseAdmin
        .from('watchtower_cognitive_signals')
        .select('*')
        .eq('user_id', userId)
        .eq('status', 'active')
        .gt('expires_at', now)
        .limit(10)
    );
    return (data || []) as WatchtowerCognitiveSignal[];
  }

  private async fetchActiveDoubts(userId: string): Promise<any[]> {
    const { data } = await qt.track('watchtower_fetch_doubts_for_att', 'nova_cognitive_doubts', () =>
      supabaseAdmin
        .from('nova_cognitive_doubts')
        .select('*')
        .eq('user_id', userId)
        .in('status', ['open', 'waiting_for_user'])
        .limit(5)
    );
    return data || [];
  }

  private async fetchActiveLifeThreads(userId: string): Promise<any[]> {
    const { data } = await qt.track('watchtower_fetch_threads_for_att', 'life_threads', () =>
      supabaseAdmin
        .from('life_threads')
        .select('*')
        .eq('user_id', userId)
        .in('state', ['active', 'in_progress', 'completed'])
        .limit(10)
    );
    return data || [];
  }

  private async fetchActiveReminders(userId: string): Promise<any[]> {
    const { data } = await qt.track('watchtower_fetch_reminders_for_att', 'reminders', () =>
      supabaseAdmin
        .from('reminders')
        .select('*')
        .eq('user_id', userId)
        .in('status', ['active', 'pending', 'completed'])
        .limit(10)
    );
    return data || [];
  }

  private deriveRecommendedAction(targetType: AttentionTargetType, data: Record<string, any>): string {
    switch (targetType) {
      case 'reminder':
        return `Prepare reminder follow-up: "${data.text || data.title || 'Reminder'}"`;
      case 'life_thread':
        return `Review goal milestone progress for thread "${data.topic || data.canonical_key}"`;
      case 'cognitive_doubt':
        return `Propose clarification question when opportunity arises: "${data.question}"`;
      case 'guardian_signal':
        return `Monitor internal integrity signal: ${data.signal_type}`;
      default:
        return 'Maintain supervisory awareness';
    }
  }
}

export const watchtowerAttentionEngine = new WatchtowerAttentionEngine();
