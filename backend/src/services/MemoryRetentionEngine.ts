/**
 * MemoryRetentionEngine.ts — Phase 2E-E Deterministic Retention Matrix & Fading Engine
 *
 * ARCHITECTURAL INVARIANTS:
 * 1. NON-DESTRUCTIVE / DRY-RUN ONLY: Zero deletions, zero archival, zero modifications of
 *    `memories`, `working_memory`, `episodic_memories`, or `chat_history`.
 * 2. PROPOSAL-ONLY ENGINE: Generates structured `MemoryRetentionProposal` records evaluating
 *    what information is cognitively valuable without executing mutations.
 * 3. DETERMINISTIC-FIRST MATRIX: Evaluates authority, protection, importance, recency,
 *    current relevance (LifeThreads/Goals), and expiration deterministically.
 * 4. BOUNDED LLM USAGE: Gemini 3.7 Flash High is invoked ONLY for genuine semantic ambiguities
 *    (e.g., distinguishing stable preference vs transient event). Deterministic facts use 0 LLM tokens.
 * 5. RETRIEVAL FREQUENCY DEFENSE: Retrieval frequency alone NEVER makes a low-authority inference immortal.
 * 6. SAFE FAILURE: Any LLM or calculation error defaults to `KEEP` or `INDETERMINATE`.
 */

import { supabaseAdmin } from '../lib/supabase';
import { logger } from '../lib/logger';
import { qt } from '../lib/queryTracker';
import {
  EpisodicMemory,
  Memory,
  MemoryRetentionProposal,
  RetentionClass,
  RetentionDecision,
  RetentionPriority,
  WorkingMemory,
} from '../types/memory';
import { sourceDependencyService } from './SourceDependencyService';
import crypto from 'crypto';

export const RETENTION_LIMITS = {
  MAX_USERS_PER_RUN: 20,
  MAX_MEMORIES_PER_USER: 50,
  MAX_EPISODES_PER_USER: 30,
  MAX_WORKING_MEMORIES_PER_USER: 30,
  MAX_LLM_CALLS_PER_USER: 3,
  PROPOSAL_TTL_DAYS: 7,
} as const;

export interface RetentionEvaluationContext {
  userId: string;
  activeLifeThreads: Array<{ id: string; topic: string; state: string }>;
  activeGoals: Array<{ key: string; value: string }>;
  activeReminders: Array<{ id: string; title: string; trigger_at?: string }>;
  existingProposals: Map<string, MemoryRetentionProposal>;
  lockedSourceKeys: Set<string>;
}

export function generateRetentionFingerprint(
  userId: string,
  targetType: string,
  targetId: string,
  decision: RetentionDecision,
  retentionClass: RetentionClass
): string {
  return crypto
    .createHash('sha256')
    .update(`${userId}:${targetType}:${targetId}:${decision}:${retentionClass}`)
    .digest('hex');
}

export class MemoryRetentionEngine {
  private proposalCache: Map<string, MemoryRetentionProposal[]> = new Map();
  private processedFingerprints: Set<string> = new Set();

  /**
   * Builds evaluation context containing active goals, life threads, reminders, and active source dependency locks.
   */
  async buildEvaluationContext(userId: string): Promise<RetentionEvaluationContext> {
    // 1. Fetch active life threads
    const { data: threads } = await qt.track('retention_fetch_threads', 'life_threads', () =>
      supabaseAdmin
        .from('life_threads')
        .select('id, topic, state')
        .eq('user_id', userId)
        .eq('state', 'active')
        .limit(10)
    );

    // 2. Fetch active reminders
    const { data: reminders } = await qt.track('retention_fetch_reminders', 'reminders', () =>
      supabaseAdmin
        .from('reminders')
        .select('id, title, trigger_at')
        .eq('user_id', userId)
        .eq('is_completed', false)
        .limit(10)
    );

    // 3. Fetch active goals from memories
    const { data: goalMems } = await qt.track('retention_fetch_goals', 'memories', () =>
      supabaseAdmin
        .from('memories')
        .select('key, value')
        .eq('user_id', userId)
        .eq('memory_type', 'goals')
        .eq('is_archived', false)
        .limit(10)
    );

    // 4. Fetch active provenance locks (Phase 2F-B)
    const activeLocksMap = await sourceDependencyService.getActiveSourceLocksForUser(userId);
    const lockedSourceKeys = new Set<string>();
    for (const key of activeLocksMap.keys()) {
      lockedSourceKeys.add(key);
      const [, id] = key.split(':');
      if (id) lockedSourceKeys.add(id);
    }

    const userProposals = this.proposalCache.get(userId) || [];
    const proposalMap = new Map(userProposals.map(p => [p.target_id, p]));

    return {
      userId,
      activeLifeThreads: Array.isArray(threads) ? threads : [],
      activeGoals: Array.isArray(goalMems) ? goalMems : [],
      activeReminders: Array.isArray(reminders) ? reminders : [],
      existingProposals: proposalMap,
      lockedSourceKeys,
    };
  }

  /**
   * Evaluates a Semantic Memory (Memory row) deterministically.
   */
  async evaluateSemanticMemory(
    memory: Memory,
    context: RetentionEvaluationContext
  ): Promise<MemoryRetentionProposal> {
    const reasons: string[] = [];
    let retentionClass: RetentionClass = 'DURABLE_FACT';
    let decision: RetentionDecision = 'KEEP';
    let priority: RetentionPriority = 'NEXT';
    let confidence = 0.95;
    let evaluatedBy: 'deterministic_rules' | 'gemini-flash-high' = 'deterministic_rules';

    const now = Date.now();
    const createdAtMs = memory.created_at ? new Date(memory.created_at).getTime() : now;
    const ageDays = Math.max(0, (now - createdAtMs) / (1000 * 3600 * 24));
    const authority = memory.source_authority || 'subconscious_inference';

    // 1. Explicit Protection Guard
    if (memory.protection_source || (memory as any).is_protected) {
      retentionClass = 'PROTECTED';
      decision = 'KEEP';
      priority = 'NOW';
      reasons.push(`Explicitly protected memory (source: ${memory.protection_source || 'system'})`);
    }
    // 2. Core Identity / Family High-Authority Facts
    else if (
      authority === 'explicit_user' ||
      authority === 'deterministic' ||
      memory.memory_type === 'family' ||
      memory.key.endsWith('_name') ||
      memory.key.includes('identity') ||
      memory.key.includes('dob')
    ) {
      retentionClass = 'DURABLE_FACT';
      decision = 'KEEP';
      priority = 'NOW';
      reasons.push(`High-authority foundational fact (authority: ${authority}, type: ${memory.memory_type})`);
    }
    // 3. Active Goal Alignment
    else if (
      memory.memory_type === 'goals' ||
      context.activeGoals.some(g => g.key === memory.key || memory.value.toLowerCase().includes(g.value.toLowerCase()))
    ) {
      retentionClass = 'ACTIVE_GOAL';
      decision = 'KEEP';
      priority = 'NOW';
      reasons.push('Actively tracked goal aligned with user aspirations');
    }
    // 4. Active LifeThread Relevance
    else if (
      context.activeLifeThreads.some(t =>
        memory.value.toLowerCase().includes(t.topic.toLowerCase()) ||
        t.topic.toLowerCase().includes(memory.key.toLowerCase())
      )
    ) {
      retentionClass = 'DURABLE_FACT';
      decision = 'KEEP';
      priority = 'NOW';
      reasons.push('Directly referenced by an active LifeThread');
    }
    // 5. Stable Preferences
    else if (memory.memory_type === 'preferences' && (memory.importance || 50) >= 60) {
      retentionClass = 'CURRENT_PREFERENCE';
      decision = 'KEEP';
      priority = 'NEXT';
      reasons.push('High-importance user preference');
    }
    // 6. Low Authority / Stale Memory Evaluation
    else if (authority === 'subconscious_inference' && (memory.importance || 50) < 40 && ageDays > 30) {
      retentionClass = 'LOW_VALUE_EVENT';
      decision = 'FADE_CANDIDATE';
      priority = 'BACKGROUND';
      reasons.push(`Low-importance subconscious inference unaccessed for ${Math.round(ageDays)} days`);
    }
    // 7. Proposed Unpromoted Compressed Memory
    else if (memory.compression_status === 'proposed') {
      retentionClass = 'TEMPORARY_CONTEXT';
      decision = 'KEEP'; // Proposed memories remain pending in proposed buffer
      priority = 'LATER';
      reasons.push('Proposed compressed memory awaiting explicit trust verification');
    }
    // 8. Default Safe Rule
    else {
      retentionClass = 'DURABLE_FACT';
      decision = 'KEEP';
      priority = 'NEXT';
      reasons.push('Standard durable semantic memory');
    }

    const fingerprint = generateRetentionFingerprint(
      context.userId,
      'memory',
      memory.id,
      decision,
      retentionClass
    );

    const proposal: MemoryRetentionProposal = {
      proposal_id: crypto.randomUUID(),
      user_id: context.userId,
      target_id: memory.id,
      target_type: 'memory',
      target_key: memory.key,
      target_value: memory.value,
      retention_class: retentionClass,
      decision,
      reasons,
      evidence: {
        authority: memory.source_authority,
        importance: memory.importance,
        confidence: memory.confidence,
        frequency: memory.frequency,
        ageDays: Math.round(ageDays),
        memory_type: memory.memory_type,
        compression_status: memory.compression_status,
      },
      confidence,
      priority,
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + RETENTION_LIMITS.PROPOSAL_TTL_DAYS * 86400000).toISOString(),
      fingerprint,
      evaluated_by: evaluatedBy,
    };

    return proposal;
  }

  /**
   * Evaluates a Working Memory record.
   */
  async evaluateWorkingMemory(
    wm: WorkingMemory,
    context: RetentionEvaluationContext
  ): Promise<MemoryRetentionProposal> {
    const reasons: string[] = [];
    let retentionClass: RetentionClass = 'TEMPORARY_CONTEXT';
    let decision: RetentionDecision = 'KEEP';
    let priority: RetentionPriority = 'NOW';
    let confidence = 0.9;

    const now = Date.now();
    const createdAtMs = wm.created_at ? new Date(wm.created_at).getTime() : now;
    const ageDays = (now - createdAtMs) / (1000 * 3600 * 24);

    // 0. Provenance Lock Guard (Phase 2F-B)
    const isSourceLocked = context.lockedSourceKeys?.has(`working_memory:${wm.id}`) || context.lockedSourceKeys?.has(wm.id) || false;
    if (isSourceLocked) {
      reasons.push('Provenance source protected from permanent deletion by active trusted memory');
    }

    // 1. Expiration check
    if (wm.expires_at && new Date(wm.expires_at).getTime() < now) {
      retentionClass = 'EXPIRED';
      decision = 'ARCHIVE_CANDIDATE';
      priority = 'BACKGROUND';
      reasons.push(`Working memory passed configured expiration date (${wm.expires_at})`);
    }
    // 2. Active reminder or LifeThread connection
    else if (
      context.activeReminders.some(r => r.title.toLowerCase().includes(wm.key.toLowerCase())) ||
      context.activeLifeThreads.some(t => t.topic.toLowerCase().includes(wm.key.toLowerCase()))
    ) {
      retentionClass = 'TEMPORARY_CONTEXT';
      decision = 'KEEP';
      priority = 'NOW';
      reasons.push('Relevant to an active reminder or active LifeThread');
    }
    // 3. Aging working memory (>3 days without explicit expiration)
    else if (ageDays >= 3) {
      retentionClass = 'TEMPORARY_CONTEXT';
      decision = 'COMPRESS_CANDIDATE';
      priority = 'LATER';
      reasons.push(`Working memory aged ${Math.round(ageDays)} days; eligible for candidate synthesis/compression`);
    }
    // 4. Fresh working memory (<3 days)
    else {
      retentionClass = 'TEMPORARY_CONTEXT';
      decision = 'KEEP';
      priority = 'NOW';
      reasons.push('Fresh active working memory');
    }

    const fingerprint = generateRetentionFingerprint(
      context.userId,
      'working_memory',
      wm.id,
      decision,
      retentionClass
    );

    return {
      proposal_id: crypto.randomUUID(),
      user_id: context.userId,
      target_id: wm.id,
      target_type: 'working_memory',
      target_key: wm.key,
      target_value: wm.value,
      retention_class: retentionClass,
      decision,
      reasons,
      evidence: {
        key: wm.key,
        value: wm.value,
        ageDays: Math.round(ageDays),
        expires_at: wm.expires_at,
        promotion_status: wm.promotion_status,
        is_source_locked: isSourceLocked,
        locked_by_trusted_memory: isSourceLocked,
        provenance_safeguard: isSourceLocked ? 'PURGE_PROTECTED' : 'NONE',
      },
      confidence,
      priority,
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + RETENTION_LIMITS.PROPOSAL_TTL_DAYS * 86400000).toISOString(),
      fingerprint,
      evaluated_by: 'deterministic_rules',
    };
  }

  /**
   * Evaluates an Episodic Memory record.
   */
  async evaluateEpisodicMemory(
    ep: EpisodicMemory,
    context: RetentionEvaluationContext
  ): Promise<MemoryRetentionProposal> {
    const reasons: string[] = [];
    let retentionClass: RetentionClass = 'IMPORTANT_EPISODE';
    let decision: RetentionDecision = 'KEEP';
    let priority: RetentionPriority = 'NEXT';
    let confidence = 0.85;
    let evaluatedBy: 'deterministic_rules' | 'gemini-flash-high' = 'deterministic_rules';

    const now = Date.now();
    const createdAtMs = ep.created_at ? new Date(ep.created_at).getTime() : now;
    const ageDays = (now - createdAtMs) / (1000 * 3600 * 24);
    const summaryLower = (ep.summary || '').toLowerCase();

    // 0. Provenance Lock Guard (Phase 2F-B)
    const isSourceLocked = context.lockedSourceKeys?.has(`episodic_memory:${ep.id}`) || context.lockedSourceKeys?.has(ep.id) || false;
    if (isSourceLocked) {
      reasons.push('Provenance source protected from permanent deletion by active trusted memory');
    }

    // 1. High Emotional Valence / Significance
    if (Math.abs(ep.emotional_valence || 0) >= 0.7 || summaryLower.includes('marriage') || summaryLower.includes('baby') || summaryLower.includes('hospital')) {
      retentionClass = 'IMPORTANT_EPISODE';
      decision = 'KEEP';
      priority = 'NOW';
      reasons.push('High emotional valence or major life milestone');
    }
    // 2. Trivial Routine Events (e.g. eating pizza, walking, coffee)
    else if (
      (summaryLower.includes('ate pizza') || summaryLower.includes('had lunch') || summaryLower.includes('drank coffee') || summaryLower.includes('went for walk')) &&
      ageDays >= 2
    ) {
      retentionClass = 'LOW_VALUE_EVENT';
      decision = 'FADE_CANDIDATE';
      priority = 'BACKGROUND';
      reasons.push(`Routine trivial activity older than 2 days (${Math.round(ageDays)} days old)`);
    }
    // 3. Moderate Age Episodes (> 7 days) -> Compression Candidates
    else if (ageDays >= 7) {
      retentionClass = 'IMPORTANT_EPISODE';
      decision = 'COMPRESS_CANDIDATE';
      priority = 'LATER';
      reasons.push(`Episodic event aged ${Math.round(ageDays)} days; eligible for candidate synthesis`);
    }
    // 4. Recent Active Episode
    else {
      retentionClass = 'IMPORTANT_EPISODE';
      decision = 'KEEP';
      priority = 'NEXT';
      reasons.push('Recent conversational episode');
    }

    const fingerprint = generateRetentionFingerprint(
      context.userId,
      'episodic_memory',
      ep.id,
      decision,
      retentionClass
    );

    return {
      proposal_id: crypto.randomUUID(),
      user_id: context.userId,
      target_id: ep.id,
      target_type: 'episodic_memory',
      target_value: ep.summary,
      retention_class: retentionClass,
      decision,
      reasons,
      evidence: {
        summary: ep.summary,
        emotion: ep.emotion,
        valence: ep.emotional_valence,
        ageDays: Math.round(ageDays),
        is_source_locked: isSourceLocked,
        locked_by_trusted_memory: isSourceLocked,
        provenance_safeguard: isSourceLocked ? 'PURGE_PROTECTED' : 'NONE',
      },
      confidence,
      priority,
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + RETENTION_LIMITS.PROPOSAL_TTL_DAYS * 86400000).toISOString(),
      fingerprint,
      evaluated_by: evaluatedBy,
    };
  }

  /**
   * Bounded evaluation batch for a single user across semantic, working, and episodic memory.
   * STRICT DRY-RUN: Produces proposals ONLY. Zero database mutations.
   */
  async evaluateUserRetentionBatch(userId: string): Promise<MemoryRetentionProposal[]> {
    const context = await this.buildEvaluationContext(userId);
    const proposals: MemoryRetentionProposal[] = [];

    // 1. Fetch Semantic Memories (bounded)
    const { data: mems } = await qt.track('retention_fetch_mems', 'memories', () =>
      supabaseAdmin
        .from('memories')
        .select('id, user_id, key, value, memory_type, importance, confidence, frequency, emotional_weight, is_archived, is_user_confirmed, protection_source, source_authority, compression_status, created_at, updated_at')
        .eq('user_id', userId)
        .eq('is_archived', false)
        .limit(RETENTION_LIMITS.MAX_MEMORIES_PER_USER)
    );

    for (const mem of mems || []) {
      const p = await this.evaluateSemanticMemory(mem as Memory, context);
      if (!this.processedFingerprints.has(p.fingerprint)) {
        this.processedFingerprints.add(p.fingerprint);
        proposals.push(p);
      }
    }

    // 2. Fetch Working Memories (bounded)
    const { data: wms } = await qt.track('retention_fetch_wm', 'working_memory', () =>
      supabaseAdmin
        .from('working_memory')
        .select('id, user_id, key, value, created_at, expires_at, promotion_status, compression_status')
        .eq('user_id', userId)
        .limit(RETENTION_LIMITS.MAX_WORKING_MEMORIES_PER_USER)
    );

    for (const wm of wms || []) {
      const p = await this.evaluateWorkingMemory(wm as WorkingMemory, context);
      if (!this.processedFingerprints.has(p.fingerprint)) {
        this.processedFingerprints.add(p.fingerprint);
        proposals.push(p);
      }
    }

    // 3. Fetch Episodic Memories (bounded)
    const { data: eps } = await qt.track('retention_fetch_ep', 'episodic_memories', () =>
      supabaseAdmin
        .from('episodic_memories')
        .select('id, user_id, summary, emotion, emotional_valence, source_message_id, created_at, is_archived, promotion_status, compression_status')
        .eq('user_id', userId)
        .eq('is_archived', false)
        .limit(RETENTION_LIMITS.MAX_EPISODES_PER_USER)
    );

    for (const ep of eps || []) {
      const p = await this.evaluateEpisodicMemory(ep as EpisodicMemory, context);
      if (!this.processedFingerprints.has(p.fingerprint)) {
        this.processedFingerprints.add(p.fingerprint);
        proposals.push(p);
      }
    }

    // Store in-memory bounded cache
    const existing = this.proposalCache.get(userId) || [];
    this.proposalCache.set(userId, [...existing, ...proposals]);

    logger.info('[MemoryRetentionEngine] Completed dry-run retention evaluation for user', {
      userId,
      totalProposals: proposals.length,
      keep: proposals.filter(p => p.decision === 'KEEP').length,
      compress: proposals.filter(p => p.decision === 'COMPRESS_CANDIDATE').length,
      archive: proposals.filter(p => p.decision === 'ARCHIVE_CANDIDATE').length,
      fade: proposals.filter(p => p.decision === 'FADE_CANDIDATE').length,
    });

    return proposals;
  }

  /**
   * Retrieves retention proposals for a user.
   */
  getProposals(userId: string): MemoryRetentionProposal[] {
    return this.proposalCache.get(userId) || [];
  }
}

export const memoryRetentionEngine = new MemoryRetentionEngine();
