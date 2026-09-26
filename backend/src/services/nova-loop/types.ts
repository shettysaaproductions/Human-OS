/**
 * types.ts — Nova Loop Engineering Layer Type Definitions
 *
 * Enforces strict separation between observable conversation evidence,
 * incident identity / fingerprint, scan checkpoints, and resolution history.
 *
 * Invariant: Never stores hidden chain-of-thought traces. Evidence consists
 * exclusively of observable, reproducible dialogue and system artifacts.
 */

import { NovaLoopCapability } from '../../lib/cognitiveRouter';

export type FlawType =
  | 'CONTEXT_AMNESIA'
  | 'SEMANTIC_CONTRADICTION'
  | 'GOAL_DERAILMENT'
  | 'TEMPORAL_ERROR'
  | 'UNACKNOWLEDGED_BURDEN'
  | 'REPETITIVE_INTERROGATION'
  | 'PROMPT_LEAK'
  | 'OTHER';

export type IncidentSeverity = 'low' | 'medium' | 'high' | 'critical';

export type IncidentStatus =
  | 'open'
  | 'investigating'
  | 'resolved'
  | 'regression'
  | 'blocked'
  | 'dismissed';

export interface ObservableTurnContext {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  created_at: string;
  reply_to_id?: string | null;
  reply_to_content?: string | null;
}

export interface ObservableDialogueEvidence {
  userId: string;
  conversationId: string;
  userMessageId: string;
  userMessage: string;
  userMessageTimestamp: string;
  assistantMessageId: string;
  assistantResponse: string;
  assistantResponseTimestamp: string;
  surroundingContext: ObservableTurnContext[];
  suppliedContextSummary?: Record<string, any>;
  actionResults?: Record<string, any>;
  modelMetadata?: {
    provider?: string;
    model?: string;
    latencyMs?: number;
  };
  systemErrors?: string[];
}

export interface EvaluationFinding {
  flawType: FlawType;
  severity: IncidentSeverity;
  confidence: number; // 0.0 to 1.0 (>= 0.75 for actionable threshold)
  canonicalSubject: string; // Used for stable fingerprinting (e.g. 'transit_metro_destination')
  failureSignature: string; // Used for stable fingerprinting (e.g. 'asked_destination_after_metro_stated')
  evidenceReferences: {
    userMessageId: string;
    assistantMessageId: string;
    priorTurnIds: string[];
  };
  reasoningSummary: string; // Objective engineering diagnosis (NOT hidden internal thoughts)
  requiredCapability: NovaLoopCapability;
  recommendedAction: string;
}

export interface NovaLoopCheckpoint {
  id: string;
  stage: string;
  last_scanned_created_at: string;
  last_scanned_message_id: string | null;
  total_scanned_count: number;
  incidents_found: number;
  updated_at: string;
}

export interface EngineeringIncidentRecord {
  id?: string;
  fingerprint: string;
  flaw_type: FlawType;
  severity: IncidentSeverity;
  status: IncidentStatus;
  confidence: number;
  user_id: string;
  conversation_id: string;
  source_message_id: string;
  trigger_turn_id?: string;
  evidence: ObservableDialogueEvidence;
  required_capability: NovaLoopCapability;
  detection_count: number;
  first_detected_at?: string;
  last_detected_at?: string;
  resolved_at?: string | null;
  resolution_note?: string | null;
  blocked_reason?: string | null;
  recommended_action?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface IncidentVerificationRecord {
  id?: string;
  incident_id: string;
  verification_type: 'REPLAY_TEST' | 'CANONICAL_AUDIT' | 'MANUAL_SIGN_OFF';
  passed: boolean;
  tested_at?: string;
  tested_commit?: string;
  details?: Record<string, any>;
}
