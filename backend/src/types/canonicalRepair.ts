/**
 * canonicalRepair.ts — Phase 2C Safe Deterministic Repair Types
 *
 * Immutable, auditable contracts for Watchtower repair orders and outcomes.
 */

export type RepairType =
  | 'MEMORY_ALIAS_CANONICALIZATION'
  | 'GENERIC_RELATIONAL_NOISE'
  | 'DUPLICATE_REMINDER'
  | 'ORPHANED_LIFE_THREAD_ACTION'
  | 'EXPIRED_REMINDER_STATE';

export type RepairStatus =
  | 'pending'
  | 'executing'
  | 'resolved'
  | 'no_op_resolved'
  | 'rejected_stale'
  | 'failed'
  | 'human_review';

export type RepairAuthority = 'watchtower_repair';

export type RepairOutcome =
  | 'RESOLVED'
  | 'NO_OP_ALREADY_RESOLVED'
  | 'REPAIR_REJECTED_STALE'
  | 'FAILED'
  | 'HUMAN_REVIEW';

export interface RepairOrderDraft {
  anomalyId?: string;
  userId: string;
  repairType: RepairType;
  targetEntityId: string;
  expectedCurrentState: Record<string, any>;
  proposedState: Record<string, any>;
  evidence: Record<string, any>;
  authority?: RepairAuthority;
  sourceTurnId?: string | null;
  sourceMessageId?: string | null;
  sourceMessageSeq?: number | null;
}

export interface RepairOrder {
  id: string;
  anomaly_id?: string | null;
  user_id: string;
  repair_type: RepairType;
  target_entity_id: string;
  expected_current_state: Record<string, any>;
  proposed_state: Record<string, any>;
  evidence: Record<string, any>;
  authority: RepairAuthority;
  source_turn_id?: string | null;
  source_message_id?: string | null;
  source_message_seq?: number | null;
  status: RepairStatus;
  attempt_count: number;
  fingerprint: string;
  before_state?: Record<string, any> | null;
  after_state?: Record<string, any> | null;
  verification_result?: Record<string, any> | null;
  error_message?: string | null;
  created_at: string;
  executed_at?: string | null;
  resolved_at?: string | null;
}

export interface RepairVerificationResult {
  verified: boolean;
  postConditionMet: boolean;
  details?: Record<string, any>;
  notes?: string;
}

export interface RepairExecutionResult {
  outcome: RepairOutcome;
  repairId: string;
  repairType: RepairType;
  beforeState?: Record<string, any> | null;
  afterState?: Record<string, any> | null;
  verification: RepairVerificationResult;
  reason: string;
}
