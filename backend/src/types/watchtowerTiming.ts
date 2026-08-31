/**
 * watchtowerTiming.ts — Phase 3C-A Timing Contracts & Type Foundation
 *
 * ARCHITECTURAL INVARIANTS:
 * 1. ATTENTION != OUTREACH: Decouples internal attention from external user intrusion.
 * 2. DETERMINISTIC TIMING: 0 LLM calls for timing evaluation.
 * 3. EXPLICIT TIMING STATES: NOW, SOON, WAIT, QUIET, BLOCKED, EXPIRED.
 * 4. GOVERNED OUTREACH ELIGIBILITY: PROACTIVE_ELIGIBLE, DEFER, SUPPRESS, EXPIRED.
 * 5. SOURCE CLASSIFICATION: USER_REQUESTED, SYSTEM_REQUIRED, AUTONOMOUS_PROACTIVE, COGNITIVE_CLARIFICATION.
 * 6. BOUNDED OBSERVABILITY: Immutable logs with mandatory expiration (expires_at).
 * 7. ZERO DESTRUCTIVE RETENTION: 0 memory deletions, 0 source deletions.
 */

import crypto from 'crypto';

/**
 * Exact Timing State of an attention item.
 */
export type TimingState =
  | 'NOW'      // Optimal moment: high relevance, user receptive, zero cooldown blocks
  | 'SOON'     // Actionable, but in micro-cooldown, active turn, or waiting for natural lull
  | 'WAIT'     // Future-bound opportune window (e.g. deadline distant, user said "later")
  | 'QUIET'    // Within local quiet hours (23:00–07:30) and non-critical
  | 'BLOCKED'  // Suppressed by global burden budget, user stop request, or ignored threshold
  | 'EXPIRED'; // Event or actionable window passed without delivery

/**
 * Outreach eligibility status emitted to ProactiveGate / NACE.
 */
export type OutreachEligibility =
  | 'PROACTIVE_ELIGIBLE' // Cleared by timing engine for immediate turn injection or push
  | 'DEFER'              // Held in queue; will re-evaluate on next pulse or lull
  | 'SUPPRESS'           // Suppressed due to burden, user dismissal, or blackout
  | 'EXPIRED';           // Expired; mark decision as expired with zero notification

/**
 * Epistemic confidence in the timing decision.
 */
export type TimingConfidence =
  | 'HIGH_CONFIDENCE'
  | 'MEDIUM_CONFIDENCE'
  | 'LOW_CONFIDENCE';

/**
 * Source classification of the outreach trigger.
 * Used by the global burden budget to differentiate requested vs unsolicited touches.
 */
export type OutreachSourceClass =
  | 'USER_REQUESTED'            // Explicit user reminders / followups (highest priority, bypasses routine caps)
  | 'SYSTEM_REQUIRED'            // System-level critical integrity (internal/administrative)
  | 'AUTONOMOUS_PROACTIVE'       // Nova proactive check-ins, routine outreach, life thread suggestions
  | 'COGNITIVE_CLARIFICATION';   // Cognitive doubt questions, memory reconciliation prompts

/**
 * Deterministic Context Model for Timing Evaluation.
 * Assembled with 0 LLM calls from existing databases.
 */
export interface TimingContext {
  userId: string;
  nowUtc: Date;
  nowLocal: Date;
  timezone: string;
  localHour: number;                         // 0–23 derived from user timezone offset
  isQuietHours: boolean;                     // Default: 23:00 to 07:30 local
  presenceStatus: 'online' | 'away' | 'offline' | 'typing';
  isUserInActiveTurn: boolean;               // Last user message < 3 minutes ago
  gapMinutesSinceLastMessage: number | null;
  currentChatTopic?: string | null;          // Derived from active conversation session
  touchesLast24Hours: number;                // Multi-engine touch count
  touchesLast1Hour: number;
  lastOutreachMinutesAgo: number | null;
  consecutiveIgnoredCount: number;           // Unreplied proactive touches
  minutesSinceTopicMentioned: number | null;
  hasUserAcknowledgedTopic: boolean;
}

/**
 * Structured reason code explaining the timing decision.
 */
export type TimingReasonCode =
  | 'QUIET_HOURS'
  | 'RECENT_OUTREACH'
  | 'ACTIVE_CONVERSATION'
  | 'TOPIC_MISMATCH'
  | 'USER_DEFERRED'
  | 'USER_STOPPED'
  | 'ALREADY_HANDLED'
  | 'ALREADY_TOLD'
  | 'DEADLINE_IMMINENT'
  | 'READY_NOW'
  | 'MISSING_CONTEXT'
  | 'EXPIRED'
  | 'LOW_PRIORITY'
  | 'INTERNAL_SIGNAL'
  | 'COOLDOWN_ACTIVE'
  | 'RELEVANT_CONVERSATION';

/**
 * Governed Timing Decision Record.
 */
export interface WatchtowerTimingDecision {
  id?: string;
  userId: string;
  attentionDecisionId?: string | null;
  timingState: TimingState;
  outreachEligibility: OutreachEligibility;
  confidence: TimingConfidence;
  sourceClass: OutreachSourceClass;
  burdenCount24h: number;
  reasonCode: TimingReasonCode;
  rejectionReason?: string | null;
  deferUntil?: string | null;
  contextSnapshot: Record<string, any>;
  fingerprint: string;
  createdAt?: string;
  expiresAt: string;
}

export const WATCHTOWER_TIMING_LIMITS = {
  DEFAULT_QUIET_HOURS_START: 23,   // 11:00 PM local
  DEFAULT_QUIET_HOURS_END: 7.5,    // 7:30 AM local
  MAX_TOUCHES_24H_DEFAULT: 3,      // Default unsolicited daily touch budget
  MAX_TOUCHES_24H_HARD_CAP: 5,     // Hard limit for combined requested + proactive touches
  MAX_TOUCHES_1H_LIMIT: 1,         // Max 1 unsolicited touch per hour
  MIN_TOUCH_GAP_MINUTES: 120,      // 2 hours minimum gap between proactive touches
  CONSECUTIVE_IGNORED_CAP: 3,      // 3 ignored outreaches -> 24h suppression
  TIMING_LOG_TTL_DAYS: 7,          // Bounded log retention: 7 days
} as const;

/**
 * Computes deterministic SHA-256 fingerprint for timing decisions.
 * Independent of current wall-clock millisecond to guarantee idempotency.
 */
export function generateTimingFingerprint(
  userId: string,
  attentionDecisionId: string,
  sourceClass: string,
  timingState: string,
  contextHash: string
): string {
  const normUser = (userId || '').trim().toLowerCase();
  const normAtt = (attentionDecisionId || '').trim().toLowerCase();
  const normSrc = (sourceClass || '').trim().toLowerCase();
  const normState = (timingState || '').trim().toLowerCase();
  const payload = `${normUser}|${normAtt}|${normSrc}|${normState}|${contextHash}`;
  return crypto.createHash('sha256').update(payload).digest('hex');
}
