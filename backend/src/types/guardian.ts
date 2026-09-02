/**
 * guardian.ts — Type definitions for Watchtower Phase 2A Deterministic Guardian
 */

export type AnomalyCode =
  | 'W-001' // Memory question / meta text
  | 'W-002' // Memory authority inversion
  | 'W-003' // Alias / canonical key collision
  | 'W-004' // Duplicate active/waiting life thread
  | 'W-005' // Invalid life thread state transition
  | 'W-006' // Stale mutation
  | 'W-007' // Provenance mismatch
  | 'W-008' // Autonomous chat without outreach
  | 'W-009' // Outreach without chat
  | 'W-010' // Confirmed reminder with no durable record
  | 'W-011' // Failed / malformed background job
  | 'W-012' // Invalid user job
  | 'W-013' // Deleted/dead user with executable job
  | 'W-014' // Missing turn attribution
  | 'W-015' // Orphaned profile/auth desync
  | 'W-016' // Cross-user conversation ownership violation
  | 'W-017' // Stale followup / lock state
  | 'W-018' // Proactive gate duplicate
  | 'W-019' // Expired active reminder
  | 'W-020' // Impossible event order
  | 'W-021' // Causal source mismatch
  | 'W-022' // Durable state / output agreement failure
  | 'W-023' // Multiple current values for canonical concept
  | 'W-024'; // Malformed command key

export type AnomalySeverity = 'low' | 'medium' | 'high' | 'critical';

export type AnomalyStatus = 'detected' | 'resolved' | 'dismissed' | 'human_review';

export type GuardianTriggerType =
  | 'post_turn'
  | 'life_thread_mutation'
  | 'memory_mutation'
  | 'autonomous_outreach'
  | 'manual_scan';

export interface GuardianAnomalyDraft {
  anomalyCode: AnomalyCode;
  severity: AnomalySeverity;
  targetEntityId: string;
  fingerprint: string;
  evidence: Record<string, any>;
}

export interface GuardianRunRecord {
  id: string;
  user_id: string | null;
  turn_id: string | null;
  source_message_id: string | null;
  trigger_type: GuardianTriggerType;
  execution_level: number;
  started_at: string;
  completed_at: string | null;
  duration_ms: number | null;
  anomalies_detected: number;
  created_at: string;
}

export interface GuardianAnomalyRecord {
  id: string;
  run_id: string | null;
  user_id: string;
  anomaly_code: AnomalyCode;
  severity: AnomalySeverity;
  status: AnomalyStatus;
  fingerprint: string;
  evidence: Record<string, any>;
  repair_attempts: number;
  created_at: string;
  resolved_at: string | null;
  last_detected_at: string;
  detection_count: number;
}

export interface GuardianRunResult {
  runId: string;
  userId?: string;
  triggerType: GuardianTriggerType;
  anomaliesDetected: number;
  durationMs: number;
  anomalies: GuardianAnomalyDraft[];
}

export interface GuardianScanReport {
  totalRuns: number;
  anomaliesByCode: Record<string, number>;
  anomaliesBySeverity: Record<string, number>;
  anomalies: GuardianAnomalyRecord[];
  falsePositiveCandidates: number;
  unknownInconclusive: number;
}
