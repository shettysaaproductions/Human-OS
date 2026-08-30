/**
 * lifeThreadRepository.ts — Single Authoritative Writer for Life Threads
 *
 * PHASE 1: Canonical State Consistency, Stale-Write Ordering, & Authority Guards
 *
 * Architectural Invariants:
 * 1. SINGLE WRITER: ALL mutations to `life_threads` table MUST route through this repository.
 * 2. CANONICAL KEY ENFORCEMENT: Layer 0 normalization guarantees 1 active thread per (user_id, canonical_key).
 * 3. AUTHORITY HIERARCHY:
 *    - user_explicit (rank 5)
 *    - deterministic_turn_analysis (rank 4)
 *    - watchtower_repair (rank 3)
 *    - scheduler_system (rank 2)
 *    - llm_proposal (rank 1)
 *    LLM proposals CANNOT resurrect terminal (completed/abandoned) threads into active.
 * 4. STALE-WRITE REJECTION: Older user turns NEVER overwrite newer user turns.
 * 5. PROVENANCE AUDIT: Every mutation appends structured state transition telemetry.
 */

import { supabaseAdmin } from '../lib/supabase';
import { logger } from '../lib/logger';
import { qt } from '../lib/queryTracker';
import { canonicalizeLifeThreadKey, CanonicalLifeThreadKeyResult } from '../lib/lifeThreadKeySchema';

export type LifeThreadState = 'active' | 'waiting' | 'blocked' | 'completed' | 'abandoned' | 'superseded';
export type LifeThreadPriority = 'low' | 'medium' | 'high';

export type LifeThreadMutationSource =
  | 'user_explicit'
  | 'deterministic_turn_analysis'
  | 'llm_proposal'
  | 'watchtower_repair'
  | 'scheduler_system';

export const AUTHORITY_RANK: Record<LifeThreadMutationSource, number> = {
  user_explicit:               5,
  deterministic_turn_analysis: 4,
  watchtower_repair:           3,
  scheduler_system:            2,
  llm_proposal:                1,
};

export interface LifeThreadRow {
  id: string;
  user_id: string;
  topic: string;
  canonical_key: string;
  state: LifeThreadState;
  priority: LifeThreadPriority;
  provenance: string | null;
  related_memories?: any;
  related_goals?: any;
  last_turn_id?: string | null;
  source_message_id?: string | null;
  source_message_seq?: number | null;
  mutation_source?: LifeThreadMutationSource | null;
  version: number;
  last_relevant_at: string;
  next_relevant_time?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ThreadMutationOpts {
  turnId?: string;
  sourceMessageId?: string;
  sourceMessageSeq?: number;
  sourceAuthority: LifeThreadMutationSource;
  reason?: string;
  provenanceNote?: string;
  isExplicitResume?: boolean;
  contextText?: string;
  existingThread?: LifeThreadRow;
}


export interface CreateOrUpdateThreadSpec {
  threadId?: string;
  topic: string;
  state?: LifeThreadState;
  priority?: LifeThreadPriority;
  provenance?: string;
}

export class LifeThreadRepository {
  /**
   * Retrieves all active/waiting/blocked threads for a user.
   */
  async getActiveThreads(userId: string): Promise<LifeThreadRow[]> {
    const { data, error } = await qt.track('get_active_life_threads', 'life_threads', () =>
      supabaseAdmin
        .from('life_threads')
        .select('*')
        .eq('user_id', userId)
        .in('state', ['active', 'waiting', 'blocked'])
    );

    if (error) {
      logger.error('[LifeThreadRepo] Failed to fetch active threads', { userId, error: error.message });
      throw new Error(`LifeThreadRepo[DB_FETCH_FAILURE]: ${error.message}`);
    }

    const rows = (data || []) as LifeThreadRow[];
    rows.sort((a, b) => {
      const timeB = new Date(b.last_relevant_at || b.updated_at || b.created_at || 0).getTime();
      const timeA = new Date(a.last_relevant_at || a.updated_at || a.created_at || 0).getTime();
      return timeB - timeA;
    });

    return rows;
  }

  /**
   * Retrieves a single thread by ID.
   */
  async getThreadById(userId: string, threadId: string): Promise<LifeThreadRow | null> {
    const { data, error } = await qt.track('get_life_thread_by_id', 'life_threads', () =>
      supabaseAdmin
        .from('life_threads')
        .select('*')
        .eq('user_id', userId)
        .eq('id', threadId)
        .maybeSingle()
    );

    if (error) {
      logger.error('[LifeThreadRepo] Failed to fetch thread by id', { userId, threadId, error: error.message });
      throw new Error(`LifeThreadRepo[DB_FETCH_FAILURE]: ${error.message}`);
    }

    return (data as LifeThreadRow) || null;
  }

  /**
   * Primary entry point for creating or updating a LifeThread.
   * Enforces Layer 0 Canonicalization, duplicate deduplication, authority validation, and stale-write guards.
   */
  async createOrUpdateThread(
    userId: string,
    spec: CreateOrUpdateThreadSpec,
    opts: ThreadMutationOpts
  ): Promise<{ thread: LifeThreadRow; isNew: boolean; wasResumed?: boolean; wasRejected?: boolean }> {
    const rawTopic = (spec.topic || '').trim();
    if (!rawTopic) {
      throw new Error('LifeThreadRepo[INVALID_INPUT]: topic is required');
    }

    // ── Layer 0: Canonical Key Normalization ──────────────────────────────────
    const canonicalMeta: CanonicalLifeThreadKeyResult = canonicalizeLifeThreadKey(rawTopic, opts.contextText);
    const { canonicalKey, displayTopic } = canonicalMeta;

    const today = new Date().toISOString().slice(0, 10);
    const nowIso = new Date().toISOString();

    // 1. Check for existing active/waiting/blocked thread by ID or canonical_key
    let existingThread: LifeThreadRow | null = opts.existingThread || null;

    if (!existingThread && spec.threadId) {
      existingThread = await this.getThreadById(userId, spec.threadId);
    }


    if (!existingThread) {
      const { data: matchedByKey } = await qt.track('find_thread_by_canonical_key', 'life_threads', () =>
        supabaseAdmin
          .from('life_threads')
          .select('*')
          .eq('user_id', userId)
          .eq('canonical_key', canonicalKey)
          .in('state', ['active', 'waiting', 'blocked'])
          .maybeSingle()
      );
      existingThread = (matchedByKey as LifeThreadRow) || null;
    }

    // ── Existing Thread Mutation Path ─────────────────────────────────────────
    if (existingThread) {
      // ── Layer 1: Stale Write Guard (Amendment 3: Seq > Turn > Timestamp) ───
      if (this.isStaleMutation(existingThread, opts)) {
        logger.warn('[LifeThreadRepo] STALE_WRITE_REJECTED: Older turn attempted to update newer thread', {
          userId,
          threadId: existingThread.id,
          canonicalKey,
          existingTurnId: existingThread.last_turn_id,
          incomingTurnId: opts.turnId,
          existingSeq: existingThread.source_message_seq,
          incomingSeq: opts.sourceMessageSeq
        });
        return { thread: existingThread, isNew: false, wasRejected: true };
      }

      // ── Layer 2: Authority Hierarchy & Terminal Protection (Amendment 4) ───
      const existingState = existingThread.state;
      let targetState = spec.state || existingState;

      // Handle Explicit Resume
      let wasResumed = false;
      if (existingState === 'waiting' && (opts.isExplicitResume || targetState === 'active')) {
        targetState = 'active';
        wasResumed = true;
      }

      // Terminal State Protection: LLM proposal cannot resurrect terminal threads
      if ((existingState === 'completed' || existingState === 'abandoned') && targetState === 'active') {
        if (opts.sourceAuthority === 'llm_proposal') {
          logger.warn('[LifeThreadRepo] RESURRECTION_BLOCKED: LLM proposal cannot reopen terminal thread', {
            userId, threadId: existingThread.id, existingState, sourceAuthority: opts.sourceAuthority
          });
          return { thread: existingThread, isNew: false, wasRejected: true };
        }
      }

      // ── Layer 3: Provenance Telemetry Append ───────────────────────────────
      let transitionNote = '';
      if (wasResumed) {
        transitionNote = `\n[RESUMED by user: "${opts.reason || rawTopic}" — ${today}]\n[STATE TRANSITION: waiting -> active by ${opts.sourceAuthority} — ${today}]`;
      } else if (targetState !== existingState) {
        transitionNote = `\n[STATE TRANSITION: ${existingState} -> ${targetState} by ${opts.sourceAuthority} — ${today}]`;
      }
      if (opts.provenanceNote) {
        transitionNote += `\n[NOTE: ${opts.provenanceNote}]`;
      }


      const updatedProvenance = (existingThread.provenance ?? '') + transitionNote;

      const updatePayload: any = {
        topic: displayTopic,
        canonical_key: canonicalKey,
        state: targetState,
        priority: spec.priority || existingThread.priority,
        provenance: updatedProvenance,
        last_turn_id: opts.turnId || existingThread.last_turn_id,
        source_message_id: opts.sourceMessageId || existingThread.source_message_id,
        source_message_seq: opts.sourceMessageSeq ?? existingThread.source_message_seq,
        mutation_source: opts.sourceAuthority,
        version: (existingThread.version || 1) + 1,
        last_relevant_at: nowIso,
        updated_at: nowIso,
      };

      const { data: updated, error: updErr } = await supabaseAdmin
        .from('life_threads')
        .update(updatePayload)
        .eq('id', existingThread.id)
        .eq('user_id', userId)
        .select('*')
        .single();

      if (updErr) {
        logger.error('[LifeThreadRepo] Update failed', { userId, threadId: existingThread.id, error: updErr.message });
        throw new Error(`LifeThreadRepo[DB_UPDATE_FAILURE]: ${updErr.message}`);
      }

      // If completing or abandoning, cascade cancel related nova_actions
      if (targetState === 'completed' || targetState === 'abandoned') {
        await this.cascadeCancelActions(userId, existingThread.id, targetState);
      }

      logger.info('[LifeThreadRepo] Thread updated successfully', {
        userId, id: existingThread.id, canonicalKey, state: targetState, wasResumed
      });

      return { thread: updated as LifeThreadRow, isNew: false, wasResumed };
    }

    // ── New Thread Insert Path ────────────────────────────────────────────────
    const initialState = spec.state || 'active';
    const initialProvenance = `[CREATED by ${opts.sourceAuthority}: "${displayTopic}" — ${today}]` +
      (opts.provenanceNote ? `\n[NOTE: ${opts.provenanceNote}]` : '');

    const insertPayload = {
      user_id: userId,
      topic: displayTopic,
      canonical_key: canonicalKey,
      state: initialState,
      priority: spec.priority || 'medium',
      provenance: initialProvenance,
      last_turn_id: opts.turnId || null,
      source_message_id: opts.sourceMessageId || null,
      source_message_seq: opts.sourceMessageSeq ?? null,
      mutation_source: opts.sourceAuthority,
      version: 1,
      last_relevant_at: nowIso,
      created_at: nowIso,
      updated_at: nowIso,
    };

    try {
      const { data: created, error: insertErr } = await supabaseAdmin
        .from('life_threads')
        .insert(insertPayload)
        .select('*')
        .single();

      if (insertErr) {
        // Unique Constraint Race Condition Handling (Postgres 23505)
        if (insertErr.code === '23505' || insertErr.message.includes('unique')) {
          logger.info('[LifeThreadRepo] Concurrent create detected — resolving in-flight thread', {
            userId, canonicalKey
          });
          // Re-fetch the concurrently inserted row and return it
          const { data: concurrentRow } = await supabaseAdmin
            .from('life_threads')
            .select('*')
            .eq('user_id', userId)
            .eq('canonical_key', canonicalKey)
            .in('state', ['active', 'waiting', 'blocked'])
            .single();

          if (concurrentRow) {
            return { thread: concurrentRow as LifeThreadRow, isNew: false };
          }
        }
        throw insertErr;
      }

      logger.info('[LifeThreadRepo] Thread created successfully', {
        userId, id: created.id, canonicalKey, state: initialState
      });

      return { thread: created as LifeThreadRow, isNew: true };
    } catch (err: any) {
      logger.error('[LifeThreadRepo] Thread creation failed', { userId, canonicalKey, error: err?.message || err });
      throw new Error(`LifeThreadRepo[DB_INSERT_FAILURE]: ${err?.message || err}`);
    }
  }

  /**
   * Deterministically transitions a thread's state (e.g. active -> waiting for pause, waiting -> active for resume).
   */
  async transitionState(
    userId: string,
    threadId: string,
    targetState: LifeThreadState,
    opts: ThreadMutationOpts
  ): Promise<LifeThreadRow | null> {
    const thread = await this.getThreadById(userId, threadId);
    if (!thread) {
      logger.warn('[LifeThreadRepo] Transition target thread not found', { userId, threadId });
      return null;
    }

    if (thread.state === targetState) {
      return thread;
    }

    // Check Stale Write
    if (this.isStaleMutation(thread, opts)) {
      logger.warn('[LifeThreadRepo] STALE_STATE_TRANSITION_REJECTED', {
        userId, threadId, from: thread.state, to: targetState, turnId: opts.turnId
      });
      return thread;
    }

    // Authority Check for Terminal State Resurrection
    if ((thread.state === 'completed' || thread.state === 'abandoned') && targetState === 'active') {
      if (opts.sourceAuthority === 'llm_proposal') {
        logger.warn('[LifeThreadRepo] RESURRECTION_BLOCKED on transitionState', {
          userId, threadId, state: thread.state, authority: opts.sourceAuthority
        });
        return thread;
      }
    }

    const today = new Date().toISOString().slice(0, 10);
    const nowIso = new Date().toISOString();
    const transitionLabel = `\n[STATE TRANSITION: ${thread.state} -> ${targetState} by ${opts.sourceAuthority} — ${today}]` +
      (opts.reason ? `\n[REASON: "${opts.reason}"]` : '');

    const newProvenance = (thread.provenance ?? '') + transitionLabel;

    const { data: updated, error } = await supabaseAdmin
      .from('life_threads')
      .update({
        state: targetState,
        provenance: newProvenance,
        last_turn_id: opts.turnId || thread.last_turn_id,
        source_message_id: opts.sourceMessageId || thread.source_message_id,
        source_message_seq: opts.sourceMessageSeq ?? thread.source_message_seq,
        mutation_source: opts.sourceAuthority,
        version: (thread.version || 1) + 1,
        last_relevant_at: nowIso,
        updated_at: nowIso,
      })
      .eq('id', threadId)
      .eq('user_id', userId)
      .select('*')
      .single();

    if (error) {
      logger.error('[LifeThreadRepo] Transition update failed', { userId, threadId, error: error.message });
      throw new Error(`LifeThreadRepo[DB_UPDATE_FAILURE]: ${error.message}`);
    }

    if (targetState === 'completed' || targetState === 'abandoned') {
      await this.cascadeCancelActions(userId, threadId, targetState);
    }

    logger.info('[LifeThreadRepo] State transitioned', {
      userId, threadId, from: thread.state, to: targetState, authority: opts.sourceAuthority
    });

    return updated as LifeThreadRow;
  }

  /**
   * Deterministic suppression for concepts negated in user turns (from TurnAnalyzer).
   * isCurrent=true -> state: 'waiting' (pause)
   * isCurrent=false -> state: 'abandoned' (drop)
   */
  async suppressThreadByConcept(
    userId: string,
    negatedConcept: string,
    isCurrent: boolean,
    opts: ThreadMutationOpts
  ): Promise<number> {
    const targetState: LifeThreadState = isCurrent ? 'waiting' : 'abandoned';
    const conceptMeta = canonicalizeLifeThreadKey(negatedConcept);
    const conceptLower = negatedConcept.toLowerCase();

    const activeThreads = await this.getActiveThreads(userId);
    const matched = activeThreads.filter(t => {
      const topicLower = (t.topic ?? '').toLowerCase();
      const keyLower = (t.canonical_key ?? '').toLowerCase();
      const provLower = (t.provenance ?? '').toLowerCase();

      return keyLower === conceptMeta.canonicalKey ||
             topicLower.includes(conceptLower) ||
             conceptLower.includes(topicLower) ||
             provLower.includes(conceptLower);
    });

    const today = new Date().toISOString().slice(0, 10);
    const pauseMarker = isCurrent
      ? `\n[PAUSED by user: "${negatedConcept}" — ${today}]`
      : `\n[ABANDONED by user (permanent drop): "${negatedConcept}" — ${today}]`;

    let suppressedCount = 0;
    for (const thread of matched) {
      if (thread.state === targetState) continue;

      const transitionMarker = `\n[STATE TRANSITION: ${thread.state} -> ${targetState} by deterministic_turn_analysis — ${today}]`;
      const combinedReason = `${pauseMarker}${transitionMarker}`;

      const { data: updated, error: updErr } = await supabaseAdmin
        .from('life_threads')
        .update({
          state: targetState,
          provenance: (thread.provenance ?? '') + combinedReason,
          last_turn_id: opts.turnId || thread.last_turn_id,
          source_message_id: opts.sourceMessageId || thread.source_message_id,
          source_message_seq: opts.sourceMessageSeq ?? thread.source_message_seq,
          mutation_source: 'deterministic_turn_analysis',
          version: (thread.version || 1) + 1,
          last_relevant_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('id', thread.id)
        .eq('user_id', userId)
        .select('*')
        .single();

      if (!updErr && updated) {
        suppressedCount++;
        if (targetState === 'abandoned') {
          await this.cascadeCancelActions(userId, thread.id, targetState);
        }
      }
    }

    return suppressedCount;
  }


  /**
   * Marks a thread matching topic as completed and closes pending actions.
   */
  async completeThreadByTopic(
    userId: string,
    topic: string,
    opts: ThreadMutationOpts
  ): Promise<LifeThreadRow | null> {
    const meta = canonicalizeLifeThreadKey(topic);
    const activeThreads = await this.getActiveThreads(userId);

    const target = activeThreads.find(t =>
      t.canonical_key === meta.canonicalKey ||
      t.topic.toLowerCase().includes(topic.toLowerCase())
    );

    if (!target) {
      logger.warn('[LifeThreadRepo] Complete thread target not found', { userId, topic, canonicalKey: meta.canonicalKey });
      return null;
    }

    return this.transitionState(userId, target.id, 'completed', opts);
  }

  /**
   * Helper: Determines if an incoming mutation is stale compared to the existing thread state.
   * Priority: source_message_seq -> turnId comparison -> last_relevant_at timestamp.
   */
  private isStaleMutation(existing: LifeThreadRow, incoming: ThreadMutationOpts): boolean {
    // 1. Same turn idempotency is always allowed
    if (incoming.turnId && existing.last_turn_id && incoming.turnId === existing.last_turn_id) {
      return false;
    }

    // 2. Monotonic Message Sequence check (Highest fidelity)
    if (incoming.sourceMessageSeq !== undefined && existing.source_message_seq !== undefined && existing.source_message_seq !== null) {
      if (incoming.sourceMessageSeq < existing.source_message_seq) {
        return true; // Stale sequence!
      }
    }

    // 3. Authority Hierarchy within same turn/sequence: Lower authority cannot overwrite higher authority
    if (incoming.sourceAuthority && existing.mutation_source) {
      const incomingRank = AUTHORITY_RANK[incoming.sourceAuthority] ?? 1;
      const existingRank = AUTHORITY_RANK[existing.mutation_source] ?? 1;
      const sameSeq = incoming.sourceMessageSeq !== undefined && existing.source_message_seq !== undefined
        ? incoming.sourceMessageSeq === existing.source_message_seq
        : incoming.turnId && existing.last_turn_id && incoming.turnId === existing.last_turn_id;

      if (sameSeq && incomingRank < existingRank) {
        return true; // Rejected: lower authority cannot overwrite higher authority
      }
    }

    // 4. Fallback: Timestamp check if seq is unavailable
    if (existing.last_relevant_at) {
      const existingTime = new Date(existing.last_relevant_at).getTime();
      const incomingTime = incoming.turnId ? Date.now() : Date.now();
      // If existing timestamp is in the future relative to incoming, reject
      if (existingTime > incomingTime + 1000) {
        return true;
      }
    }

    return false;

  }

  /**
   * Helper: Cancels all pending actions associated with a completed or abandoned thread.
   */
  private async cascadeCancelActions(_userId: string, threadId: string, threadState: 'completed' | 'abandoned'): Promise<void> {
    const nextActionState = threadState === 'completed' ? 'completed' : 'cancelled';
    await supabaseAdmin
      .from('nova_actions')
      .update({ state: nextActionState, updated_at: new Date().toISOString() })
      .eq('source_thread_id', threadId)
      .in('state', ['suggested', 'pending_confirmation', 'scheduled', 'in_progress', 'blocked']);
  }
}

export const lifeThreadRepository = new LifeThreadRepository();
