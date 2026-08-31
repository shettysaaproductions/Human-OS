/**
 * SourceDependencyService.ts — Phase 2F-B Source Dependency Protection & Provenance Locks
 *
 * ARCHITECTURAL INVARIANTS:
 * 1. DETERMINISTIC PROVENANCE LOCKS: An active trusted compressed memory
 *    (`compression_status = 'trusted'`, `lifecycle_state = 'CURRENT'`, `is_archived = false`)
 *    protects its constituent evidence (`episodic_memories`, `working_memory`, `turn`) from physical deletion.
 * 2. PROPOSED / INACTIVE MEMORY EXCLUSION: Memories with `compression_status = 'proposed'`,
 *    `rejected`, `invalidated`, `superseded`, or `is_archived = true` NEVER create permanent deletion locks.
 * 3. RETENTION SAFEGUARD (NOT CONTEXT PINNING): A protected source can be in state `ARCHIVED_BUT_RECOVERABLE`
 *    (soft archived, removed from hot context) while remaining `PURGE_PROTECTED` from physical database deletion.
 * 4. STRICT USER ISOLATION: Cross-user source references are REJECTED (`CROSS_USER_FORBIDDEN`) and never lock.
 * 5. DETERMINISTIC & BOUNDED: Bounded processing limits (`MAX_MEMORIES_PER_EVALUATION`,
 *    `MAX_SOURCE_REFERENCES_PER_MEMORY`). Zero LLM calls.
 * 6. FAIL-SAFE PERMANENT DELETION GUARD: If database lookup fails or status is ambiguous,
 *    `canPermanentlyDeleteSource` returns `false` (fail-safe protection).
 * 7. ZERO DESTRUCTIVE MUTATION: 0 physical deletes, 0 purges.
 */

import { supabaseAdmin } from '../lib/supabase';
import { logger } from '../lib/logger';
import { qt } from '../lib/queryTracker';
import {
  Memory,
  SourceDependencyLock,
  SourceDependencyType,
  SourceLifecycleState,
  SourceProvenanceReport,
} from '../types/memory';

export const DEPENDENCY_LIMITS = {
  MAX_MEMORIES_PER_EVALUATION: 100,
  MAX_SOURCE_REFERENCES_PER_MEMORY: 20,
} as const;

// UUID validation regex (RFC 4122)
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidUuid(id?: string | null): boolean {
  if (!id || typeof id !== 'string') return false;
  return UUID_REGEX.test(id.trim());
}

export class SourceDependencyService {
  /**
   * Fetches all active, trusted semantic memories for a user.
   * STRICT TRUST BOUNDARY:
   * Requires compression_status = 'trusted', lifecycle_state = 'CURRENT', is_archived = false.
   */
  async getActiveTrustedMemories(userId: string): Promise<Memory[]> {
    if (!userId || !isValidUuid(userId)) return [];

    const { data, error } = await qt.track('get_active_trusted_memories', 'memories', () =>
      supabaseAdmin
        .from('memories')
        .select('id, user_id, key, value, importance, confidence, is_archived, compression_status, lifecycle_state, source_references, created_at, updated_at')
        .eq('user_id', userId)
        .eq('is_archived', false)
        .eq('lifecycle_state', 'CURRENT')
        .eq('compression_status', 'trusted')
        .limit(DEPENDENCY_LIMITS.MAX_MEMORIES_PER_EVALUATION)
    );

    if (error) {
      logger.error('[SourceDependencyService] Failed to fetch active trusted memories', {
        userId,
        error: error.message,
      });
      throw new Error(`Failed to fetch active trusted memories: ${error.message}`);
    }

    return (data || []) as Memory[];
  }

  /**
   * Resolves and validates provenance references for a single semantic memory.
   * Returns a complete audit report identifying all resolved and unresolved dependencies.
   */
  async resolveMemoryProvenance(userId: string, memory: Memory): Promise<SourceProvenanceReport> {
    const isTrusted =
      !memory.is_archived &&
      memory.lifecycle_state === 'CURRENT' &&
      memory.compression_status === 'trusted';

    const report: SourceProvenanceReport = {
      memoryId: memory.id,
      userId,
      key: memory.key,
      isTrusted,
      lifecycleState: memory.lifecycle_state || 'CURRENT',
      dependencyCount: 0,
      provenanceComplete: true,
      resolvedDependencies: [],
      unresolvedDependencies: [],
    };

    const rawRefs = memory.source_references;
    if (!rawRefs || !Array.isArray(rawRefs) || rawRefs.length === 0) {
      return report;
    }

    // Bounded reference processing
    const boundedRefs = rawRefs.slice(0, DEPENDENCY_LIMITS.MAX_SOURCE_REFERENCES_PER_MEMORY);

    for (const ref of boundedRefs) {
      const refType = ref.type as string;
      const refId = (ref.id || ref.turn_id || ref.source_message_id || '').trim();

      // 1. UUID Syntax Validation
      if (!isValidUuid(refId)) {
        report.provenanceComplete = false;
        report.unresolvedDependencies.push({
          type: refType,
          id: refId,
          reason: 'MALFORMED_UUID',
        });
        continue;
      }

      // 2. Type and Source Resolution
      if (refType === 'episodic_memory') {
        const { data: ep, error: epErr } = await qt.track('dep_check_ep', 'episodic_memories', () =>
          supabaseAdmin
            .from('episodic_memories')
            .select('id, user_id, is_archived')
            .eq('id', refId)
            .maybeSingle()
        );

        if (epErr || !ep) {
          report.provenanceComplete = false;
          report.unresolvedDependencies.push({
            type: refType,
            id: refId,
            reason: `MISSING_SOURCE:episodic_memory:${refId}`,
          });
          continue;
        }

        // Cross-user check
        if (ep.user_id !== userId) {
          report.provenanceComplete = false;
          report.unresolvedDependencies.push({
            type: refType,
            id: refId,
            reason: 'CROSS_USER_FORBIDDEN',
          });
          continue;
        }

        // Valid dependency
        report.resolvedDependencies.push({
          userId,
          trustedMemoryId: memory.id,
          trustedMemoryKey: memory.key,
          sourceType: 'episodic_memory',
          sourceId: refId,
          isSourceActive: !ep.is_archived,
          isValid: true,
          lockReason: `Provenance citation by active trusted memory '${memory.key}'`,
        });
      } else if (refType === 'working_memory') {
        const { data: wm, error: wmErr } = await qt.track('dep_check_wm', 'working_memory', () =>
          supabaseAdmin
            .from('working_memory')
            .select('id, user_id')
            .eq('id', refId)
            .maybeSingle()
        );

        if (wmErr || !wm) {
          report.provenanceComplete = false;
          report.unresolvedDependencies.push({
            type: refType,
            id: refId,
            reason: `MISSING_SOURCE:working_memory:${refId}`,
          });
          continue;
        }

        // Cross-user check
        if (wm.user_id !== userId) {
          report.provenanceComplete = false;
          report.unresolvedDependencies.push({
            type: refType,
            id: refId,
            reason: 'CROSS_USER_FORBIDDEN',
          });
          continue;
        }

        // Valid dependency
        report.resolvedDependencies.push({
          userId,
          trustedMemoryId: memory.id,
          trustedMemoryKey: memory.key,
          sourceType: 'working_memory',
          sourceId: refId,
          isSourceActive: true,
          isValid: true,
          lockReason: `Provenance citation by active trusted memory '${memory.key}'`,
        });
      } else if (refType === 'turn' || refType === 'chat_history' || refType === 'source_message') {
        const { data: turn, error: turnErr } = await qt.track('dep_check_turn', 'chat_history', () =>
          supabaseAdmin
            .from('chat_history')
            .select('id, user_id')
            .eq('id', refId)
            .maybeSingle()
        );

        if (turnErr || !turn) {
          report.provenanceComplete = false;
          report.unresolvedDependencies.push({
            type: 'turn',
            id: refId,
            reason: `MISSING_SOURCE:turn:${refId}`,
          });
          continue;
        }

        // Cross-user check
        if (turn.user_id !== userId) {
          report.provenanceComplete = false;
          report.unresolvedDependencies.push({
            type: 'turn',
            id: refId,
            reason: 'CROSS_USER_FORBIDDEN',
          });
          continue;
        }

        // Valid dependency
        report.resolvedDependencies.push({
          userId,
          trustedMemoryId: memory.id,
          trustedMemoryKey: memory.key,
          sourceType: 'turn',
          sourceId: refId,
          isSourceActive: true,
          isValid: true,
          lockReason: `Provenance citation by active trusted memory '${memory.key}'`,
        });
      } else {
        // Unrecognized source type
        report.provenanceComplete = false;
        report.unresolvedDependencies.push({
          type: refType,
          id: refId,
          reason: 'UNRECOGNIZED_TYPE',
        });
      }
    }

    report.dependencyCount = report.resolvedDependencies.length;
    if (!report.provenanceComplete && report.unresolvedDependencies.length > 0) {
      report.provenanceIncompleteReason = report.unresolvedDependencies
        .map(d => `${d.type}:${d.id}(${d.reason})`)
        .join(', ');
    }

    return report;
  }

  /**
   * Constructs an aggregated Map of active source locks for a user.
   * Key: `${sourceType}:${sourceId}` -> Array of active SourceDependencyLock objects.
   * ONLY active, trusted memories produce locks in this map.
   */
  async getActiveSourceLocksForUser(userId: string): Promise<Map<string, SourceDependencyLock[]>> {
    const lockMap = new Map<string, SourceDependencyLock[]>();
    if (!userId || !isValidUuid(userId)) return lockMap;

    const trustedMemories = await this.getActiveTrustedMemories(userId);

    for (const mem of trustedMemories) {
      const provReport = await this.resolveMemoryProvenance(userId, mem);
      for (const lock of provReport.resolvedDependencies) {
        const lockKey = `${lock.sourceType}:${lock.sourceId}`;
        if (!lockMap.has(lockKey)) {
          lockMap.set(lockKey, []);
        }
        lockMap.get(lockKey)!.push(lock);
      }
    }

    return lockMap;
  }

  /**
   * Hard Delete Guard: Answers "Can source X be permanently deleted?"
   *
   * Invariants:
   * - Returns `false` when any active, trusted memory depends on this source.
   * - Returns `true` ONLY when zero active trusted memories depend on it.
   * - Fails safe to `false` on any database error, missing parameter, or lookup exception.
   */
  async canPermanentlyDeleteSource(
    userId: string,
    sourceType: SourceDependencyType,
    sourceId: string
  ): Promise<boolean> {
    if (!userId || !sourceId || !isValidUuid(userId) || !isValidUuid(sourceId)) {
      // Defensive fail-safe: invalid input cannot be deleted
      return false;
    }

    try {
      // 1. Fetch active source locks for the specific user
      const locksMap = await this.getActiveSourceLocksForUser(userId);
      const lockKey = `${sourceType}:${sourceId}`;

      const activeLocks = locksMap.get(lockKey);
      if (activeLocks && activeLocks.length > 0) {
        logger.info('[SourceDependencyService] Deletion blocked by active provenance locks', {
          userId,
          sourceType,
          sourceId,
          lockCount: activeLocks.length,
          lockingMemories: activeLocks.map(l => l.trustedMemoryKey),
        });
        return false;
      }

      // No active trusted memory depends on this source -> safe to delete if platform allows
      return true;
    } catch (err: any) {
      // Fail-safe protection on error
      logger.error('[SourceDependencyService] Error evaluating deletion guard; failing safe to FALSE', {
        userId,
        sourceType,
        sourceId,
        error: err?.message,
      });
      return false;
    }
  }

  /**
   * Evaluates the conceptual source state:
   * - `PURGE_PROTECTED`: Referenced by an active trusted memory (cannot be physically deleted).
   * - `ARCHIVED_BUT_RECOVERABLE`: Soft archived in source table, recoverable on demand.
   * - `HOT`: Active and unarchived.
   */
  async evaluateSourceState(
    userId: string,
    sourceType: SourceDependencyType,
    sourceId: string,
    isArchived: boolean = false
  ): Promise<SourceLifecycleState> {
    const isDeletable = await this.canPermanentlyDeleteSource(userId, sourceType, sourceId);
    if (!isDeletable) {
      return 'PURGE_PROTECTED';
    }
    if (isArchived) {
      return 'ARCHIVED_BUT_RECOVERABLE';
    }
    return 'HOT';
  }
}

export const sourceDependencyService = new SourceDependencyService();
