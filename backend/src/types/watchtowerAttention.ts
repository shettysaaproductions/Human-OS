/**
 * watchtowerAttention.ts — Type definitions for Phase 3B Watchtower Attention & Priority Engine
 *
 * ARCHITECTURAL INVARIANTS:
 * 1. IMPORTANCE != URGENCY: Never collapse separate dimensions into an opaque single scalar.
 * 2. DETERMINISTIC FIRST: Priority scoring is deterministic; 0 LLM calls for healthy/unambiguous states.
 * 3. BOUNDED OUTPUT: Scores are bounded (0–100); strict per-user decision limits.
 * 4. STRUCTURED ATTENTION CLASSES: IGNORE, WATCH, ATTENTION, ACTIONABLE, URGENT.
 * 5. NO DIRECT USER OUTREACH: Attention outputs inform existing ProactiveGate/NACE; 0 direct messaging.
 */

export type AttentionClass =
  | 'IGNORE'
  | 'WATCH'
  | 'ATTENTION'
  | 'ACTIONABLE'
  | 'URGENT';

export type AttentionStatus =
  | 'PENDING'
  | 'WATCHING'
  | 'READY'
  | 'DEFERRED'
  | 'ACTED'
  | 'DISMISSED'
  | 'EXPIRED';

export type AttentionTargetType =
  | 'guardian_signal'
  | 'cognitive_doubt'
  | 'life_thread'
  | 'reminder'
  | 'memory_change';

export interface AttentionScoreComponents {
  importance: number;             // 0–100: Objective value/consequence to user or system
  urgency: number;                // 0–100: Time sensitivity / decay rate
  goalRelevance: number;          // 0–100: Connection to active LifeThreads/goals
  deadlineProximity: number;      // 0–100: Proximity to deterministic date/event
  novelty: number;                // 0–100: Uniqueness / first-time observation
  confidence: number;             // 0–100: Epistemic certainty in underlying signal
  recency: number;                // 0–100: How recently signal occurred/mutated
  alreadyHandledPenalty: number;  // 0–100: Penalty applied if user/system handled this
  interruptionCost: number;       // 0–100: Cognitive load / disruption risk to user
  compositeScore: number;         // 0–100: Weighted normalized attention score
}

export interface WatchtowerAttentionDecision {
  id?: string;
  userId: string;
  targetType: AttentionTargetType;
  targetId: string;
  attentionClass: AttentionClass;
  status: AttentionStatus;
  scores: AttentionScoreComponents;
  evidence: Record<string, any>;
  reason: string;
  recommendedAction?: string | null;
  deferUntil?: string | null;
  fingerprint: string;
  createdAt?: string;
  updatedAt?: string;
  expiresAt: string;
}

export interface AttentionEvaluationContext {
  activeTurnsCount?: number;
  lastTurnMinutesAgo?: number;
  currentTopic?: string;
  isUserInActiveConversation?: boolean;
  lastOutreachMinutesAgo?: number;
}

export interface AttentionEngineSummary {
  userId: string;
  totalEvaluated: number;
  decisionsCreated: number;
  decisionsUpdated: number;
  decisionsExpired: number;
  urgentCount: number;
  actionableCount: number;
  watchCount: number;
  attentionCount: number;
  ignoreCount: number;
  llmCalls: number;
  durationMs: number;
}

export const WATCHTOWER_ATTENTION_LIMITS = {
  MAX_ATTENTION_DECISIONS_PER_USER: 10,
  MAX_ACTIONABLE_PER_USER: 3,
  MAX_URGENT_PER_USER: 1,
  ATTENTION_DEFAULT_TTL_HOURS: 72, // 3 days default TTL
  DEFERRED_COOLDOWN_HOURS: 4,      // 4 hours before re-evaluating deferred attention
} as const;
