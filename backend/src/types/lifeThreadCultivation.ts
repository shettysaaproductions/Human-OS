/**
 * lifeThreadCultivation.ts — Phase 3D-A LifeThread Cultivation Schema & Type Foundation
 *
 * Architectural Invariants:
 * 1. GOAL AUTHORITY HIERARCHY: System-generated evidence (suggestions/reminders/observations)
 *    and passive compliance ("okay", "theek hai") MUST NEVER create or escalate committed user goals.
 * 2. USER AGENCY: Pure support for user intent; zero persuasion, zero guilt, zero nag.
 * 3. RESOURCE BOUNDS: Bounding compute (hot context, evaluations per pulse), NOT human life.
 * 4. REUSE EXISTING STATE: Reuses `next_relevant_time` (TIMESTAMPTZ) for blocker/wait deadlines;
 *    no duplicate waiting fields.
 */

export type LifeThreadCultivationStage =
  | 'DISCOVERY'
  | 'PLANNING'
  | 'IN_PROGRESS'
  | 'WAITING_ON_EXTERNAL'
  | 'STALLED_OR_UNCERTAIN'
  | 'COMPLETION_PROPOSED'
  | 'DORMANT';

export type LifeThreadCategory =
  | 'PRODUCTIVITY'
  | 'WELLBEING'
  | 'CAREER'
  | 'CREATIVE'
  | 'PERSONAL'
  | 'GENERAL';

export type LifeThreadBlockerType =
  | 'external_dependency'
  | 'user_friction'
  | 'time_bound'
  | 'missing_information'
  | 'other';

export interface LifeThreadBlocker {
  id: string;
  description: string;
  type: LifeThreadBlockerType;
  waiting_until?: string | null;     // ISO timestamp (for blocker-specific resolution expectations)
  resolved_at?: string | null;       // ISO timestamp
  source_reference?: string | null;
}

export interface LifeThreadMilestone {
  id: string;
  title: string;
  completed: boolean;
  evidence_turn_id?: string | null;
  completed_at?: string | null;      // ISO timestamp
}

export interface LifeThreadNextUsefulStep {
  title: string;
  description: string;
  duration_mins: number;
  leverage_score: number;            // 0–100 bounded leverage score
}

export type LifeThreadEvidenceProvenance =
  | 'USER_EXPLICIT'
  | 'USER_ACTION'
  | 'USER_CONFIRMATION'
  | 'SYSTEM_OBSERVATION'
  | 'SYSTEM_SUGGESTION'
  | 'SYSTEM_REMINDER'
  | 'PASSIVE_COMPLIANCE';

export type LifeThreadAgencyOperation =
  | 'pause'
  | 'resume'
  | 'deprioritize'
  | 'cancel'
  | 'abandon'
  | 'complete';

export interface GoalAuthorityEvaluation {
  provenance: LifeThreadEvidenceProvenance;
  authorityWeight: number; // 0.0 to 1.0
  canCreateCommittedGoal: boolean; // Only USER_EXPLICIT / USER_ACTION
  canStrengthenExistingGoal: boolean; // USER_EXPLICIT / USER_ACTION / USER_CONFIRMATION (if user-originated)
  isPassiveCompliance: boolean;
}

/**
 * Evaluates goal authority and commitment capability for incoming evidence.
 * Prevents system-generated suggestions or passive compliance ("okay", "theek hai")
 * from fabricating or escalating user commitment.
 */
export function evaluateGoalAuthority(
  provenance: LifeThreadEvidenceProvenance,
  isUserOriginatedThread: boolean = true
): GoalAuthorityEvaluation {
  switch (provenance) {
    case 'USER_EXPLICIT':
      return {
        provenance,
        authorityWeight: 1.0,
        canCreateCommittedGoal: true,
        canStrengthenExistingGoal: true,
        isPassiveCompliance: false,
      };
    case 'USER_ACTION':
      return {
        provenance,
        authorityWeight: 0.9,
        canCreateCommittedGoal: true,
        canStrengthenExistingGoal: true,
        isPassiveCompliance: false,
      };
    case 'USER_CONFIRMATION':
      return {
        provenance,
        authorityWeight: 0.8,
        // Confirmation cannot bootstrap a system suggestion into a committed goal,
        // but CAN strengthen an existing user-originated thread.
        canCreateCommittedGoal: false,
        canStrengthenExistingGoal: isUserOriginatedThread,
        isPassiveCompliance: false,
      };
    case 'SYSTEM_OBSERVATION':
      return {
        provenance,
        authorityWeight: 0.3,
        canCreateCommittedGoal: false, // May only create/stay in DISCOVERY
        canStrengthenExistingGoal: false,
        isPassiveCompliance: false,
      };
    case 'PASSIVE_COMPLIANCE':
      return {
        provenance,
        authorityWeight: 0.0,
        canCreateCommittedGoal: false,
        canStrengthenExistingGoal: false,
        isPassiveCompliance: true,
      };
    case 'SYSTEM_SUGGESTION':
    case 'SYSTEM_REMINDER':
    default:
      return {
        provenance,
        authorityWeight: 0.0,
        canCreateCommittedGoal: false,
        canStrengthenExistingGoal: false,
        isPassiveCompliance: false,
      };
  }
}

/**
 * Compute and Processing Bounds for LifeThread Cultivation.
 * These bound background processing and context load, NOT human aspirations.
 */
export const LIFETHREAD_CULTIVATION_BOUNDS = {
  MAX_HOT_THREADS_IN_CONTEXT: 3,
  MAX_THREADS_PROCESSED_PER_PULSE: 5,
  MAX_CULTIVATION_EVALUATIONS_PER_USER_DAY: 12,
  DEFAULT_CULTIVATION_FREQUENCY_DAYS: 7,
  MAX_BLOCKERS_PER_THREAD: 10,
  MAX_MILESTONES_PER_THREAD: 20,
} as const;

/**
 * Bounded evidence packet assembled for LLM synthesis.
 * Excludes system-generated suggestions, reminders, and passive compliance
 * from being presented as user commitment.
 */
export interface LifeThreadEvidencePacket {
  threadId: string;
  userId: string;
  topic: string;
  canonicalKey: string;
  category: LifeThreadCategory;
  cultivationStage: LifeThreadCultivationStage;
  groundedGoalStatement?: string;
  userEvidence: Array<{
    id: string;
    provenance: 'USER_EXPLICIT' | 'USER_ACTION' | 'USER_CONFIRMATION';
    text: string;
    createdAt: string;
    turnId?: string;
  }>;
  existingBlockers: LifeThreadBlocker[];
  milestones: LifeThreadMilestone[];
  nextRelevantTime?: string | null;
  lastRelevantAt?: string | null;
}

/**
 * Strict LLM output schema for next useful step synthesis.
 */
export interface LifeThreadSynthesisOutput {
  progress_summary: string | null;
  blocker_summary: string | null;
  next_step_proposal: {
    title: string;
    description: string;
    duration_mins: number;
    leverage_score: number;
  } | null;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'UNCERTAIN';
  evidence_ids: string[];
  temporal_consistency: 'CURRENT' | 'HISTORICAL' | 'FUTURE_INTENT' | 'CONFLICTING';
  uncertainty_reason?: string | null;
}

export interface LifeThreadSynthesisDecision {
  threadId: string;
  accepted: boolean;
  rejectionReason?: string;
  output?: LifeThreadSynthesisOutput;
  nextUsefulStepProposal?: LifeThreadNextUsefulStep | null;
  wasContradictory?: boolean;
  synthesizedAt: string;
}
