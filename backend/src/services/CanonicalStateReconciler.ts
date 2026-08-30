/**
 * CanonicalStateReconciler.ts — Phase 2C Safe Deterministic Repair Engine
 *
 * ARCHITECTURAL INVARIANTS:
 * 1. SINGLE ENFORCEMENT GATEWAY: All Watchtower repairs MUST route through this reconciler.
 * 2. NO DIRECT CORE DB MUTATIONS: Only delegates mutations to existing canonical repositories:
 *    - memoryRepository
 *    - lifeThreadRepository
 *    - ReminderEngine
 *    - actionIntelligenceService
 * 3. AUTHORITY HIERARCHY: `watchtower_repair` (rank 3) NEVER overrides `explicit_user` or
 *    `deterministic_turn_analysis`, terminal-state protections, or newer turn sequences.
 * 4. SAFE REPAIR MATRIX (5 Approved Deterministic Repairs ONLY):
 *    - MEMORY_ALIAS_CANONICALIZATION (W-003)
 *    - GENERIC_RELATIONAL_NOISE (W-002)
 *    - DUPLICATE_REMINDER (W-005/duplicate)
 *    - ORPHANED_LIFE_THREAD_ACTION (W-009/dangling action)
 *    - EXPIRED_REMINDER_STATE (W-019/expired reminder)
 * 5. FORBIDDEN REPAIRS: Semantic mergers, conflicting family facts, account deletions, auth desync
 *    are strictly blocked and routed to HUMAN_REVIEW.
 * 6. NO-OP SAFETY: Pre-reads state. If invariant is already satisfied -> NO_OP_ALREADY_RESOLVED (0 core writes).
 * 7. STALE REPAIR PROTECTION: If expected_current_state does not match live state -> REPAIR_REJECTED_STALE (0 core writes).
 * 8. IDEMPOTENCY & LOOP PREVENTION: Deterministic fingerprinting; attempt_count >= 3 -> HUMAN_REVIEW.
 * 9. POST-CONDITION VERIFICATION: Re-evaluates invariant after operation.
 * 10. ZERO LLM CALLS: 100% deterministic execution.
 */

import { supabaseAdmin } from '../lib/supabase';
import { logger } from '../lib/logger';
import { qt } from '../lib/queryTracker';
import {
  RepairOrder,
  RepairOrderDraft,
  RepairExecutionResult,
  RepairOutcome,
  RepairType,
} from '../types/canonicalRepair';
import { generateRepairFingerprint } from '../lib/repairFingerprint';
import { memoryRepository } from './memoryRepository';
import { ReminderEngine } from './ReminderEngine';
import { actionIntelligenceService } from './ActionIntelligenceService';
import { canonicalizeKey } from '../lib/memoryKeySchema';

const GENERIC_RELATIONAL_NOUNS = new Set([
  'wife', 'husband', 'mom', 'mother', 'dad', 'father', 'bhai', 'brother',
  'sister', 'son', 'daughter', 'didi', 'bhabhi', 'nana', 'nani', 'dada',
  'dadi', 'spouse', 'partner', 'friend', 'yaar',
]);

const APPROVED_SAFE_REPAIRS = new Set<RepairType>([
  'MEMORY_ALIAS_CANONICALIZATION',
  'GENERIC_RELATIONAL_NOISE',
  'DUPLICATE_REMINDER',
  'ORPHANED_LIFE_THREAD_ACTION',
  'EXPIRED_REMINDER_STATE',
]);

export class CanonicalStateReconciler {
  /**
   * Submits and registers a new Repair Order in `nova_guardian_repairs`.
   * Reuses existing unresolved repair order if fingerprint matches (idempotency).
   */
  async submitRepairOrder(draft: RepairOrderDraft): Promise<RepairOrder | null> {
    try {
      // 1. Hard validation: Reject unapproved / forbidden repair types
      if (!APPROVED_SAFE_REPAIRS.has(draft.repairType)) {
        logger.warn('[CanonicalStateReconciler] Blocked unapproved repair type', {
          repairType: draft.repairType,
          userId: draft.userId,
        });
        return null;
      }

      const fingerprint = generateRepairFingerprint(
        draft.userId,
        draft.repairType,
        draft.targetEntityId,
        JSON.stringify(draft.proposedState)
      );

      // 2. Check for existing repair order by fingerprint
      const { data: existing } = await qt.track(
        'repair_check_existing',
        'nova_guardian_repairs',
        () =>
          supabaseAdmin
            .from('nova_guardian_repairs')
            .select('*')
            .eq('user_id', draft.userId)
            .eq('fingerprint', fingerprint)
            .maybeSingle()
      );

      if (existing) {
        return existing as RepairOrder;
      }

      // 3. Insert new repair order
      const { data: created, error } = await qt.track(
        'repair_create_order',
        'nova_guardian_repairs',
        () =>
          supabaseAdmin
            .from('nova_guardian_repairs')
            .insert({
              anomaly_id: draft.anomalyId || null,
              user_id: draft.userId,
              repair_type: draft.repairType,
              target_entity_id: draft.targetEntityId,
              expected_current_state: draft.expectedCurrentState || {},
              proposed_state: draft.proposedState || {},
              evidence: draft.evidence || {},
              authority: draft.authority || 'watchtower_repair',
              source_turn_id: draft.sourceTurnId || null,
              source_message_id: draft.sourceMessageId || null,
              source_message_seq: draft.sourceMessageSeq || null,
              status: 'pending',
              attempt_count: 0,
              fingerprint,
              created_at: new Date().toISOString(),
            })
            .select('*')
            .single()
      );

      if (error) {
        logger.error('[CanonicalStateReconciler] Failed to create repair order', { error: error.message });
        return null;
      }

      logger.info('[CanonicalStateReconciler] Repair order submitted', {
        repairId: created.id,
        repairType: draft.repairType,
        userId: draft.userId,
      });

      return created as RepairOrder;
    } catch (err: any) {
      logger.error('[CanonicalStateReconciler] submitRepairOrder error', { error: err?.message });
      return null;
    }
  }

  /**
   * Executes a Repair Order with strict safety, no-op checks, stale protection, and post-condition verification.
   */
  async executeRepair(repairId: string): Promise<RepairExecutionResult> {
    // 1. Fetch repair order
    const { data: order, error } = await qt.track(
      'repair_fetch_order',
      'nova_guardian_repairs',
      () =>
        supabaseAdmin
          .from('nova_guardian_repairs')
          .select('*')
          .eq('id', repairId)
          .single()
    );

    if (error || !order) {
      return {
        outcome: 'FAILED',
        repairId,
        repairType: 'MEMORY_ALIAS_CANONICALIZATION',
        verification: { verified: false, postConditionMet: false, notes: 'Repair order not found' },
        reason: 'Repair order not found',
      };
    }

    const typedOrder = order as RepairOrder;

    // 2. Loop Protection: Maximum 3 attempts
    if (typedOrder.attempt_count >= 3) {
      await this.updateRepairStatus(typedOrder.id, 'human_review', {
        errorMessage: 'Maximum repair attempt limit (3) exceeded — escalated to human review',
      });
      return {
        outcome: 'HUMAN_REVIEW',
        repairId: typedOrder.id,
        repairType: typedOrder.repair_type,
        verification: { verified: false, postConditionMet: false, notes: 'Loop protection triggered' },
        reason: 'Maximum repair attempt limit (3) reached',
      };
    }

    // Increment attempt count
    const nextAttempt = typedOrder.attempt_count + 1;
    await supabaseAdmin
      .from('nova_guardian_repairs')
      .update({
        attempt_count: nextAttempt,
        status: 'executing',
        executed_at: new Date().toISOString(),
      })
      .eq('id', typedOrder.id);

    try {
      // 3. Dispatch to specific safe repair handler
      let execResult: RepairExecutionResult;

      switch (typedOrder.repair_type) {
        case 'MEMORY_ALIAS_CANONICALIZATION':
          execResult = await this.handleMemoryAliasCanonicalization(typedOrder);
          break;
        case 'GENERIC_RELATIONAL_NOISE':
          execResult = await this.handleGenericRelationalNoise(typedOrder);
          break;
        case 'DUPLICATE_REMINDER':
          execResult = await this.handleDuplicateReminder(typedOrder);
          break;
        case 'ORPHANED_LIFE_THREAD_ACTION':
          execResult = await this.handleOrphanedAction(typedOrder);
          break;
        case 'EXPIRED_REMINDER_STATE':
          execResult = await this.handleExpiredReminder(typedOrder);
          break;
        default:
          execResult = {
            outcome: 'HUMAN_REVIEW',
            repairId: typedOrder.id,
            repairType: typedOrder.repair_type,
            verification: { verified: false, postConditionMet: false },
            reason: `Unsupported repair type: ${typedOrder.repair_type}`,
          };
      }

      // 4. Update repair record and anomaly record with outcome
      await this.finalizeRepairRecord(typedOrder, execResult);

      return execResult;
    } catch (err: any) {
      logger.error('[CanonicalStateReconciler] Unexpected error during execution', {
        repairId: typedOrder.id,
        error: err?.message,
      });

      const failedResult: RepairExecutionResult = {
        outcome: 'FAILED',
        repairId: typedOrder.id,
        repairType: typedOrder.repair_type,
        verification: { verified: false, postConditionMet: false, notes: err?.message },
        reason: `Unexpected execution error: ${err?.message}`,
      };

      await this.finalizeRepairRecord(typedOrder, failedResult);
      return failedResult;
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // SAFE REPAIR HANDLERS (A..E)
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * REPAIR A: MEMORY ALIAS CANONICALIZATION (W-003)
   * Example: mothers_name -> mother_name
   */
  private async handleMemoryAliasCanonicalization(order: RepairOrder): Promise<RepairExecutionResult> {
    const memoryId = order.target_entity_id;
    const userId = order.user_id;

    // 1. Pre-read state & User Isolation check
    const { data: currentMem } = await supabaseAdmin
      .from('memories')
      .select('id, user_id, key, value, source_authority, is_archived')
      .eq('id', memoryId)
      .maybeSingle();

    if (!currentMem) {
      return {
        outcome: 'NO_OP_ALREADY_RESOLVED',
        repairId: order.id,
        repairType: order.repair_type,
        verification: { verified: true, postConditionMet: true, notes: 'Target memory row no longer exists' },
        reason: 'Target memory row does not exist',
      };
    }

    // User Isolation Guard
    if (currentMem.user_id !== userId) {
      return {
        outcome: 'HUMAN_REVIEW',
        repairId: order.id,
        repairType: order.repair_type,
        verification: { verified: false, postConditionMet: false, notes: 'Ownership mismatch' },
        reason: 'Target memory user_id does not match repair order user_id',
      };
    }

    const { canonical, wasAliased } = canonicalizeKey(currentMem.key);

    // 2. No-Op Check: Already canonical?
    if (!wasAliased || currentMem.key === canonical) {
      return {
        outcome: 'NO_OP_ALREADY_RESOLVED',
        repairId: order.id,
        repairType: order.repair_type,
        beforeState: currentMem,
        afterState: currentMem,
        verification: { verified: true, postConditionMet: true, notes: 'Memory key is already canonical' },
        reason: 'Memory key is already canonical schema key',
      };
    }

    // 3. Stale Check: Does expected state match live non-canonical key?
    if (order.expected_current_state?.key && order.expected_current_state.key !== currentMem.key) {
      return {
        outcome: 'REPAIR_REJECTED_STALE',
        repairId: order.id,
        repairType: order.repair_type,
        beforeState: currentMem,
        verification: { verified: false, postConditionMet: false, notes: 'Memory key changed since detection' },
        reason: `Expected key '${order.expected_current_state.key}' does not match live key '${currentMem.key}'`,
      };
    }

    // 4. Conflict Check: Does canonical target already exist with higher authority?
    const { data: existingCanonical } = await supabaseAdmin
      .from('memories')
      .select('id, key, value, source_authority, is_archived')
      .eq('user_id', userId)
      .eq('key', canonical)
      .eq('is_archived', false)
      .maybeSingle();

    if (existingCanonical && existingCanonical.id !== memoryId) {
      // If higher authority fact exists or different value exists, do NOT overwrite
      if (existingCanonical.value !== currentMem.value) {
        return {
          outcome: 'HUMAN_REVIEW',
          repairId: order.id,
          repairType: order.repair_type,
          beforeState: currentMem,
          verification: { verified: false, postConditionMet: false, notes: 'Canonical key collision with distinct value' },
          reason: `Target canonical key '${canonical}' already exists with value '${existingCanonical.value}' (source: ${existingCanonical.source_authority})`,
        };
      }
      // If same value, archive the duplicate alias row
      await memoryRepository.archiveMemory(userId, memoryId, 'Watchtower duplicate alias consolidation');
    } else {
      // 5. Execute Canonical Key Update via memoryRepository
      const success = await memoryRepository.canonicalizeMemoryKey(userId, memoryId, currentMem.key, canonical);
      if (!success) {
        return {
          outcome: 'FAILED',
          repairId: order.id,
          repairType: order.repair_type,
          beforeState: currentMem,
          verification: { verified: false, postConditionMet: false },
          reason: 'memoryRepository.canonicalizeMemoryKey returned false',
        };
      }
    }

    // 6. Post-Condition Verification
    const { data: verifiedMem } = await supabaseAdmin
      .from('memories')
      .select('id, key, value, is_archived')
      .eq('id', memoryId)
      .single();

    const postConditionMet = verifiedMem?.key === canonical || verifiedMem?.is_archived === true;

    return {
      outcome: postConditionMet ? 'RESOLVED' : 'FAILED',
      repairId: order.id,
      repairType: order.repair_type,
      beforeState: currentMem,
      afterState: verifiedMem,
      verification: {
        verified: true,
        postConditionMet,
        details: { canonicalKey: canonical, finalKey: verifiedMem?.key, isArchived: verifiedMem?.is_archived },
      },
      reason: postConditionMet ? `Key canonicalized to '${canonical}'` : 'Post-condition verification failed',
    };
  }

  /**
   * REPAIR B: GENERIC RELATIONAL NOISE MEMORY (W-002)
   * Example: wife_name = "wife" -> archive
   */
  private async handleGenericRelationalNoise(order: RepairOrder): Promise<RepairExecutionResult> {
    const memoryId = order.target_entity_id;
    const userId = order.user_id;

    // 1. Pre-read state & User Isolation check
    const { data: currentMem } = await supabaseAdmin
      .from('memories')
      .select('id, user_id, key, value, source_authority, is_archived')
      .eq('id', memoryId)
      .maybeSingle();

    if (!currentMem || currentMem.is_archived) {
      return {
        outcome: 'NO_OP_ALREADY_RESOLVED',
        repairId: order.id,
        repairType: order.repair_type,
        verification: { verified: true, postConditionMet: true, notes: 'Memory already archived or removed' },
        reason: 'Target memory is already archived or does not exist',
      };
    }

    if (currentMem.user_id !== userId) {
      return {
        outcome: 'HUMAN_REVIEW',
        repairId: order.id,
        repairType: order.repair_type,
        verification: { verified: false, postConditionMet: false },
        reason: 'Target memory user_id does not match repair order user_id',
      };
    }

    // 2. Stale Check
    if (order.expected_current_state?.value && order.expected_current_state.value !== currentMem.value) {
      return {
        outcome: 'REPAIR_REJECTED_STALE',
        repairId: order.id,
        repairType: order.repair_type,
        beforeState: currentMem,
        verification: { verified: false, postConditionMet: false },
        reason: `Memory value changed from '${order.expected_current_state.value}' to '${currentMem.value}'`,
      };
    }

    // 3. Strict Invariant Check: Must be relational noun AND low authority
    const valLower = (currentMem.value || '').toLowerCase().trim();
    if (!GENERIC_RELATIONAL_NOUNS.has(valLower)) {
      return {
        outcome: 'NO_OP_ALREADY_RESOLVED',
        repairId: order.id,
        repairType: order.repair_type,
        beforeState: currentMem,
        verification: { verified: true, postConditionMet: true, notes: 'Value is not a generic relational noun' },
        reason: `Value '${currentMem.value}' is not in generic relational noun blocklist`,
      };
    }

    // Authority Guard: NEVER archive explicit user facts through automated repair
    if (currentMem.source_authority === 'explicit_user' || currentMem.source_authority === 'deterministic_turn_analysis') {
      return {
        outcome: 'HUMAN_REVIEW',
        repairId: order.id,
        repairType: order.repair_type,
        beforeState: currentMem,
        verification: { verified: false, postConditionMet: false, notes: 'Explicit user authority protected' },
        reason: `Memory has high authority '${currentMem.source_authority}', cannot auto-quarantine`,
      };
    }

    // 4. Execute Archive via memoryRepository
    const success = await memoryRepository.archiveMemory(
      userId,
      memoryId,
      'Watchtower W-002 generic relational noise quarantine'
    );

    if (!success) {
      return {
        outcome: 'FAILED',
        repairId: order.id,
        repairType: order.repair_type,
        beforeState: currentMem,
        verification: { verified: false, postConditionMet: false },
        reason: 'memoryRepository.archiveMemory failed',
      };
    }

    // 5. Post-Condition Verification
    const { data: verifiedMem } = await supabaseAdmin
      .from('memories')
      .select('id, is_archived')
      .eq('id', memoryId)
      .single();

    const postConditionMet = verifiedMem?.is_archived === true;

    return {
      outcome: postConditionMet ? 'RESOLVED' : 'FAILED',
      repairId: order.id,
      repairType: order.repair_type,
      beforeState: currentMem,
      afterState: verifiedMem,
      verification: {
        verified: true,
        postConditionMet,
        details: { isArchived: verifiedMem?.is_archived },
      },
      reason: postConditionMet ? 'Generic relational noise memory archived safely' : 'Verification failed: memory not archived',
    };
  }

  /**
   * REPAIR C: DUPLICATE REMINDER
   * If multiple active reminders have equivalent deterministic spec, retain earliest row, cancel duplicate.
   */
  private async handleDuplicateReminder(order: RepairOrder): Promise<RepairExecutionResult> {
    const duplicateReminderId = order.target_entity_id;
    const userId = order.user_id;

    // 1. Pre-read duplicate reminder
    const { data: dupRow } = await supabaseAdmin
      .from('reminders')
      .select('*')
      .eq('id', duplicateReminderId)
      .maybeSingle();

    if (!dupRow || dupRow.status === 'cancelled' || dupRow.status === 'completed') {
      return {
        outcome: 'NO_OP_ALREADY_RESOLVED',
        repairId: order.id,
        repairType: order.repair_type,
        verification: { verified: true, postConditionMet: true, notes: 'Duplicate reminder already inactive' },
        reason: 'Duplicate reminder is already cancelled or non-existent',
      };
    }

    if (dupRow.user_id !== userId) {
      return {
        outcome: 'HUMAN_REVIEW',
        repairId: order.id,
        repairType: order.repair_type,
        verification: { verified: false, postConditionMet: false },
        reason: 'Reminder user_id does not match repair order user_id',
      };
    }

    // 2. Pre-read primary reminder to ensure it exists and is active
    const primaryId = order.proposed_state?.primary_reminder_id;
    if (!primaryId) {
      return {
        outcome: 'HUMAN_REVIEW',
        repairId: order.id,
        repairType: order.repair_type,
        verification: { verified: false, postConditionMet: false },
        reason: 'Missing primary_reminder_id in repair proposed_state',
      };
    }

    const { data: primaryRow } = await supabaseAdmin
      .from('reminders')
      .select('*')
      .eq('id', primaryId)
      .eq('user_id', userId)
      .maybeSingle();

    if (!primaryRow || primaryRow.status !== 'active') {
      return {
        outcome: 'HUMAN_REVIEW',
        repairId: order.id,
        repairType: order.repair_type,
        verification: { verified: false, postConditionMet: false },
        reason: 'Primary canonical reminder is not active, cannot cancel duplicate',
      };
    }

    // 3. Cancel duplicate via ReminderEngine
    const engine = new ReminderEngine();
    const success = await engine.delete(userId, duplicateReminderId);

    if (!success) {
      return {
        outcome: 'FAILED',
        repairId: order.id,
        repairType: order.repair_type,
        beforeState: dupRow,
        verification: { verified: false, postConditionMet: false },
        reason: 'ReminderEngine.delete failed',
      };
    }

    // 4. Post-Condition Verification
    const { data: verifiedDup } = await supabaseAdmin
      .from('reminders')
      .select('id, status')
      .eq('id', duplicateReminderId)
      .single();

    const postConditionMet = verifiedDup?.status === 'cancelled';

    return {
      outcome: postConditionMet ? 'RESOLVED' : 'FAILED',
      repairId: order.id,
      repairType: order.repair_type,
      beforeState: dupRow,
      afterState: verifiedDup,
      verification: {
        verified: true,
        postConditionMet,
        details: { duplicateStatus: verifiedDup?.status, primaryId },
      },
      reason: postConditionMet ? 'Duplicate reminder cancelled, primary retained' : 'Verification failed: reminder not cancelled',
    };
  }

  /**
   * REPAIR D: ORPHANED LIFE THREAD ACTION (W-009)
   * If a completed/abandoned LifeThread has deterministically dangling actions, cancel those actions.
   */
  private async handleOrphanedAction(order: RepairOrder): Promise<RepairExecutionResult> {
    const actionId = order.target_entity_id;
    const userId = order.user_id;

    // 1. Pre-read action
    const { data: action } = await supabaseAdmin
      .from('nova_actions')
      .select('*')
      .eq('id', actionId)
      .maybeSingle();

    if (!action || action.state === 'cancelled' || action.state === 'completed') {
      return {
        outcome: 'NO_OP_ALREADY_RESOLVED',
        repairId: order.id,
        repairType: order.repair_type,
        verification: { verified: true, postConditionMet: true, notes: 'Action already terminal' },
        reason: 'Action is already in terminal state or does not exist',
      };
    }

    if (action.user_id !== userId) {
      return {
        outcome: 'HUMAN_REVIEW',
        repairId: order.id,
        repairType: order.repair_type,
        verification: { verified: false, postConditionMet: false },
        reason: 'Action user_id does not match repair order user_id',
      };
    }

    // 2. Verify source LifeThread is indeed terminal
    if (!action.source_thread_id) {
      return {
        outcome: 'NO_OP_ALREADY_RESOLVED',
        repairId: order.id,
        repairType: order.repair_type,
        verification: { verified: true, postConditionMet: true },
        reason: 'Action has no source_thread_id',
      };
    }

    const { data: thread } = await supabaseAdmin
      .from('life_threads')
      .select('id, state')
      .eq('id', action.source_thread_id)
      .eq('user_id', userId)
      .maybeSingle();

    if (!thread || (thread.state !== 'completed' && thread.state !== 'abandoned')) {
      return {
        outcome: 'NO_OP_ALREADY_RESOLVED',
        repairId: order.id,
        repairType: order.repair_type,
        verification: { verified: true, postConditionMet: true },
        reason: 'Parent LifeThread is not terminal; action is legitimate',
      };
    }

    // 3. Cancel Action via actionIntelligenceService (LifeThread remains untouched)
    const success = await actionIntelligenceService.cancelAction(
      userId,
      actionId,
      'Watchtower orphaned action cleanup for terminal LifeThread'
    );

    if (!success) {
      return {
        outcome: 'FAILED',
        repairId: order.id,
        repairType: order.repair_type,
        beforeState: action,
        verification: { verified: false, postConditionMet: false },
        reason: 'actionIntelligenceService.cancelAction failed',
      };
    }

    // 4. Post-Condition Verification
    const { data: verifiedAction } = await supabaseAdmin
      .from('nova_actions')
      .select('id, state')
      .eq('id', actionId)
      .single();

    const postConditionMet = verifiedAction?.state === 'cancelled';

    return {
      outcome: postConditionMet ? 'RESOLVED' : 'FAILED',
      repairId: order.id,
      repairType: order.repair_type,
      beforeState: action,
      afterState: verifiedAction,
      verification: {
        verified: true,
        postConditionMet,
        details: { actionState: verifiedAction?.state, threadState: thread.state },
      },
      reason: postConditionMet ? 'Orphaned action cancelled cleanly' : 'Verification failed: action not cancelled',
    };
  }

  /**
   * REPAIR E: EXPIRED DETERMINISTIC REMINDER STATE (W-019)
   * If reminder trigger_at < now - 24h and status == 'active', transition to expired.
   */
  private async handleExpiredReminder(order: RepairOrder): Promise<RepairExecutionResult> {
    const reminderId = order.target_entity_id;
    const userId = order.user_id;

    // 1. Pre-read reminder
    const { data: reminder } = await supabaseAdmin
      .from('reminders')
      .select('*')
      .eq('id', reminderId)
      .maybeSingle();

    if (!reminder || reminder.status !== 'active') {
      return {
        outcome: 'NO_OP_ALREADY_RESOLVED',
        repairId: order.id,
        repairType: order.repair_type,
        verification: { verified: true, postConditionMet: true, notes: 'Reminder already inactive' },
        reason: 'Reminder is already inactive or does not exist',
      };
    }

    if (reminder.user_id !== userId) {
      return {
        outcome: 'HUMAN_REVIEW',
        repairId: order.id,
        repairType: order.repair_type,
        verification: { verified: false, postConditionMet: false },
        reason: 'Reminder user_id does not match repair order user_id',
      };
    }

    // 2. Deterministic Expiration Invariant Check
    if (!reminder.trigger_at) {
      return {
        outcome: 'NO_OP_ALREADY_RESOLVED',
        repairId: order.id,
        repairType: order.repair_type,
        verification: { verified: true, postConditionMet: true },
        reason: 'Event-triggered reminder has no fixed trigger_at timestamp',
      };
    }

    const triggerMs = new Date(reminder.trigger_at).getTime();
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    if (triggerMs > oneDayAgo) {
      return {
        outcome: 'NO_OP_ALREADY_RESOLVED',
        repairId: order.id,
        repairType: order.repair_type,
        beforeState: reminder,
        verification: { verified: true, postConditionMet: true },
        reason: 'Reminder trigger_at is not older than 24 hours',
      };
    }

    // 3. Expire reminder via ReminderEngine
    const engine = new ReminderEngine();
    const success = await engine.expireReminder(userId, reminderId);

    if (!success) {
      return {
        outcome: 'FAILED',
        repairId: order.id,
        repairType: order.repair_type,
        beforeState: reminder,
        verification: { verified: false, postConditionMet: false },
        reason: 'ReminderEngine.expireReminder failed',
      };
    }

    // 4. Post-Condition Verification
    const { data: verifiedReminder } = await supabaseAdmin
      .from('reminders')
      .select('id, status')
      .eq('id', reminderId)
      .single();

    const postConditionMet = verifiedReminder?.status === 'expired' || verifiedReminder?.status === 'completed';

    return {
      outcome: postConditionMet ? 'RESOLVED' : 'FAILED',
      repairId: order.id,
      repairType: order.repair_type,
      beforeState: reminder,
      afterState: verifiedReminder,
      verification: {
        verified: true,
        postConditionMet,
        details: { finalStatus: verifiedReminder?.status },
      },
      reason: postConditionMet ? 'Expired reminder status updated safely' : 'Verification failed: status not updated',
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // HELPER METHODS
  // ══════════════════════════════════════════════════════════════════════════

  private async updateRepairStatus(
    repairId: string,
    status: string,
    extra: { errorMessage?: string; result?: any }
  ): Promise<void> {
    await supabaseAdmin
      .from('nova_guardian_repairs')
      .update({
        status,
        error_message: extra.errorMessage || null,
        verification_result: extra.result || null,
        resolved_at: status === 'resolved' || status === 'no_op_resolved' ? new Date().toISOString() : null,
      })
      .eq('id', repairId);
  }

  private async finalizeRepairRecord(
    order: RepairOrder,
    result: RepairExecutionResult
  ): Promise<void> {
    const statusMap: Record<RepairOutcome, string> = {
      RESOLVED: 'resolved',
      NO_OP_ALREADY_RESOLVED: 'no_op_resolved',
      REPAIR_REJECTED_STALE: 'rejected_stale',
      FAILED: 'failed',
      HUMAN_REVIEW: 'human_review',
    };

    const finalStatus = statusMap[result.outcome] || 'failed';

    await supabaseAdmin
      .from('nova_guardian_repairs')
      .update({
        status: finalStatus,
        before_state: result.beforeState || null,
        after_state: result.afterState || null,
        verification_result: result.verification,
        error_message: result.outcome === 'FAILED' || result.outcome === 'HUMAN_REVIEW' ? result.reason : null,
        resolved_at: finalStatus === 'resolved' || finalStatus === 'no_op_resolved' ? new Date().toISOString() : null,
      })
      .eq('id', order.id);

    // If linked to an anomaly, update anomaly record status too
    if (order.anomaly_id) {
      await supabaseAdmin
        .from('nova_guardian_anomalies')
        .update({
          status: finalStatus === 'resolved' || finalStatus === 'no_op_resolved' ? 'resolved' : finalStatus,
          resolved_at: finalStatus === 'resolved' || finalStatus === 'no_op_resolved' ? new Date().toISOString() : null,
          repair_attempts: order.attempt_count + 1,
        })
        .eq('id', order.anomaly_id);
    }
  }
}

export const canonicalStateReconciler = new CanonicalStateReconciler();
