/**
 * universalBurden.ts — Phase 3C-C Universal User Burden Types & Contracts
 *
 * ARCHITECTURAL INVARIANTS:
 * 1. GLOBAL USER BURDEN != SUBSYSTEM BURDEN: The user is one person experiencing touches.
 * 2. DETERMINISTIC ACCOUNTING: 0 LLM calls for burden evaluation.
 * 3. MULTI-INSTANCE DURABILITY: State is derived from durable DB logs, not process-local memory.
 * 4. SOURCE-AWARE BUDGETING: Differentiates user-requested, autonomous, and cognitive clarification.
 * 5. DUPLICATE TOPIC PROTECTION: Prevents multiple engines firing on the same conceptual topic.
 * 6. ZERO DIRECT MESSAGING: 0 push dispatches, 0 chat message inserts in this layer.
 * 7. ZERO DESTRUCTIVE RETENTION: 0 memory deletions, 0 source deletions.
 */

import { OutreachSourceClass } from './watchtowerTiming';

export type BurdenDecisionType = 'ALLOW' | 'DEFER' | 'SUPPRESS';

export type BurdenReasonCode =
  | 'BUDGET_AVAILABLE'
  | 'USER_REQUESTED_ALLOWED'
  | 'INTERNAL_SIGNAL_ALLOWED'
  | 'URGENT_OVERRIDE_ALLOWED'
  | 'DAILY_BUDGET_EXHAUSTED'
  | 'HOURLY_BUDGET_EXHAUSTED'
  | 'MIN_GAP_COOLDOWN'
  | 'IGNORED_BACKOFF_ACTIVE'
  | 'CLARIFICATION_LIMIT_REACHED'
  | 'DUPLICATE_TOPIC'
  | 'USER_STOPPED'
  | 'USER_DEFERRED'
  | 'QUIET_HOURS'
  | 'MISSING_CONTEXT';

export interface UserBurdenContext {
  userId: string;
  evaluatedAt: string;
  touchesLast24Hours: number;
  touchesLast1Hour: number;
  autonomousTouchesLast24Hours: number;
  autonomousTouchesLast1Hour: number;
  clarificationsLast24Hours: number;
  userRequestedTouchesLast24Hours: number;
  lastAutonomousTouchAt: string | null;
  lastTouchAt: string | null;
  consecutiveIgnoredCount: number;
  activeTopicsInFlight: string[];
}

export interface BurdenEvaluationOptions {
  topic?: string | null;
  logicalKey?: string | null;
  targetId?: string | null;
  isUrgent?: boolean;
  deadlineMinutes?: number | null;
  deferUntil?: string | null;
  status?: string | null;
  isInternalOnly?: boolean;
}

export interface BurdenDecision {
  decision: BurdenDecisionType;
  reasonCode: BurdenReasonCode;
  sourceClass: OutreachSourceClass;
  budgetSnapshot: UserBurdenContext;
  deferUntil: string | null;
  retryAfterMinutes: number | null;
  detail?: string;
}

export interface RecordTouchParams {
  userId: string;
  outreachType: string;
  sourceClass: OutreachSourceClass;
  message?: string;
  reason?: string;
  logicalKey?: string;
  topic?: string;
  targetId?: string;
}

export const UNIVERSAL_BURDEN_LIMITS = {
  MAX_AUTONOMOUS_TOUCHES_24H: 3,      // Baseline unsolicited autonomous touches per 24h
  HARD_AUTONOMOUS_TOUCHES_24H: 5,     // Hard total daily ceiling (including overrides)
  MAX_AUTONOMOUS_TOUCHES_1H: 1,       // Max unsolicited touches in a 1-hour window
  HARD_AUTONOMOUS_TOUCHES_1H: 2,      // Hard 1-hour boundary
  MAX_CLARIFICATIONS_24H: 1,          // Max unsolicited cognitive doubt questions per day
  MIN_AUTONOMOUS_GAP_MINUTES: 120,    // 2-hour minimum gap between autonomous proactive touches
  IGNORED_PROGRESSION_MINUTES: [60, 180, 360, 720] as const, // Backoff progression on repeated ignores
  DUPLICATE_TOPIC_WINDOW_HOURS: 24,   // Window for duplicate topic / logicalKey suppression
} as const;
