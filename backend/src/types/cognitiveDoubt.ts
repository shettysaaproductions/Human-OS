/**
 * cognitiveDoubt.ts — Strong TypeScript Types for Phase 2B Cognitive Doubt Subsystem
 */

export type DoubtCategory =
  | 'identity_gap'
  | 'contradiction_ambiguity'
  | 'intent_uncertainty'
  | 'temporal_conflict'
  | 'schedule_gap'
  | 'entity_resolution';

export type DoubtStatus =
  | 'open'
  | 'eligible_for_clarification'
  | 'presented'
  | 'waiting_for_user'
  | 'resolved'
  | 'dismissed'
  | 'expired'
  | 'human_review';

export type DoubtPriority = 'NOW' | 'NEXT' | 'LATER' | 'BACKGROUND';

export type DoubtUrgency = 'low' | 'medium' | 'high' | 'critical';

export interface CognitiveDoubtRecord {
  id: string;
  user_id: string;
  category: DoubtCategory;
  question: string;
  evidence: Record<string, any>;
  confidence: number;
  urgency: DoubtUrgency;
  priority: DoubtPriority;
  status: DoubtStatus;
  fingerprint: string;
  presentation_count: number;
  presentation_count_for_evidence_version?: number;
  lifetime_presentation_count?: number;
  last_presented_at: string | null;
  resolution_turn_id: string | null;
  created_at: string;
  updated_at: string;
  expires_at: string;
}

export interface DoubtCreationDraft {
  userId: string;
  category: DoubtCategory;
  question: string;
  evidence: Record<string, any>;
  confidence?: number;
  urgency?: DoubtUrgency;
  priority?: DoubtPriority;
  fingerprint?: string;
  targetEntityKeys?: string[];
  unresolvedQuestionType?: string;
  evidenceVersion?: string;
  expiresInDays?: number;
  cooldownDays?: number;
}

export interface DoubtEligibilityContext {
  userId: string;
  turnId?: string;
  currentMessageText: string;
  activeLifeThreadTopics?: string[];
  recentTopics?: string[];
  userEmotionalState?: string;
  isDistressed?: boolean;
  isCloseEnded?: boolean;
}

export interface DoubtEligibilityDecision {
  eligible: boolean;
  doubt?: CognitiveDoubtRecord;
  reason: string;
  supervisoryDirective?: string;
}

export interface DoubtResolutionMatch {
  matched: boolean;
  isResolved?: boolean;
  isAmbiguous?: boolean;
  doubtId?: string;
  category?: DoubtCategory;
  resolutionTurnId?: string;
  resolvedEntityKey?: string;
  resolvedEntityValue?: string;
  reason: string;
}

