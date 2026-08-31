/**
 * WatchtowerProactiveIntegrationService.ts — Phase 3C-D Watchtower -> Timing -> ProactiveGate Integration
 *
 * ARCHITECTURAL INVARIANTS:
 * 1. WATCHTOWER != MESSAGING: Watchtower determines WHAT, WHEN, and WHETHER.
 *    Existing Nova / ProactiveGate determines HOW Nova communicates.
 * 2. PROACTIVE_ELIGIBLE ONLY: Only items cleared with outreachEligibility = PROACTIVE_ELIGIBLE reach the gate.
 * 3. ATOMIC DISPATCH: Deduplicates via ProactiveGate logical_key reservation preventing concurrent duplicates.
 * 4. UNIVERSAL BURDEN GATED: Evaluates universal burden budget before gate acquisition.
 * 5. CONVERSATION PROTECTION: Unrelated proactive items do not derail active user turns.
 * 6. ZERO DIRECT MESSAGING: 0 push dispatches, 0 FCM triggers, 0 direct chat writes in this layer.
 * 7. ZERO NEW LLM CALLS: 0 LLM calls in the timing/burden/gate integration pipeline.
 * 8. ZERO DESTRUCTIVE MUTATIONS: 0 memory deletes, 0 source deletes.
 */

import { supabaseAdmin } from '../lib/supabase';
import { logger } from '../lib/logger';
import { qt } from '../lib/queryTracker';
import { contextualTimingEngine } from './ContextualTimingEngine';
import { universalBurdenEngine } from './UniversalBurdenEngine';
import { proactiveGate } from './ProactiveGate';
import {
  TimingState,
  OutreachEligibility,
  OutreachSourceClass,
  WatchtowerTimingDecision,
} from '../types/watchtowerTiming';
import { WatchtowerAttentionDecision } from '../types/watchtowerAttention';

export interface WatchtowerHandoffRecord {
  attentionDecisionId: string;
  timingDecisionId?: string | null;
  userId: string;
  targetType: string;
  targetId?: string;
  sourceClass: OutreachSourceClass;
  timingState: TimingState;
  outreachEligibility: OutreachEligibility;
  burdenDecision: 'ALLOW' | 'DEFER' | 'SUPPRESS';
  burdenReason?: string;
  gateAllowed: boolean;
  gateBlockedBy?: string;
  outreachId?: string;
  dispatched: boolean;
  logicalKey: string;
  timestamp: string;
}

export interface WatchtowerHandoffSummary {
  userId: string;
  evaluatedDecisionsCount: number;
  eligibleDecisionsCount: number;
  burdenAllowedCount: number;
  gateAllowedCount: number;
  dispatchedOpportunitiesCount: number;
  blockedOpportunitiesCount: number;
  llmCallsAdded: number;
  handoffs: WatchtowerHandoffRecord[];
  durationMs: number;
}

export class WatchtowerProactiveIntegrationService {
  /**
   * Evaluates active attention decisions, validates contextual timing & universal burden,
   * and atomically claims eligible opportunities through ProactiveGate.
   */
  async evaluateAndDispatchProactiveOpportunities(
    userId: string,
    options?: { dryRun?: boolean }
  ): Promise<WatchtowerHandoffSummary> {
    const startedAt = Date.now();
    const summary: WatchtowerHandoffSummary = {
      userId,
      evaluatedDecisionsCount: 0,
      eligibleDecisionsCount: 0,
      burdenAllowedCount: 0,
      gateAllowedCount: 0,
      dispatchedOpportunitiesCount: 0,
      blockedOpportunitiesCount: 0,
      llmCallsAdded: 0,
      handoffs: [],
      durationMs: 0,
    };

    if (!userId) return summary;

    try {
      // 1. Fetch active attention decisions for the user
      const nowIso = new Date().toISOString();
      const { data: activeAttentions, error: attErr } = await qt.track(
        'integration_fetch_attention',
        'watchtower_attention_decisions',
        () =>
          supabaseAdmin
            .from('watchtower_attention_decisions')
            .select('*')
            .eq('user_id', userId)
            .in('status', ['READY', 'WATCHING', 'PENDING'])
            .gt('expires_at', nowIso)
            .limit(10)
      );

      if (attErr || !activeAttentions || activeAttentions.length === 0) {
        summary.durationMs = Date.now() - startedAt;
        return summary;
      }

      summary.evaluatedDecisionsCount = activeAttentions.length;

      // 2. Assemble deterministic timing context once per user run
      const timingCtx = await contextualTimingEngine.assembleTimingContext(userId);
      const burdenCtx = await universalBurdenEngine.getUserBurden(userId);

      // 3. Evaluate each active attention item
      for (const rawAtt of activeAttentions) {
        const att: WatchtowerAttentionDecision = {
          id: rawAtt.id,
          userId: rawAtt.userId || rawAtt.user_id,
          targetType: rawAtt.targetType || rawAtt.target_type,
          targetId: rawAtt.targetId || rawAtt.target_id,
          attentionClass: rawAtt.attentionClass || rawAtt.attention_class,
          status: rawAtt.status,
          scores: rawAtt.scores || {
            importance: rawAtt.importance || 0,
            urgency: rawAtt.urgency || 0,
            goalRelevance: rawAtt.goal_relevance || 0,
            deadlineProximity: rawAtt.deadline_proximity || 0,
            novelty: rawAtt.novelty || 0,
            confidence: rawAtt.confidence || 0,
            recency: rawAtt.recency || 0,
            alreadyHandledPenalty: rawAtt.already_handled_penalty || 0,
            interruptionCost: rawAtt.interruption_cost || 0,
            compositeScore: rawAtt.composite_score || 0,
          },
          evidence: rawAtt.evidence || {},
          reason: rawAtt.reason,
          recommendedAction: rawAtt.recommendedAction || rawAtt.recommended_action,
          deferUntil: rawAtt.deferUntil || rawAtt.defer_until,
          fingerprint: rawAtt.fingerprint,
          createdAt: rawAtt.createdAt || rawAtt.created_at,
          updatedAt: rawAtt.updatedAt || rawAtt.updated_at,
          expiresAt: rawAtt.expiresAt || rawAtt.expires_at,
        };

        // Internal Guardian signals NEVER become direct user messages
        if (att.targetType === 'guardian_signal') {
          continue;
        }

        // Evaluate Contextual Timing Gate
        const timingDecision: WatchtowerTimingDecision = contextualTimingEngine.evaluateTiming(
          userId,
          att,
          timingCtx
        );

        // Record timing log
        if (!options?.dryRun) {
          await contextualTimingEngine.persistTimingDecision(timingDecision);
        }

        // Only PROACTIVE_ELIGIBLE opportunities proceed to burden and gate
        if (timingDecision.outreachEligibility !== 'PROACTIVE_ELIGIBLE') {
          summary.blockedOpportunitiesCount += 1;
          summary.handoffs.push({
            attentionDecisionId: att.id || 'att_unknown',
            timingDecisionId: timingDecision.id || null,
            userId,
            targetType: att.targetType,
            targetId: att.targetId,
            sourceClass: timingDecision.sourceClass,
            timingState: timingDecision.timingState,
            outreachEligibility: timingDecision.outreachEligibility,
            burdenDecision: 'DEFER',
            burdenReason: timingDecision.reasonCode,
            gateAllowed: false,
            dispatched: false,
            logicalKey: `watchtower:${att.targetType}:${att.targetId || att.id}`,
            timestamp: new Date().toISOString(),
          });
          continue;
        }

        summary.eligibleDecisionsCount += 1;

        // Construct unique logical key for atomic deduplication
        const logicalKey = `watchtower:${att.targetType}:${att.targetId || att.fingerprint || att.id}`;
        const topic = att.evidence?.data?.topic || att.evidence?.data?.text || att.reason || att.targetType;

        // ── STEP 4: UNIVERSAL USER BURDEN EVALUATION ─────────────────────────
        const burdenDecision = await universalBurdenEngine.evaluateBurden(
          userId,
          timingDecision.sourceClass,
          {
            topic,
            logicalKey,
            targetId: att.targetId,
            isUrgent: att.attentionClass === 'URGENT',
            deadlineMinutes: att.scores?.deadlineProximity ? Math.max(0, (100 - att.scores.deadlineProximity) * 2) : null,
            deferUntil: att.deferUntil,
            status: att.status,
          },
          burdenCtx
        );

        if (burdenDecision.decision !== 'ALLOW') {
          summary.blockedOpportunitiesCount += 1;
          summary.handoffs.push({
            attentionDecisionId: att.id || 'att_unknown',
            timingDecisionId: timingDecision.id || null,
            userId,
            targetType: att.targetType,
            targetId: att.targetId,
            sourceClass: timingDecision.sourceClass,
            timingState: timingDecision.timingState,
            outreachEligibility: timingDecision.outreachEligibility,
            burdenDecision: burdenDecision.decision,
            burdenReason: burdenDecision.reasonCode,
            gateAllowed: false,
            dispatched: false,
            logicalKey,
            timestamp: new Date().toISOString(),
          });
          continue;
        }

        summary.burdenAllowedCount += 1;

        // ── STEP 5: PROACTIVE GATE ATOMIC ACQUISITION ────────────────────────
        if (options?.dryRun) {
          summary.gateAllowedCount += 1;
          summary.handoffs.push({
            attentionDecisionId: att.id || 'att_unknown',
            timingDecisionId: timingDecision.id || null,
            userId,
            targetType: att.targetType,
            targetId: att.targetId,
            sourceClass: timingDecision.sourceClass,
            timingState: timingDecision.timingState,
            outreachEligibility: timingDecision.outreachEligibility,
            burdenDecision: 'ALLOW',
            burdenReason: 'BUDGET_AVAILABLE',
            gateAllowed: true,
            dispatched: false, // Dry-run mode
            logicalKey,
            timestamp: new Date().toISOString(),
          });
          continue;
        }

        const gateRes = await proactiveGate.acquire(userId, {
          outreachType: 'proactive',
          logicalKey,
          proposedMessage: `[Watchtower ${att.targetType}: ${topic}]`,
          skipQuietHoursCheck: att.attentionClass === 'URGENT' && att.scores?.deadlineProximity ? att.scores.deadlineProximity >= 90 : false,
        });

        if (!gateRes.allowed) {
          summary.blockedOpportunitiesCount += 1;
          summary.handoffs.push({
            attentionDecisionId: att.id || 'att_unknown',
            timingDecisionId: timingDecision.id || null,
            userId,
            targetType: att.targetType,
            targetId: att.targetId,
            sourceClass: timingDecision.sourceClass,
            timingState: timingDecision.timingState,
            outreachEligibility: timingDecision.outreachEligibility,
            burdenDecision: 'ALLOW',
            gateAllowed: false,
            gateBlockedBy: gateRes.blockedBy,
            dispatched: false,
            logicalKey,
            timestamp: new Date().toISOString(),
          });
          continue;
        }

        // ── STEP 6: ATOMIC COMMIT & DISPATCH HANDOFF ─────────────────────────
        summary.gateAllowedCount += 1;
        summary.dispatchedOpportunitiesCount += 1;

        // Mark attention decision as ACTED to prevent re-evaluation
        if (att.id) {
          await qt.track('integration_mark_acted', 'watchtower_attention_decisions', () =>
            supabaseAdmin
              .from('watchtower_attention_decisions')
              .update({
                status: 'ACTED',
                updated_at: new Date().toISOString(),
              })
              .eq('id', att.id)
          );
        }

        // Commit outreach slot reservation in ProactiveGate
        await proactiveGate.commit(
          gateRes.outreachId,
          `[Watchtower Handoff]: ${att.targetType} -> ${topic}`
        );

        summary.handoffs.push({
          attentionDecisionId: att.id || 'att_unknown',
          timingDecisionId: timingDecision.id || null,
          userId,
          targetType: att.targetType,
          targetId: att.targetId,
          sourceClass: timingDecision.sourceClass,
          timingState: timingDecision.timingState,
          outreachEligibility: timingDecision.outreachEligibility,
          burdenDecision: 'ALLOW',
          gateAllowed: true,
          outreachId: gateRes.outreachId,
          dispatched: true,
          logicalKey,
          timestamp: new Date().toISOString(),
        });

        logger.info('[WatchtowerProactiveIntegration] Cleared proactive handoff opportunity', {
          userId,
          targetType: att.targetType,
          logicalKey,
          outreachId: gateRes.outreachId,
        });
      }

      summary.durationMs = Date.now() - startedAt;
      return summary;
    } catch (err: any) {
      logger.error('[WatchtowerProactiveIntegration] Error during proactive integration handoff', {
        userId,
        error: err?.message,
      });
      summary.durationMs = Date.now() - startedAt;
      return summary;
    }
  }
}

export const watchtowerProactiveIntegrationService = new WatchtowerProactiveIntegrationService();
