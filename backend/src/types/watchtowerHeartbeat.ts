/**
 * watchtowerHeartbeat.ts — Type definitions for Watchtower Phase 3A Heartbeat Foundation
 */

export type HeartbeatStatus =
  | 'STARTED'
  | 'RUNNING'
  | 'COMPLETED'
  | 'PARTIAL'
  | 'FAILED'
  | 'LEASE_EXPIRED';

export type SignalCategory =
  | 'uncertainty'
  | 'contradiction'
  | 'provenance_gap'
  | 'stale_state'
  | 'repair_required'
  | 'clarification_required';

export type SignalSeverity = 'low' | 'medium' | 'high' | 'critical';

export type SignalStatus = 'active' | 'consumed' | 'resolved' | 'expired';

export interface WatchtowerCognitiveSignal {
  id?: string;
  userId: string;
  signalType: string;
  category: SignalCategory;
  severity: SignalSeverity;
  entity: string;
  evidence: Record<string, any>;
  missing: string[];
  requiredAction: string;
  fingerprint?: string;
  status?: SignalStatus;
  createdAt?: string;
  expiresAt?: string;
}

export interface HeartbeatUserMetrics {
  userId: string;
  observationsCount: number;
  anomaliesDetected: number;
  doubtsCreated: number;
  repairsQueued: number;
  semanticEscalations: number;
  signalsCreated: number;
  durationMs: number;
  status: 'completed' | 'partial' | 'skipped' | 'failed';
  error?: string;
}

export interface WatchtowerHeartbeatSummary {
  runId: string;
  status: HeartbeatStatus;
  leaseOwner: string;
  startedAt: string;
  completedAt?: string;
  totalUsersScanned: number;
  observationsCount: number;
  anomaliesCount: number;
  doubtsCount: number;
  repairsQueued: number;
  semanticEscalations: number;
  llmCalls: number;
  durationMs: number;
  userMetrics: HeartbeatUserMetrics[];
  error?: string;
}

export interface HeartbeatLeaseAcquireResult {
  acquired: boolean;
  runId: string;
  leaseOwner: string;
  leaseUntil?: string;
  reason?: string;
}

export const WATCHTOWER_HEARTBEAT_LIMITS = {
  MAX_USERS_PER_HEARTBEAT: 20,
  LEASE_DURATION_MS: 10 * 60 * 1000, // 10 minutes
  DEFAULT_CADENCE_MS: 15 * 60 * 1000, // 15 minutes
  MAX_MEMORIES_PER_USER: 50,
  MAX_WORKING_MEMORY_PER_USER: 20,
  MAX_EPISODIC_PER_USER: 30,
  MAX_OPEN_DOUBTS_PER_USER: 10,
  MAX_LIFE_THREADS_PER_USER: 10,
  MAX_REMINDERS_PER_USER: 10,
  MAX_GUARDIAN_ANOMALIES_PER_USER: 10,
  MAX_WORK_PER_USER_MS: 5000, // 5 seconds maximum observation per user
  SIGNAL_DEFAULT_TTL_HOURS: 72, // 3 days default TTL for supervisory signals
} as const;
