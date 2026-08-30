export type MemoryType = 'family' | 'personal' | 'work' | 'goals' | 'preferences' | 'health' | 'important_dates';

/**
 * Source authority encodes WHO provided a memory fact.
 * This is SEPARATE from is_protected / protection_source which govern
 * Phase 6.1 retention/pruning semantics — those are NOT changed.
 *
 * Authority precedence (ascending):
 *   subconscious_inference < confirmed_memory < deterministic < explicit_user
 *
 * A lower-authority write MUST NOT overwrite a higher-authority row
 * unless correction_intent = true.
 */
export type SourceAuthority =
  | 'subconscious_inference'  // LLM-extracted, no explicit user statement
  | 'confirmed_memory'        // Confirmed by repeated user interaction
  | 'deterministic'           // TurnAnalyzer rule-based extraction
  | 'explicit_user'           // User directly stated / explicitly corrected
  | 'needs_review';           // Reconciliation script: evidence ambiguous

export interface Memory {
  id: string;
  user_id: string;
  memory_type: MemoryType;
  key: string;
  value: string;
  importance: number;
  confidence: number;
  frequency: number;
  emotional_weight: number;
  is_archived: boolean;
  is_user_confirmed: boolean;
  /** Retention/pruning semantics — Phase 6.1 UNCHANGED */
  protection_source?: string;
  protected_at?: Date;
  source_message?: string;
  last_accessed_at?: Date;
  /** Information authority — who said this fact */
  source_authority?: SourceAuthority;
  /** Phase 2E Lifecycle Metadata */
  source_references?: MemorySourceReference[];
  compression_status?: LifecycleStatus;
  created_at: Date;
  updated_at: Date;
}

export interface ExtractedMemory {
  shouldPersist: boolean;
  type: MemoryType;
  key: string;
  value: string;
  importance: number;
  confidence: number;
  frequency?: number;
  emotional_weight?: number;
  source_message_id?: string;
  /** Retention/pruning semantics — Phase 6.1 UNCHANGED */
  is_protected?: boolean;
  protection_source?: string;
  /** Information authority — governs overwrite permission */
  source_authority?: SourceAuthority;
  /** True when this write is an explicit user correction — may overwrite higher-authority values */
  correction_intent?: boolean;
  /** Phase 2E Lifecycle Metadata */
  source_references?: MemorySourceReference[];
  compression_status?: LifecycleStatus;
}

export interface WorkingMemory {
  id: string;
  user_id: string;
  key: string;
  value: string;
  created_at: Date;
  expires_at?: Date;
  /** Phase 2E Lifecycle Metadata */
  promotion_status?: LifecycleStatus;
  compression_status?: LifecycleStatus;
}

export interface EpisodicMemory {
  id: string;
  user_id: string;
  summary: string;
  emotion?: string;
  emotional_valence: number;
  source_message_id?: string;
  created_at: Date;
  /** Phase 2E Lifecycle Metadata */
  is_archived?: boolean;
  promotion_status?: LifecycleStatus;
  compression_status?: LifecycleStatus;
}

export interface KgNode {
  id: string;
  user_id: string;
  name: string;
  entity_type: string;
  attributes: Record<string, any>;
  created_at: Date;
  updated_at: Date;
}

export interface KgEdge {
  id: string;
  user_id: string;
  source_node_id: string;
  target_node_id: string;
  relation_type: string;
  weight: number;
  created_at: Date;
  updated_at: Date;
}

export interface EmotionalState {
  id: string;
  user_id: string;
  mood: string;
  intensity: number;
  notes?: string;
  created_at: Date;
}

export interface Reflection {
  id: string;
  user_id: string;
  reflection_type: 'daily' | 'weekly';
  summary: string;
  key_takeaways: Record<string, any>;
  created_at: Date;
}

// ============================================================================
// PHASE 2E: MEMORY LIFECYCLE FOUNDATION TYPES
// ============================================================================

export type CognitiveCategory = 'EVENT' | 'FACT' | 'PREFERENCE' | 'GOAL' | 'IDENTITY' | 'PATTERN';

export type CognitiveLifecycleState = 'COGNITIVE_RAM' | 'EPISODIC' | 'SEMANTIC' | 'ARCHIVED';

export type LifecycleStatus = 'pending' | 'promoted' | 'compressed' | 'proposed' | 'trusted' | 'rejected' | 'invalidated';

export interface MemorySourceReference {
  type: 'turn' | 'episodic_memory' | 'working_memory' | 'memory';
  id: string;
  turn_id?: string;
  source_message_id?: string;
}

export interface MemoryRetentionMetadata {
  retention_class?: CognitiveLifecycleState;
  retention_score?: number;
  last_retrieved_at?: Date;
  promotion_status?: LifecycleStatus;
  compression_status?: LifecycleStatus;
}

export interface MemoryPromotionCandidate {
  candidate_id: string;
  user_id: string;
  category: CognitiveCategory;
  proposed_key: string;
  proposed_value: string;
  source_references: MemorySourceReference[];
  confidence: number;
  importance_estimate: number;
  reason: string;
  created_at: string;
  status: 'candidate' | 'rejected' | 'expired';
  fingerprint?: string;
  expires_at?: string;
  proposed_memory_type?: MemoryType;
  source_records?: (WorkingMemory | EpisodicMemory)[];
}

export interface MemoryCompressionCandidate {
  source_records: (Memory | EpisodicMemory | WorkingMemory)[];
  proposed_memory: Memory;
  rationale: string;
}

export interface CompressionDraft {
  draft_id: string;
  user_id: string;
  candidate_id?: string;
  category: CognitiveCategory;
  proposed_key: string;
  proposed_value: string;
  proposed_memory_type: MemoryType;
  source_references: MemorySourceReference[];
  confidence: number;
  importance: number;
  reason: string;
  temporal_summary?: string;
  fingerprint: string;
  created_at: string;
}

export interface CompressionVerificationResult {
  decision: 'approve' | 'reject' | 'uncertain';
  confidence: number;
  unsupported_claims: string[];
  temporal_conflict: boolean;
  temporal_accurate: boolean;
  reason: string;
  verifier_model: 'gemini-flash-high' | 'gemini-pro-high';
  escalated: boolean;
  escalation_reason?: string;
}

export interface VerifiedSemanticProposal {
  proposal_id: string;
  user_id: string;
  key: string;
  value: string;
  memory_type: MemoryType;
  source_authority: SourceAuthority;
  source_references: MemorySourceReference[];
  verification_result: CompressionVerificationResult;
  status: 'proposed' | 'written' | 'verified' | 'failed' | 'invalidated';
  written_memory_id?: string;
  archive_candidate: boolean;
  fingerprint: string;
  created_at: string;
  invalidated_reason?: string;
}

// ============================================================================
// PHASE 2E-E: RETENTION MATRIX & FADING ENGINE TYPES
// ============================================================================

export type RetentionDecision =
  | 'KEEP'
  | 'COMPRESS_CANDIDATE'
  | 'ARCHIVE_CANDIDATE'
  | 'FADE_CANDIDATE'
  | 'HUMAN_REVIEW'
  | 'INDETERMINATE';

export type RetentionClass =
  | 'PROTECTED'
  | 'DURABLE_FACT'
  | 'ACTIVE_GOAL'
  | 'IMPORTANT_EPISODE'
  | 'CURRENT_PREFERENCE'
  | 'TEMPORARY_CONTEXT'
  | 'LOW_VALUE_EVENT'
  | 'EXPIRED';

export type RetentionPriority = 'NOW' | 'NEXT' | 'LATER' | 'BACKGROUND';

export interface MemoryRetentionProposal {
  proposal_id: string;
  user_id: string;
  target_id: string;
  target_type: 'memory' | 'working_memory' | 'episodic_memory';
  target_key?: string;
  target_value?: string;
  retention_class: RetentionClass;
  decision: RetentionDecision;
  reasons: string[];
  evidence: Record<string, any>;
  confidence: number;
  priority: RetentionPriority;
  created_at: string;
  expires_at: string;
  fingerprint: string;
  evaluated_by: 'deterministic_rules' | 'gemini-flash-high';
}


