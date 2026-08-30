/**
 * semanticGuardian.ts — Type definitions for Phase 2D Semantic Guardian
 */

import { RepairType } from './canonicalRepair';
import { DoubtCategory } from './cognitiveDoubt';

export type SemanticAnomalyCode =
  | 'S-001' // Memory Conflict / Contradiction
  | 'S-002' // Life Thread / Intent Conflict
  | 'S-003' // Semantic Entity Resolution
  | 'S-004' // Provenance Semantic Mismatch
  | 'S-005' // Cognitive Knowledge Gap
  | 'S-006'; // Stale Context Detection

export type SemanticOutcome =
  | 'no_action'
  | 'cognitive_doubt'
  | 'repair_candidate'
  | 'human_review';

export type SemanticRiskLevel = 'low' | 'medium' | 'high';

export type GeminiModelTier =
  | 'gemini-2.5-flash' // Flash Low / Default
  | 'gemini-2.5-pro';  // Escalation Tier

export interface CompactEvidencePackage {
  userId: string;
  anomalyCode: SemanticAnomalyCode;
  entityKey?: string;
  targetEntityId?: string;
  recentRelevantTurns: {
    role: 'user' | 'assistant';
    content: string;
    turn_id?: string;
    created_at?: string;
  }[];
  canonicalMemories: {
    key: string;
    value: string;
    source_authority?: string;
    created_at?: string;
    is_protected?: boolean;
  }[];
  relevantLifeThreads: {
    id: string;
    canonical_key: string;
    topic: string;
    state: string;
    provenance_summary?: string;
    source_message_seq?: number;
  }[];
  relevantReminders: {
    id: string;
    text: string;
    trigger_at?: string | null;
    status?: string;
  }[];
  openDoubtContext?: {
    id: string;
    category: string;
    question: string;
    evidence?: any;
  }[];
  contextBudgetTokensEstimate: number;
}

export interface SemanticGuardianResult {
  outcome: SemanticOutcome;
  anomaly_code: SemanticAnomalyCode;
  confidence: number;
  reason: string;
  evidence_refs: string[];
  proposed_question?: string | null;
  repair_type?: RepairType | null;
  proposed_repair_state?: Record<string, any> | null;
  doubt_category?: DoubtCategory | null;
  risk_level: SemanticRiskLevel;
  model_used: string;
  execution_duration_ms: number;
}
