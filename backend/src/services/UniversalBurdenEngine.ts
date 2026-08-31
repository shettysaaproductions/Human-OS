/**
 * UniversalBurdenEngine.ts — Phase 3C-C Universal User Burden Budget & Cooldown Unification
 *
 * ARCHITECTURAL INVARIANTS:
 * 1. GLOBAL USER BURDEN != SUBSYSTEM BURDEN: The user is one person receiving outreach.
 * 2. DETERMINISTIC ACCOUNTING: 0 LLM calls for burden calculations.
 * 3. MULTI-INSTANCE DURABILITY: State is derived from durable DB logs, not process-local memory.
 * 4. SOURCE-AWARE BUDGETING: Differentiates user-requested, autonomous, and cognitive clarification.
 * 5. DUPLICATE TOPIC PROTECTION: Prevents multiple engines firing on the same conceptual topic.
 * 6. ZERO DIRECT MESSAGING: 0 push dispatches, 0 chat message inserts in this layer.
 * 7. ZERO DESTRUCTIVE RETENTION: 0 memory deletions, 0 source deletions.
 */

import { supabaseAdmin } from '../lib/supabase';
import { logger } from '../lib/logger';
import { qt } from '../lib/queryTracker';
import { OutreachSourceClass } from '../types/watchtowerTiming';
import {
  UserBurdenContext,
  BurdenEvaluationOptions,
  BurdenDecision,
  RecordTouchParams,
  UNIVERSAL_BURDEN_LIMITS,
} from '../types/universalBurden';

export class UniversalBurdenEngine {
  /**
   * Computes the current deterministic burden context for a user from durable DB records.
   * 0 LLM calls, multi-instance safe.
   */
  async getUserBurden(userId: string): Promise<UserBurdenContext> {
    const now = new Date();
    const evaluatedAt = now.toISOString();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();

    try {
      // 1. Fetch outreach logs from the last 24 hours & last user message
      const [outreachRes, chatRes] = await Promise.all([
        qt.track('burden_fetch_outreach_24h', 'nova_outreach_log', () =>
          supabaseAdmin
            .from('nova_outreach_log')
            .select('id, outreach_type, logical_key, message, reason, created_at, replied_at')
            .eq('user_id', userId)
            .gte('created_at', twentyFourHoursAgo)
            .order('created_at', { ascending: false })
        ),
        qt.track('burden_fetch_last_user_msg', 'chat_history', () =>
          supabaseAdmin
            .from('chat_history')
            .select('created_at')
            .eq('user_id', userId)
            .eq('role', 'user')
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle()
        ),
      ]);

      const logs = outreachRes.data || [];
      const lastUserMsgAt = chatRes.data?.created_at ? new Date(chatRes.data.created_at) : null;

      let touchesLast24Hours = 0;
      let touchesLast1Hour = 0;
      let autonomousTouchesLast24Hours = 0;
      let autonomousTouchesLast1Hour = 0;
      let clarificationsLast24Hours = 0;
      let userRequestedTouchesLast24Hours = 0;
      let lastAutonomousTouchAt: string | null = null;
      let lastTouchAt: string | null = null;
      const activeTopicsInFlight: string[] = [];

      for (const log of logs) {
        const createdAt = log.created_at;
        const logTime = new Date(createdAt).getTime();

        if (!lastTouchAt) {
          lastTouchAt = createdAt;
        }

        touchesLast24Hours += 1;
        if (logTime >= new Date(oneHourAgo).getTime()) {
          touchesLast1Hour += 1;
        }

        // Classify log entry
        const isUserRequested =
          log.outreach_type === 'reminder' ||
          (log.logical_key && log.logical_key.startsWith('reminder:user')) ||
          (log.reason && log.reason.toLowerCase().includes('user requested'));

        const isClarification =
          log.outreach_type === 'cognitive_doubt' ||
          (log.logical_key && log.logical_key.startsWith('cognitive_doubt:')) ||
          (log.logical_key && log.logical_key.startsWith('doubt:'));

        if (isUserRequested) {
          userRequestedTouchesLast24Hours += 1;
        } else if (isClarification) {
          clarificationsLast24Hours += 1;
          autonomousTouchesLast24Hours += 1;
          if (logTime >= new Date(oneHourAgo).getTime()) {
            autonomousTouchesLast1Hour += 1;
          }
          if (!lastAutonomousTouchAt) {
            lastAutonomousTouchAt = createdAt;
          }
        } else {
          // General autonomous proactive
          autonomousTouchesLast24Hours += 1;
          if (logTime >= new Date(oneHourAgo).getTime()) {
            autonomousTouchesLast1Hour += 1;
          }
          if (!lastAutonomousTouchAt) {
            lastAutonomousTouchAt = createdAt;
          }
        }

        // Track active topics in-flight
        if (log.logical_key) {
          activeTopicsInFlight.push(log.logical_key.toLowerCase());
        }
        if (log.reason) {
          activeTopicsInFlight.push(log.reason.toLowerCase());
        }
      }

      // Calculate consecutive unreplied proactive touches since last user message
      let consecutiveIgnoredCount = 0;
      for (const log of logs) {
        if (!log.replied_at) {
          // If message was sent after last user message, or user never spoke
          if (!lastUserMsgAt || new Date(log.created_at).getTime() > lastUserMsgAt.getTime()) {
            // Ignore internal recovery outreaches
            if (!log.logical_key || !log.logical_key.startsWith('followup:unanswered:')) {
              consecutiveIgnoredCount += 1;
            }
          }
        } else {
          break; // Stop counting once user replied
        }
      }

      return {
        userId,
        evaluatedAt,
        touchesLast24Hours,
        touchesLast1Hour,
        autonomousTouchesLast24Hours,
        autonomousTouchesLast1Hour,
        clarificationsLast24Hours,
        userRequestedTouchesLast24Hours,
        lastAutonomousTouchAt,
        lastTouchAt,
        consecutiveIgnoredCount,
        activeTopicsInFlight,
      };
    } catch (err: any) {
      logger.warn('[UniversalBurdenEngine] Failed to fetch burden context, using fail-safe defaults', {
        userId,
        error: err?.message,
      });

      // Fail-Safe Conservative Context (Assumes budget exhausted to prevent unconstrained spam)
      return {
        userId,
        evaluatedAt,
        touchesLast24Hours: UNIVERSAL_BURDEN_LIMITS.HARD_AUTONOMOUS_TOUCHES_24H,
        touchesLast1Hour: UNIVERSAL_BURDEN_LIMITS.HARD_AUTONOMOUS_TOUCHES_1H,
        autonomousTouchesLast24Hours: UNIVERSAL_BURDEN_LIMITS.MAX_AUTONOMOUS_TOUCHES_24H,
        autonomousTouchesLast1Hour: UNIVERSAL_BURDEN_LIMITS.MAX_AUTONOMOUS_TOUCHES_1H,
        clarificationsLast24Hours: UNIVERSAL_BURDEN_LIMITS.MAX_CLARIFICATIONS_24H,
        userRequestedTouchesLast24Hours: 0,
        lastAutonomousTouchAt: evaluatedAt,
        lastTouchAt: evaluatedAt,
        consecutiveIgnoredCount: 3,
        activeTopicsInFlight: [],
      };
    }
  }

  /**
   * Evaluates whether a proposed outreach action is allowed under the unified burden budget.
   */
  async evaluateBurden(
    userId: string,
    sourceClass: OutreachSourceClass,
    options?: BurdenEvaluationOptions,
    prebuiltContext?: UserBurdenContext
  ): Promise<BurdenDecision> {
    const now = Date.now();
    const ctx = prebuiltContext || (await this.getUserBurden(userId));

    // ── GATE 1: EXPLICIT USER STOP / DISMISSAL ───────────────────────────────
    if (options?.status === 'DISMISSED') {
      return {
        decision: 'SUPPRESS',
        reasonCode: 'USER_STOPPED',
        sourceClass,
        budgetSnapshot: ctx,
        deferUntil: null,
        retryAfterMinutes: null,
        detail: 'User explicitly dismissed or requested to stop this topic.',
      };
    }

    // ── GATE 2: USER "LATER" / DEFERRED ──────────────────────────────────────
    if (options?.deferUntil && new Date(options.deferUntil).getTime() > now) {
      const deferMs = new Date(options.deferUntil).getTime() - now;
      const retryAfterMinutes = Math.ceil(deferMs / (1000 * 60));
      return {
        decision: 'DEFER',
        reasonCode: 'USER_DEFERRED',
        sourceClass,
        budgetSnapshot: ctx,
        deferUntil: options.deferUntil,
        retryAfterMinutes,
        detail: `Outreach deferred by user until ${options.deferUntil}`,
      };
    }

    // ── GATE 3: INTERNAL SYSTEM SIGNALS (0 User Interruption Budget) ────────
    if (options?.isInternalOnly || sourceClass === 'SYSTEM_REQUIRED') {
      return {
        decision: 'ALLOW',
        reasonCode: 'INTERNAL_SIGNAL_ALLOWED',
        sourceClass,
        budgetSnapshot: ctx,
        deferUntil: null,
        retryAfterMinutes: null,
        detail: 'Internal system integrity signal does not consume user-facing budget.',
      };
    }

    // ── GATE 4: DUPLICATE TOPIC SUPPRESSION ──────────────────────────────────
    if (options?.topic || options?.logicalKey || options?.targetId) {
      const targetKeys = [
        options.topic?.toLowerCase(),
        options.logicalKey?.toLowerCase(),
        options.targetId?.toLowerCase(),
      ].filter(Boolean) as string[];

      const isDuplicate = targetKeys.some(k =>
        ctx.activeTopicsInFlight.some(active => active.includes(k) || k.includes(active))
      );

      if (isDuplicate) {
        return {
          decision: 'SUPPRESS',
          reasonCode: 'DUPLICATE_TOPIC',
          sourceClass,
          budgetSnapshot: ctx,
          deferUntil: null,
          retryAfterMinutes: null,
          detail: 'Topic or action has already been delivered in the active 24h window.',
        };
      }
    }

    // ── GATE 5: USER-REQUESTED SOURCE CLASS ──────────────────────────────────
    if (sourceClass === 'USER_REQUESTED') {
      // User-requested actions (e.g. reminders) bypass routine autonomous caps,
      // but are checked against the hard global safety boundary (5 touches/24h)
      if (ctx.touchesLast24Hours >= UNIVERSAL_BURDEN_LIMITS.HARD_AUTONOMOUS_TOUCHES_24H) {
        // If not urgent, check hard boundary
        if (!options?.isUrgent) {
          return {
            decision: 'DEFER',
            reasonCode: 'DAILY_BUDGET_EXHAUSTED',
            sourceClass,
            budgetSnapshot: ctx,
            deferUntil: null,
            retryAfterMinutes: 60,
            detail: 'Hard daily touch limit reached across all sources.',
          };
        }
      }

      return {
        decision: 'ALLOW',
        reasonCode: 'USER_REQUESTED_ALLOWED',
        sourceClass,
        budgetSnapshot: ctx,
        deferUntil: null,
        retryAfterMinutes: null,
        detail: 'Explicit user-requested touch cleared.',
      };
    }

    // ── GATE 6: COGNITIVE CLARIFICATION STRICT DAILY LIMIT (Max 1/day) ──────
    if (sourceClass === 'COGNITIVE_CLARIFICATION') {
      if (ctx.clarificationsLast24Hours >= UNIVERSAL_BURDEN_LIMITS.MAX_CLARIFICATIONS_24H) {
        return {
          decision: 'SUPPRESS',
          reasonCode: 'CLARIFICATION_LIMIT_REACHED',
          sourceClass,
          budgetSnapshot: ctx,
          deferUntil: null,
          retryAfterMinutes: 1440,
          detail: 'Max 1 cognitive clarification question per 24 hours reached.',
        };
      }
    }

    // ── GATE 7: AUTONOMOUS PROACTIVE & CLARIFICATION BURDEN GATES ────────────
    // 7A. Urgent Deadline Override Check
    const isUrgentWithDeadline =
      Boolean(options?.isUrgent) &&
      options?.deadlineMinutes !== null &&
      options?.deadlineMinutes !== undefined &&
      options.deadlineMinutes < 120;

    if (isUrgentWithDeadline) {
      if (ctx.autonomousTouchesLast24Hours < UNIVERSAL_BURDEN_LIMITS.HARD_AUTONOMOUS_TOUCHES_24H) {
        return {
          decision: 'ALLOW',
          reasonCode: 'URGENT_OVERRIDE_ALLOWED',
          sourceClass,
          budgetSnapshot: ctx,
          deferUntil: null,
          retryAfterMinutes: null,
          detail: 'Urgent deadline approaching within <2h overrides routine cooldown.',
        };
      }
    }

    // 7B. 24h Autonomous Daily Budget Cap (Max 3)
    if (ctx.autonomousTouchesLast24Hours >= UNIVERSAL_BURDEN_LIMITS.MAX_AUTONOMOUS_TOUCHES_24H) {
      return {
        decision: 'SUPPRESS',
        reasonCode: 'DAILY_BUDGET_EXHAUSTED',
        sourceClass,
        budgetSnapshot: ctx,
        deferUntil: null,
        retryAfterMinutes: 720,
        detail: `Daily autonomous touch budget (${UNIVERSAL_BURDEN_LIMITS.MAX_AUTONOMOUS_TOUCHES_24H}/24h) exhausted.`,
      };
    }

    // 7C. 1h Autonomous Hourly Budget Cap (Max 1)
    if (ctx.autonomousTouchesLast1Hour >= UNIVERSAL_BURDEN_LIMITS.MAX_AUTONOMOUS_TOUCHES_1H) {
      return {
        decision: 'DEFER',
        reasonCode: 'HOURLY_BUDGET_EXHAUSTED',
        sourceClass,
        budgetSnapshot: ctx,
        deferUntil: null,
        retryAfterMinutes: 60,
        detail: `Hourly autonomous touch budget (${UNIVERSAL_BURDEN_LIMITS.MAX_AUTONOMOUS_TOUCHES_1H}/1h) exhausted.`,
      };
    }

    // 7D. Consecutive Ignored Escalation Backoff Check
    if (ctx.consecutiveIgnoredCount >= 1 && ctx.lastAutonomousTouchAt) {
      const minutesSinceLast = Math.floor(
        (now - new Date(ctx.lastAutonomousTouchAt).getTime()) / (1000 * 60)
      );
      const requiredGap = this.getEscalatedGapMinutes(ctx.consecutiveIgnoredCount);

      if (minutesSinceLast < requiredGap) {
        const remaining = requiredGap - minutesSinceLast;
        return {
          decision: 'DEFER',
          reasonCode: 'IGNORED_BACKOFF_ACTIVE',
          sourceClass,
          budgetSnapshot: ctx,
          deferUntil: new Date(now + remaining * 60 * 1000).toISOString(),
          retryAfterMinutes: remaining,
          detail: `User has ignored ${ctx.consecutiveIgnoredCount} consecutive outreaches; cooling down for ${requiredGap}m.`,
        };
      }
    }

    // 7E. Minimum Autonomous Gap Check (120m)
    if (ctx.lastAutonomousTouchAt) {
      const minutesSinceLast = Math.floor(
        (now - new Date(ctx.lastAutonomousTouchAt).getTime()) / (1000 * 60)
      );
      const minGap = UNIVERSAL_BURDEN_LIMITS.MIN_AUTONOMOUS_GAP_MINUTES;

      if (minutesSinceLast < minGap) {
        const remaining = minGap - minutesSinceLast;
        return {
          decision: 'DEFER',
          reasonCode: 'MIN_GAP_COOLDOWN',
          sourceClass,
          budgetSnapshot: ctx,
          deferUntil: new Date(now + remaining * 60 * 1000).toISOString(),
          retryAfterMinutes: remaining,
          detail: `Minimum autonomous gap of ${minGap}m not met (${minutesSinceLast}m elapsed).`,
        };
      }
    }

    // ── ALL GATES PASSED: ALLOW ──────────────────────────────────────────────
    return {
      decision: 'ALLOW',
      reasonCode: 'BUDGET_AVAILABLE',
      sourceClass,
      budgetSnapshot: ctx,
      deferUntil: null,
      retryAfterMinutes: null,
      detail: 'Universal burden budget available; outreach cleared.',
    };
  }

  /**
   * Fast boolean check for whether outreach is currently permitted.
   */
  async canInitiateOutreach(
    userId: string,
    sourceClass: OutreachSourceClass,
    options?: BurdenEvaluationOptions
  ): Promise<boolean> {
    const res = await this.evaluateBurden(userId, sourceClass, options);
    return res.decision === 'ALLOW';
  }

  /**
   * Records a touch into the durable nova_outreach_log ledger.
   * Multi-instance safe.
   */
  async recordOutreachTouch(params: RecordTouchParams): Promise<boolean> {
    try {
      const { error } = await qt.track('burden_record_touch', 'nova_outreach_log', () =>
        supabaseAdmin.from('nova_outreach_log').insert({
          user_id: params.userId,
          outreach_type: params.outreachType,
          message: params.message || 'proactive_touch',
          reason: params.reason || params.topic || params.sourceClass,
          logical_key: params.logicalKey || `${params.sourceClass.toLowerCase()}:${params.targetId || Date.now()}`,
          created_at: new Date().toISOString(),
        })
      );

      if (error) {
        logger.warn('[UniversalBurdenEngine] Non-fatal error recording touch', { error: error.message });
        return false;
      }

      return true;
    } catch (err: any) {
      logger.warn('[UniversalBurdenEngine] Non-fatal exception recording touch', { error: err?.message });
      return false;
    }
  }

  /**
   * Returns the required backoff minutes based on the number of unreplied outreaches.
   */
  getEscalatedGapMinutes(ignoredCount: number): number {
    const progression = UNIVERSAL_BURDEN_LIMITS.IGNORED_PROGRESSION_MINUTES;
    if (ignoredCount <= 0) return 0;
    if (ignoredCount === 1) return progression[0]; // 60 min
    if (ignoredCount === 2) return progression[1]; // 180 min (3h)
    if (ignoredCount === 3) return progression[2]; // 360 min (6h)
    return progression[3];                         // 720 min (12h)
  }
}

export const universalBurdenEngine = new UniversalBurdenEngine();
