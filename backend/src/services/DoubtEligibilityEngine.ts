/**
 * DoubtEligibilityEngine.ts — Deterministic Clarification Eligibility Engine (Phase 2F-C)
 *
 * Rules:
 * 1. Single-doubt-per-turn limit (Max 1 doubt injected per turn).
 * 2. User burden cap (Max 3 open doubts considered).
 * 3. Topical relevance: Matches canonical entity keys / concepts against current turn.
 * 4. Conversational opportunity: Avoids distress, closed-ended turns, or topic disruption.
 * 5. Presentation cooldown & loop protection (presentation_count < 3, lifetime < 9).
 * 6. Zero LLM calls — 100% deterministic evaluation.
 */

import { CognitiveDoubtRecord, DoubtEligibilityContext, DoubtEligibilityDecision } from '../types/cognitiveDoubt';
import { cognitiveDoubtService, DOUBT_LIMITS } from './CognitiveDoubtService';
import { logger } from '../lib/logger';

export class DoubtEligibilityEngine {
  /**
   * Evaluates all open doubts for a user and selects at most ONE eligible doubt for the current turn.
   */
  async evaluateEligibility(ctx: DoubtEligibilityContext): Promise<DoubtEligibilityDecision> {
    try {
      // 1. Guard against conversational distress
      if (ctx.isDistressed) {
        return { eligible: false, reason: 'Suppressed: User is experiencing emotional distress' };
      }

      // 2. Guard against terse / close-ended acknowledgments (e.g. "ok", "haan", "theek hai")
      if (ctx.isCloseEnded) {
        return { eligible: false, reason: 'Suppressed: User message is close-ended or phatic' };
      }

      // 3. Fetch open doubts
      const openDoubts = await cognitiveDoubtService.getOpenDoubts(ctx.userId);
      if (!openDoubts || openDoubts.length === 0) {
        return { eligible: false, reason: 'No active open doubts' };
      }

      // 4. User burden cap: If more than 3 open doubts exist, only consider top priority
      const candidateDoubts = openDoubts.slice(0, 3);

      // 5. Evaluate candidates by Priority & Topical Relevance
      // Sort order: NOW > NEXT > LATER > BACKGROUND, then presentation_count ascending
      const priorityWeights: Record<string, number> = {
        NOW: 4,
        NEXT: 3,
        LATER: 2,
        BACKGROUND: 1,
      };

      const sorted = [...candidateDoubts].sort((a, b) => {
        const pDiff = (priorityWeights[b.priority] || 1) - (priorityWeights[a.priority] || 1);
        if (pDiff !== 0) return pDiff;
        return a.presentation_count - b.presentation_count;
      });

      const messageLower = ctx.currentMessageText.toLowerCase();

      for (const doubt of sorted) {
        // Presentation loop prevention (per-version and lifetime limits)
        const lifetimeCount = Number(doubt.evidence?.lifetime_presentation_count ?? doubt.presentation_count ?? 0);
        if (
          doubt.presentation_count >= DOUBT_LIMITS.MAX_CLARIFICATION_ATTEMPTS ||
          lifetimeCount >= DOUBT_LIMITS.MAX_LIFETIME_CLARIFICATION_ATTEMPTS ||
          doubt.status === 'waiting_for_user' ||
          doubt.status === 'human_review' ||
          doubt.status === 'resolved' ||
          doubt.status === 'dismissed'
        ) {
          continue;
        }

        const isRelevant = this.checkTopicalRelevance(doubt, messageLower, ctx);
        if (isRelevant) {
          const supervisoryDirective = this.buildSupervisoryDirective(doubt);
          return {
            eligible: true,
            doubt,
            reason: `Topically relevant (${doubt.category}) with priority ${doubt.priority}`,
            supervisoryDirective,
          };
        }
      }

      return { eligible: false, reason: 'No doubts topically relevant to current conversation' };
    } catch (err: any) {
      logger.debug('[DoubtEligibilityEngine] Evaluation failure (safe default = false)', { error: err?.message });
      return { eligible: false, reason: `Evaluation error: ${err?.message}` };
    }
  }

  /**
   * Deterministic Topical Relevance Matching
   */
  private checkTopicalRelevance(
    doubt: CognitiveDoubtRecord,
    messageText: string,
    ctx: DoubtEligibilityContext
  ): boolean {
    // 1. Family Identity Gap Relevance
    if (doubt.category === 'identity_gap') {
      const familyKeywords = [
        'family', 'ghar', 'parents', 'bhai', 'behen', 'brother', 'sister',
        'mother', 'father', 'mummy', 'papa', 'wife', 'husband', 'son', 'daughter',
        'bacche', 'relatives', 'members', 'home', 'parivaar'
      ];
      const hasFamilyTopic = familyKeywords.some(kw => messageText.includes(kw));
      if (hasFamilyTopic) return true;
    }

    // 2. Project / Goal Intent Ambiguity Relevance
    if (doubt.category === 'intent_uncertainty') {
      const projectKeywords = ['project', 'start', 'launch', 'kaam', 'goal', 'prep', 'interview', 'study', 'work'];
      const hasProjectTopic = projectKeywords.some(kw => messageText.includes(kw));
      if (hasProjectTopic) return true;

      // Match against active LifeThread topics
      for (const ltTopic of ctx.activeLifeThreadTopics || []) {
        if (messageText.includes(ltTopic.toLowerCase())) return true;
      }
    }

    // 3. Schedule Gap Relevance
    if (doubt.category === 'schedule_gap' || doubt.category === 'temporal_conflict') {
      const timeKeywords = ['schedule', 'kal', 'parso', 'baje', 'time', 'meeting', 'office', 'shift', 'routine'];
      if (timeKeywords.some(kw => messageText.includes(kw))) return true;
    }

    return false;
  }

  /**
   * Constructs the Supervisory Cognitive Signal for the Chat LLM.
   * Prompts strictly declare:
   * - WHAT IS UNCERTAIN
   * - WHAT EVIDENCE SUPPORTS IT
   * - WHAT IS MISSING
   * - WHAT NOVA MUST NOT ASSUME
   */
  private buildSupervisoryDirective(doubt: CognitiveDoubtRecord): string {
    const evidence = doubt.evidence || {};
    let details = '';

    if (doubt.category === 'identity_gap' && evidence.claimed_count) {
      const grounded = Object.keys(evidence.grounded_relations || {}).join(', ') || 'user only';
      details = `The user previously stated having ${evidence.claimed_count} family members, but only ${evidence.grounded_count} (${grounded}) are identified in durable memory. Exactly ${evidence.missing_count} member identity is ungrounded.`;
    } else {
      details = doubt.question;
    }

    return [
      `[SUPERVISORY COGNITIVE SIGNAL: EPISTEMIC UNCERTAINTY (${doubt.category.toUpperCase()})]`,
      `WHAT IS UNCERTAIN: ${doubt.question}`,
      `WHAT EVIDENCE SUPPORTS IT: ${details}`,
      `WHAT IS MISSING: Unresolved epistemic gap (${doubt.category})`,
      `WHAT NOVA MUST NOT ASSUME: DO NOT ASSUME OR INVENT THE MISSING ENTITY OR FACT. THIS IS UNCERTAINTY, NOT FACT.`,
      `Guidelines: If current conversational flow naturally allows it, clarify casually and warmly without forcing the question.`,
    ].join('\n');
  }
}

export const doubtEligibilityEngine = new DoubtEligibilityEngine();
