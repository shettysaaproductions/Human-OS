/**
 * LifeThreadCultivationEngine.ts — Phase 3D-B Deterministic LifeThread Cultivation Engine
 *
 * Architectural Invariants:
 * 1. ZERO LLM CALLS: 100% deterministic code heuristics based on grounded evidence.
 * 2. EXPLICIT USER GOAL AUTHORITY: System suggestions, reminders, and passive compliance ("okay", "theek hai")
 *    MUST NEVER create or advance committed goals.
 * 3. INACTIVITY != ABANDONMENT: >14 days inactivity transitions to STALLED_OR_UNCERTAIN or DORMANT,
 *    NEVER abandoned.
 * 4. MILESTONE COMPLETION != THREAD COMPLETION: When milestones are complete, transitions to
 *    COMPLETION_PROPOSED, requiring explicit user confirmation before COMPLETED.
 * 5. BLOCKER & WAITING EVALUATION: Active blockers shift state to WAITING_ON_EXTERNAL; expired blockers
 *    trigger automatic deterministic re-evaluation.
 * 6. REPOSITORY-ONLY MUTATIONS: All persistence routes through lifeThreadRepository.ts (Single Authoritative Writer).
 * 7. COMPUTE BOUNDS: MAX_THREADS_PROCESSED_PER_PULSE (5), MAX_CULTIVATION_EVALUATIONS_PER_USER_DAY (12).
 */

import { logger } from '../lib/logger';
import {
  LifeThreadRow,
  LifeThreadState,
  lifeThreadRepository,
} from './lifeThreadRepository';
import {
  LifeThreadCultivationStage,
  LifeThreadEvidenceProvenance,
  evaluateGoalAuthority,
  LIFETHREAD_CULTIVATION_BOUNDS,
} from '../types/lifeThreadCultivation';

export interface CultivationEvaluationContext {
  userId: string;
  now?: Date;
  activeTurnTopic?: string;
  recentEvidence?: {
    provenance: LifeThreadEvidenceProvenance;
    text?: string;
    actionTaken?: string;
    isExplicitCancellation?: boolean;
    isExplicitCompletion?: boolean;
    isExplicitResume?: boolean;
    turnId?: string;
    messageSeq?: number;
  };
}

export interface CultivationDecision {
  threadId: string;
  previousStage: LifeThreadCultivationStage;
  nextStage: LifeThreadCultivationStage;
  previousState: LifeThreadState;
  nextState: LifeThreadState;
  shouldMutate: boolean;
  reason: string;
  activeBlockersCount: number;
  completedMilestonesCount: number;
  totalMilestonesCount: number;
  evaluatedAt: string;
  nextRelevantTime?: string | null;
}

export interface UserCultivationPulseSummary {
  userId: string;
  totalActiveThreads: number;
  evaluatedCount: number;
  mutatedCount: number;
  decisions: CultivationDecision[];
  evaluatedAt: string;
}

export class LifeThreadCultivationEngine {
  /**
   * Deterministically evaluates a single LifeThread against current context and evidence.
   * Pure function logic — does not perform DB writes directly.
   */
  evaluateThread(thread: LifeThreadRow, ctx: CultivationEvaluationContext): CultivationDecision {
    const now = ctx.now || new Date();
    const nowIso = now.toISOString();
    const prevStage = thread.cultivation_stage || 'DISCOVERY';
    const prevState = thread.state || 'active';
    const evidence = ctx.recentEvidence;

    const blockers = thread.blockers || [];
    const milestones = thread.milestones || [];

    const completedMilestones = milestones.filter(m => m.completed).length;
    const totalMilestones = milestones.length;

    // Count active blockers
    const activeBlockers = blockers.filter(b => {
      if (b.resolved_at) return false;
      if (!b.waiting_until) return true;
      return new Date(b.waiting_until).getTime() > now.getTime();
    });

    let nextStage: LifeThreadCultivationStage = prevStage;
    let nextState: LifeThreadState = prevState;
    let shouldMutate = false;
    let reason = 'No state change required';
    let targetNextRelevantTime: string | null = thread.next_relevant_time || null;

    const isUserOriginated =
      thread.mutation_source === 'user_explicit' ||
      thread.provenance?.includes('CREATED by user_explicit') ||
      false;

    // ── 1. Terminal State Guard ──────────────────────────────────────────────
    if (prevState === 'completed' || prevState === 'abandoned' || prevState === 'superseded') {
      if (evidence && evidence.isExplicitResume && evidence.provenance === 'USER_EXPLICIT') {
        nextState = 'active';
        nextStage = 'IN_PROGRESS';
        shouldMutate = true;
        reason = 'User explicitly resumed terminal thread';
      } else {
        return {
          threadId: thread.id,
          previousStage: prevStage,
          nextStage: prevStage,
          previousState: prevState,
          nextState: prevState,
          shouldMutate: false,
          reason: 'Thread is in terminal state; background pulse cannot mutate without explicit user resume',
          activeBlockersCount: activeBlockers.length,
          completedMilestonesCount: completedMilestones,
          totalMilestonesCount: totalMilestones,
          evaluatedAt: nowIso,
          nextRelevantTime: thread.next_relevant_time,
        };
      }
    }

    // ── 2. Explicit Cancellation / Abandonment ──────────────────────────────
    if (
      evidence &&
      evidence.provenance === 'USER_EXPLICIT' &&
      (evidence.isExplicitCancellation || this.detectExplicitCancellationText(evidence.text))
    ) {
      nextState = 'abandoned';
      nextStage = 'DORMANT';
      shouldMutate = true;
      reason = 'User explicitly cancelled or abandoned life thread';
    }

    // ── 3. Explicit Completion vs Inferred Milestone Completion ─────────────
    else if (
      evidence &&
      evidence.provenance === 'USER_EXPLICIT' &&
      (evidence.isExplicitCompletion || this.detectExplicitCompletionText(evidence.text))
    ) {
      nextState = 'completed';
      nextStage = 'COMPLETION_PROPOSED';
      shouldMutate = true;
      reason = 'User explicitly confirmed completion of life thread';
    }

    // ── 4. Milestone Completion -> COMPLETION_PROPOSED (Not COMPLETED) ───────
    else if (
      totalMilestones > 0 &&
      completedMilestones === totalMilestones &&
      prevStage !== 'COMPLETION_PROPOSED' &&
      nextState === 'active'
    ) {
      nextStage = 'COMPLETION_PROPOSED';
      nextState = 'active'; // Remains active awaiting user confirmation
      shouldMutate = true;
      reason = 'All tracked milestones completed; transitioned to COMPLETION_PROPOSED awaiting user confirmation';
    }

    // ── 5. Active Blockers Evaluation ───────────────────────────────────────
    else if (activeBlockers.length > 0) {
      if (prevStage !== 'WAITING_ON_EXTERNAL' || prevState !== 'waiting') {
        nextStage = 'WAITING_ON_EXTERNAL';
        nextState = 'waiting';
        shouldMutate = true;
        reason = `Thread blocked by ${activeBlockers.length} active blocker(s)`;
      }

      // Compute earliest waiting deadline
      const blockerDeadlines = activeBlockers
        .map(b => (b.waiting_until ? new Date(b.waiting_until).getTime() : Infinity))
        .filter(t => t !== Infinity);

      if (blockerDeadlines.length > 0) {
        const earliest = Math.min(...blockerDeadlines);
        targetNextRelevantTime = new Date(earliest).toISOString();
      }
    }

    // ── 6. Expired Blocker Re-evaluation ────────────────────────────────────
    else if (prevStage === 'WAITING_ON_EXTERNAL' && activeBlockers.length === 0) {
      nextState = 'active';
      nextStage = totalMilestones > 0 ? 'IN_PROGRESS' : 'PLANNING';
      shouldMutate = true;
      reason = 'All blockers resolved or expired; re-evaluated to active';
    }

    // ── 7. Evidence-Driven Stage Advancement with Goal Authority ────────────
    else if (evidence) {
      const authority = evaluateGoalAuthority(evidence.provenance, isUserOriginated);

      if (authority.isPassiveCompliance || !authority.canStrengthenExistingGoal) {
        // Passive compliance ("okay", "theek hai") or system suggestion: ZERO progress
        reason = 'Passive compliance or system-generated evidence; state and commitment preserved without advance';
      } else if (evidence.provenance === 'USER_ACTION') {
        if (prevStage === 'DISCOVERY' || prevStage === 'PLANNING' || prevStage === 'STALLED_OR_UNCERTAIN') {
          nextStage = 'IN_PROGRESS';
          nextState = 'active';
          shouldMutate = true;
          reason = 'User action reported; advanced to IN_PROGRESS';
        }
      } else if (evidence.provenance === 'USER_EXPLICIT') {
        if (prevStage === 'DISCOVERY') {
          nextStage = 'PLANNING';
          nextState = 'active';
          shouldMutate = true;
          reason = 'Explicit user goal statement; advanced from DISCOVERY to PLANNING';
        } else if (prevStage === 'STALLED_OR_UNCERTAIN' || prevStage === 'DORMANT') {
          nextStage = totalMilestones > 0 ? 'IN_PROGRESS' : 'PLANNING';
          nextState = 'active';
          shouldMutate = true;
          reason = 'Explicit user re-engagement; awakened to active';
        }
      } else if (evidence.provenance === 'USER_CONFIRMATION' && isUserOriginated) {
        if (prevStage === 'DISCOVERY') {
          nextStage = 'PLANNING';
          nextState = 'active';
          shouldMutate = true;
          reason = 'User confirmation on user-originated thread; advanced to PLANNING';
        }
      }
    }

    // ── 8. Staleness & Dormancy Evaluation (Inactivity Invariant) ───────────
    else if (nextState === 'active' && (prevStage === 'IN_PROGRESS' || prevStage === 'PLANNING')) {
      const lastRelevant = thread.last_relevant_at ? new Date(thread.last_relevant_at) : new Date(thread.created_at || now);
      const daysInactive = (now.getTime() - lastRelevant.getTime()) / (1000 * 60 * 60 * 24);

      if (daysInactive > 60) {
        nextStage = 'DORMANT';
        nextState = 'waiting';
        shouldMutate = true;
        reason = `Inactivity of ${Math.floor(daysInactive)} days (>60d): marked DORMANT without abandonment`;
      } else if (daysInactive > 14) {
        nextStage = 'STALLED_OR_UNCERTAIN';
        nextState = 'active'; // Remains active; reduced attention
        shouldMutate = true;
        reason = `Inactivity of ${Math.floor(daysInactive)} days (>14d): marked STALLED_OR_UNCERTAIN without abandonment`;
      }
    }

    return {
      threadId: thread.id,
      previousStage: prevStage,
      nextStage,
      previousState: prevState,
      nextState,
      shouldMutate: shouldMutate && (nextStage !== prevStage || nextState !== prevState),
      reason,
      activeBlockersCount: activeBlockers.length,
      completedMilestonesCount: completedMilestones,
      totalMilestonesCount: totalMilestones,
      evaluatedAt: nowIso,
      nextRelevantTime: targetNextRelevantTime,
    };
  }

  /**
   * Cultivates active threads for a user within strict resource bounds.
   * Performs mutations strictly through lifeThreadRepository.ts.
   */
  async cultivateUserThreads(
    userId: string,
    ctx: CultivationEvaluationContext = { userId }
  ): Promise<UserCultivationPulseSummary> {
    const now = ctx.now || new Date();
    const activeThreads = await lifeThreadRepository.getActiveThreads(userId);

    // Compute Resource Bounds: MAX_THREADS_PROCESSED_PER_PULSE (5)
    const bound = LIFETHREAD_CULTIVATION_BOUNDS.MAX_THREADS_PROCESSED_PER_PULSE;
    const candidates = activeThreads.slice(0, bound);

    const decisions: CultivationDecision[] = [];
    let mutatedCount = 0;

    for (const thread of candidates) {
      const decision = this.evaluateThread(thread, ctx);
      decisions.push(decision);

      if (decision.shouldMutate) {
        try {
          await lifeThreadRepository.createOrUpdateThread(
            userId,
            {
              threadId: thread.id,
              topic: thread.topic,
              state: decision.nextState,
              cultivationStage: decision.nextStage,
              lastCultivatedAt: now.toISOString(),
              nextRelevantTime: decision.nextRelevantTime,
            },
            {
              sourceAuthority: 'deterministic_turn_analysis',
              evidenceProvenance: ctx.recentEvidence?.provenance || 'SYSTEM_OBSERVATION',
              reason: decision.reason,
              turnId: ctx.recentEvidence?.turnId,
              sourceMessageSeq: ctx.recentEvidence?.messageSeq,
            }
          );
          mutatedCount++;
        } catch (err: any) {
          logger.error('[LifeThreadCultivationEngine] Mutation failed for thread', {
            userId,
            threadId: thread.id,
            error: err.message,
          });
        }
      }
    }

    return {
      userId,
      totalActiveThreads: activeThreads.length,
      evaluatedCount: candidates.length,
      mutatedCount,
      decisions,
      evaluatedAt: now.toISOString(),
    };
  }

  // ── Helper Heuristics ──────────────────────────────────────────────────────

  private detectExplicitCancellationText(text?: string): boolean {
    if (!text) return false;
    const lower = text.toLowerCase();
    return (
      lower.includes('cancel this') ||
      lower.includes('forget this') ||
      lower.includes('not doing this anymore') ||
      lower.includes('drop this goal') ||
      lower.includes('stop tracking this') ||
      lower.includes('give up on this') ||
      lower.includes('ab ye nahi karna') ||
      lower.includes('yeh goal cancel kar')
    );
  }

  private detectExplicitCompletionText(text?: string): boolean {
    if (!text) return false;
    const lower = text.toLowerCase();
    return (
      lower.includes('completed this') ||
      lower.includes('finished this goal') ||
      lower.includes('i am done with this') ||
      lower.includes('it is done') ||
      lower.includes('goal complete ho gaya') ||
      lower.includes('yeh khatam ho gaya')
    );
  }
}

export const lifeThreadCultivationEngine = new LifeThreadCultivationEngine();
