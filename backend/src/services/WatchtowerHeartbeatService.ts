/**
 * WatchtowerHeartbeatService.ts — Watchtower Phase 3A Supervisory Heartbeat Layer
 *
 * ARCHITECTURAL INVARIANTS:
 * 1. SUPERVISORY ONLY: Coordinates existing subsystems (DeterministicGuardian, SemanticGuardian,
 *    CognitiveDoubtService, CanonicalStateReconciler, MemoryRetentionEngine, AccountLifecycleService).
 * 2. DATABASE-BACKED LEASE: Deterministic window runs with distributed lease locking to prevent duplicate workers.
 * 3. DETERMINISTIC FIRST: 0 LLM calls on clean heartbeat runs; semantic model invoked ONLY on escalation.
 * 4. NO DIRECT CORE MUTATIONS: 0 physical deletes, 0 bypasses of MemoryRepository, LifeThreadRepository,
 *    CognitiveDoubtService, CanonicalStateReconciler, or AccountLifecycleService.
 * 5. BOUNDED EXECUTION: Strict caps on users per heartbeat (MAX_USERS_PER_HEARTBEAT = 20) and work per user.
 * 6. NO CONSCIOUSNESS THEATER: Structured signals only (no fake internal monologues).
 * 7. RETENTION IS DRY-RUN ONLY: Never enables destructive memory fading or pruning.
 */

import crypto from 'crypto';
import { supabaseAdmin } from '../lib/supabase';
import { logger } from '../lib/logger';
import { qt } from '../lib/queryTracker';
import { deterministicGuardian } from './DeterministicGuardianService';
import { semanticGuardianService } from './SemanticGuardianService';
import { cognitiveDoubtService } from './CognitiveDoubtService';
import { canonicalStateReconciler } from './CanonicalStateReconciler';
import { memoryRetentionEngine } from './MemoryRetentionEngine';
import { sourceDependencyService } from './SourceDependencyService';
import { RepairType } from '../types/canonicalRepair';
import {
  HeartbeatLeaseAcquireResult,
  HeartbeatUserMetrics,
  WatchtowerHeartbeatSummary,
  WatchtowerCognitiveSignal,
  WATCHTOWER_HEARTBEAT_LIMITS,
} from '../types/watchtowerHeartbeat';

/**
 * Derives a deterministic window ID based on 15-minute time slots.
 * Example: 'watchtower:2026-08-31:13:00'
 */
export function deriveHeartbeatWindowId(timestampMs: number = Date.now()): string {
  const date = new Date(timestampMs);
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const hh = String(date.getUTCHours()).padStart(2, '0');
  const minuteSlot = Math.floor(date.getUTCMinutes() / 15) * 15;
  const minStr = String(minuteSlot).padStart(2, '0');
  return `watchtower:${yyyy}-${mm}-${dd}:${hh}:${minStr}`;
}

/**
 * Computes a deterministic SHA-256 fingerprint for a cognitive signal.
 */
export function generateSignalFingerprint(
  userId: string,
  signalType: string,
  category: string,
  entity: string,
  evidence: Record<string, any>
): string {
  const normUser = (userId || '').trim().toLowerCase();
  const normType = (signalType || '').trim().toLowerCase();
  const normCat = (category || '').trim().toLowerCase();
  const normEntity = (entity || '').trim().toLowerCase();
  
  // Stable evidence serialization
  const keys = Object.keys(evidence || {}).sort();
  const sortedEvidence: Record<string, any> = {};
  for (const k of keys) {
    sortedEvidence[k] = evidence[k];
  }
  const evidenceHash = crypto.createHash('sha256').update(JSON.stringify(sortedEvidence)).digest('hex');

  const payload = `${normUser}|${normType}|${normCat}|${normEntity}|${evidenceHash}`;
  return crypto.createHash('sha256').update(payload).digest('hex');
}

export class WatchtowerHeartbeatService {
  private workerInstanceId: string;

  constructor() {
    this.workerInstanceId = process.env.RENDER_INSTANCE_ID || `worker_${process.pid}_${Math.random().toString(36).substring(2, 8)}`;
  }

  /**
   * Attempts to acquire a distributed, database-backed lease for a heartbeat window.
   */
  async acquireLease(windowTimestampMs: number = Date.now()): Promise<HeartbeatLeaseAcquireResult> {
    const runId = deriveHeartbeatWindowId(windowTimestampMs);
    const leaseUntil = new Date(Date.now() + WATCHTOWER_HEARTBEAT_LIMITS.LEASE_DURATION_MS).toISOString();

    try {
      // 1. Check existing run record
      const { data: existingRun, error: fetchErr } = await qt.track(
        'watchtower_lease_check',
        'watchtower_heartbeat_runs',
        () =>
          supabaseAdmin
            .from('watchtower_heartbeat_runs')
            .select('id, status, lease_owner, lease_until')
            .eq('id', runId)
            .maybeSingle()
      );

      if (fetchErr) {
        logger.warn('[WatchtowerHeartbeat] Error checking existing lease run', { runId, error: fetchErr.message });
      }

      if (existingRun) {
        // Run already completed
        if (existingRun.status === 'COMPLETED') {
          return {
            acquired: false,
            runId,
            leaseOwner: existingRun.lease_owner,
            reason: 'ALREADY_COMPLETED',
          };
        }

        // Active lease check
        const isLeaseActive = new Date(existingRun.lease_until).getTime() > Date.now();
        if (isLeaseActive && (existingRun.status === 'RUNNING' || existingRun.status === 'STARTED')) {
          return {
            acquired: false,
            runId,
            leaseOwner: existingRun.lease_owner,
            reason: 'ALREADY_RUNNING',
          };
        }

        // Lease expired or previous run failed — claim lease recovery
        const { error: updateErr } = await qt.track(
          'watchtower_lease_recover',
          'watchtower_heartbeat_runs',
          () =>
            supabaseAdmin
              .from('watchtower_heartbeat_runs')
              .update({
                lease_owner: this.workerInstanceId,
                lease_until: leaseUntil,
                status: 'RUNNING',
              })
              .eq('id', runId)
        );

        if (updateErr) {
          logger.warn('[WatchtowerHeartbeat] Failed to claim expired lease', { runId, error: updateErr.message });
          return { acquired: false, runId, leaseOwner: existingRun.lease_owner, reason: 'LEASE_CLAIM_FAILED' };
        }

        logger.info('[WatchtowerHeartbeat] Successfully recovered expired lease', { runId, worker: this.workerInstanceId });
        return { acquired: true, runId, leaseOwner: this.workerInstanceId, leaseUntil };
      }

      // 2. Insert fresh run record
      const { error: insertErr } = await qt.track(
        'watchtower_lease_insert',
        'watchtower_heartbeat_runs',
        () =>
          supabaseAdmin
            .from('watchtower_heartbeat_runs')
            .insert({
              id: runId,
              status: 'STARTED',
              lease_owner: this.workerInstanceId,
              lease_until: leaseUntil,
              started_at: new Date().toISOString(),
              total_users_scanned: 0,
              observations_count: 0,
              anomalies_count: 0,
              doubts_count: 0,
              repairs_queued: 0,
              semantic_escalations: 0,
            })
      );

      if (insertErr) {
        // Unique constraint race condition: another worker inserted simultaneously
        logger.info('[WatchtowerHeartbeat] Concurrency race detected on lease insert', { runId, error: insertErr.message });
        return { acquired: false, runId, leaseOwner: 'concurrent_worker', reason: 'ALREADY_RUNNING' };
      }

      return { acquired: true, runId, leaseOwner: this.workerInstanceId, leaseUntil };
    } catch (err: any) {
      logger.error('[WatchtowerHeartbeat] Exception acquiring lease', { runId, error: err?.message });
      return { acquired: false, runId, leaseOwner: this.workerInstanceId, reason: `EXCEPTION: ${err?.message}` };
    }
  }

  /**
   * Executes the full Watchtower Heartbeat cycle.
   */
  async executeHeartbeat(options?: {
    forcedWindowId?: string;
    targetUserId?: string;
    dryRun?: boolean;
    skipLease?: boolean;
  }): Promise<WatchtowerHeartbeatSummary> {
    const startedAt = Date.now();
    const runId = options?.forcedWindowId || deriveHeartbeatWindowId(startedAt);

    let leaseAcquired = false;
    let leaseOwner = this.workerInstanceId;

    if (!options?.skipLease) {
      const leaseRes = await this.acquireLease(startedAt);
      if (!leaseRes.acquired) {
        logger.info('[WatchtowerHeartbeat] Heartbeat pulse skipped (lease not acquired)', { runId, reason: leaseRes.reason });
        return {
          runId,
          status: leaseRes.reason === 'ALREADY_COMPLETED' ? 'COMPLETED' : 'PARTIAL',
          leaseOwner: leaseRes.leaseOwner,
          startedAt: new Date(startedAt).toISOString(),
          completedAt: new Date().toISOString(),
          totalUsersScanned: 0,
          observationsCount: 0,
          anomaliesCount: 0,
          doubtsCount: 0,
          repairsQueued: 0,
          semanticEscalations: 0,
          llmCalls: 0,
          durationMs: Date.now() - startedAt,
          userMetrics: [],
          error: leaseRes.reason,
        };
      }
      leaseAcquired = true;
      leaseOwner = leaseRes.leaseOwner;
    }

    logger.info('[WatchtowerHeartbeat] Starting supervisory heartbeat pulse', { runId, leaseOwner });

    // Update status to RUNNING
    if (leaseAcquired) {
      await qt.track('watchtower_status_running', 'watchtower_heartbeat_runs', () =>
        supabaseAdmin
          .from('watchtower_heartbeat_runs')
          .update({ status: 'RUNNING' })
          .eq('id', runId)
      );
    }

    const summary: WatchtowerHeartbeatSummary = {
      runId,
      status: 'RUNNING',
      leaseOwner,
      startedAt: new Date(startedAt).toISOString(),
      totalUsersScanned: 0,
      observationsCount: 0,
      anomaliesCount: 0,
      doubtsCount: 0,
      repairsQueued: 0,
      semanticEscalations: 0,
      llmCalls: 0,
      durationMs: 0,
      userMetrics: [],
    };

    try {
      // 1. Fetch bounded batch of active users
      let candidateUserIds: string[] = [];

      if (options?.targetUserId) {
        candidateUserIds = [options.targetUserId];
      } else {
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
        const { data: activeUsers, error: userFetchErr } = await qt.track(
          'watchtower_fetch_users',
          'chat_history',
          () =>
            supabaseAdmin
              .from('chat_history')
              .select('user_id')
              .gte('created_at', sevenDaysAgo)
              .order('created_at', { ascending: false })
              .limit(WATCHTOWER_HEARTBEAT_LIMITS.MAX_USERS_PER_HEARTBEAT * 2)
        );

        if (userFetchErr) {
          logger.warn('[WatchtowerHeartbeat] Active user query fallback to profiles', { error: userFetchErr.message });
          const { data: profileUsers } = await qt.track(
            'watchtower_fallback_profiles',
            'profiles',
            () =>
              supabaseAdmin
                .from('profiles')
                .select('id')
                .limit(WATCHTOWER_HEARTBEAT_LIMITS.MAX_USERS_PER_HEARTBEAT)
          );
          candidateUserIds = (profileUsers || []).map((p: any) => p.id);
        } else {
          const rawIds = (activeUsers || []).map((u: any) => u.user_id);
          candidateUserIds = [...new Set(rawIds)].slice(0, WATCHTOWER_HEARTBEAT_LIMITS.MAX_USERS_PER_HEARTBEAT);
        }
      }

      summary.totalUsersScanned = candidateUserIds.length;

      // 2. Process each user with bounded execution and strict caps
      for (const userId of candidateUserIds) {
        const userMetric = await this.processUserObservation(userId, options);
        summary.userMetrics.push(userMetric);
        summary.observationsCount += userMetric.observationsCount;
        summary.anomaliesCount += userMetric.anomaliesDetected;
        summary.doubtsCount += userMetric.doubtsCreated;
        summary.repairsQueued += userMetric.repairsQueued;
        summary.semanticEscalations += userMetric.semanticEscalations;
        if (userMetric.semanticEscalations > 0) {
          summary.llmCalls += userMetric.semanticEscalations;
        }
      }

      // 3. Expire old cognitive signals
      await this.expireStaleSignals();

      // 4. Complete run and record telemetry
      summary.status = 'COMPLETED';
      summary.completedAt = new Date().toISOString();
      summary.durationMs = Date.now() - startedAt;

      if (leaseAcquired) {
        await qt.track('watchtower_status_complete', 'watchtower_heartbeat_runs', () =>
          supabaseAdmin
            .from('watchtower_heartbeat_runs')
            .update({
              status: 'COMPLETED',
              completed_at: summary.completedAt,
              total_users_scanned: summary.totalUsersScanned,
              observations_count: summary.observationsCount,
              anomalies_count: summary.anomaliesCount,
              doubts_count: summary.doubtsCount,
              repairs_queued: summary.repairsQueued,
              semantic_escalations: summary.semanticEscalations,
              duration_ms: summary.durationMs,
              metadata: {
                llmCalls: summary.llmCalls,
                userCount: summary.userMetrics.length,
              },
            })
            .eq('id', runId)
        );
      }

      logger.info('[WatchtowerHeartbeat] Heartbeat completed successfully', {
        runId,
        users: summary.totalUsersScanned,
        anomalies: summary.anomaliesCount,
        doubts: summary.doubtsCount,
        repairs: summary.repairsQueued,
        semanticEscalations: summary.semanticEscalations,
        durationMs: summary.durationMs,
      });

      return summary;
    } catch (err: any) {
      logger.error('[WatchtowerHeartbeat] Heartbeat pulse failed with error', { runId, error: err?.message });
      summary.status = 'FAILED';
      summary.completedAt = new Date().toISOString();
      summary.durationMs = Date.now() - startedAt;
      summary.error = err?.message;

      if (leaseAcquired) {
        await qt.track('watchtower_status_failed', 'watchtower_heartbeat_runs', () =>
          supabaseAdmin
            .from('watchtower_heartbeat_runs')
            .update({
              status: 'FAILED',
              completed_at: summary.completedAt,
              duration_ms: summary.durationMs,
              metadata: { error: err?.message },
            })
            .eq('id', runId)
        );
      }

      return summary;
    }
  }

  /**
   * Processes observation, classification, and bounded delegation for a single user.
   */
  private async processUserObservation(
    userId: string,
    options?: { dryRun?: boolean }
  ): Promise<HeartbeatUserMetrics> {
    const userStart = Date.now();
    const metrics: HeartbeatUserMetrics = {
      userId,
      observationsCount: 0,
      anomaliesDetected: 0,
      doubtsCreated: 0,
      repairsQueued: 0,
      semanticEscalations: 0,
      signalsCreated: 0,
      durationMs: 0,
      status: 'completed',
    };

    try {
      // ── STEP 1: OBSERVE & DETECT (Deterministic Guardian First) ──────────
      // Evaluates W-series deterministic invariants with 0 LLM calls
      const anomalyDrafts = await deterministicGuardian.runAllDetectorsForUser(userId);
      metrics.observationsCount += 18; // 18 user-scoped detector rules evaluated
      metrics.anomaliesDetected = anomalyDrafts.length;

      // ── STEP 2: CLASSIFY & DELEGATE (Safe Canonical Repairs & Signals) ────
      for (const draft of anomalyDrafts) {
        // Enforce per-user anomaly limits
        if (metrics.anomaliesDetected > WATCHTOWER_HEARTBEAT_LIMITS.MAX_GUARDIAN_ANOMALIES_PER_USER) {
          metrics.status = 'partial';
          break;
        }

        // A. Check for deterministic safe repair candidacy
        const repairType = this.mapAnomalyToRepairType(draft.anomalyCode);
        if (repairType && !options?.dryRun) {
          try {
            const repairOrder = await canonicalStateReconciler.submitRepairOrder({
              userId,
              repairType,
              targetEntityId: draft.targetEntityId,
              expectedCurrentState: draft.evidence || {},
              proposedState: {},
              evidence: draft.evidence || {},
            });
            if (repairOrder) {
              metrics.repairsQueued += 1;
              await canonicalStateReconciler.executeRepair(repairOrder.id);
            }
          } catch (repErr: any) {
            logger.warn('[WatchtowerHeartbeat] Repair delegation error (non-fatal)', { userId, error: repErr?.message });
          }
        }

        // B. Generate structured supervisory cognitive signal
        const signal: WatchtowerCognitiveSignal = {
          userId,
          signalType: `guardian_${draft.anomalyCode}`,
          category: this.mapAnomalyToSignalCategory(draft.anomalyCode),
          severity: draft.severity,
          entity: draft.targetEntityId,
          evidence: draft.evidence,
          missing: [],
          requiredAction: this.mapAnomalyToRequiredAction(draft.anomalyCode),
        };

        if (!options?.dryRun) {
          const created = await this.upsertCognitiveSignal(signal);
          if (created) metrics.signalsCreated += 1;
        }
      }

      // ── STEP 3: SEMANTIC ESCALATION (Ambiguity Only — Rate Limited) ──────
      // Only escalate to SemanticGuardian if an anomaly explicitly demands semantic reasoning
      // (e.g. conflicting high-importance facts or ambiguous entity resolution)
      const ambiguousAnomalies = anomalyDrafts.filter(
        a => a.anomalyCode === 'W-003' && a.evidence?.hasConflictingValues === true
      );

      for (const amb of ambiguousAnomalies) {
        metrics.semanticEscalations += 1;
        try {
          const semanticResult = await semanticGuardianService.evaluateSemanticConsistency({
            userId,
            anomalyCode: 'S-001',
            entityKey: amb.targetEntityId,
            targetEntityId: amb.targetEntityId,
            recentRelevantTurns: [],
            canonicalMemories: [],
            relevantLifeThreads: [],
            relevantReminders: [],
            contextBudgetTokensEstimate: 200,
          });

          if (semanticResult.outcome === 'cognitive_doubt' && semanticResult.proposed_question) {
            // Delegate doubt creation to CognitiveDoubtService
            if (!options?.dryRun) {
              const doubtRes = await cognitiveDoubtService.createOrUpdateDoubt({
                userId,
                category: semanticResult.doubt_category || 'contradiction_ambiguity',
                question: semanticResult.proposed_question,
                evidence: amb.evidence,
                confidence: semanticResult.confidence,
                urgency: 'medium',
                priority: 'NEXT',
              });
              if (doubtRes) metrics.doubtsCreated += 1;
            }
          }
        } catch (semErr: any) {
          logger.warn('[WatchtowerHeartbeat] Semantic escalation non-fatal error', { userId, error: semErr?.message });
        }
      }

      // ── STEP 4: RETENTION INSPECTION (Dry-Run / Proposal Only) ───────────
      // Heartbeat evaluates retention in dry-run mode (0 physical deletes)
      try {
        await memoryRetentionEngine.evaluateUserRetentionBatch(userId);
      } catch (retErr: any) {
        logger.debug('[WatchtowerHeartbeat] Retention evaluation non-fatal error', { userId, error: retErr?.message });
      }

      // ── STEP 5: PROVENANCE PROTECTION CHECK ──────────────────────────────
      // Verifies source dependency protection without mutating records
      try {
        await sourceDependencyService.canPermanentlyDeleteSource(userId, 'episodic_memory', 'audit_check_id');
      } catch (srcErr: any) {
        logger.debug('[WatchtowerHeartbeat] Source dependency check non-fatal error', { userId, error: srcErr?.message });
      }

      metrics.durationMs = Date.now() - userStart;
      return metrics;
    } catch (err: any) {
      logger.warn('[WatchtowerHeartbeat] User observation error', { userId, error: err?.message });
      metrics.status = 'failed';
      metrics.error = err?.message;
      metrics.durationMs = Date.now() - userStart;
      return metrics;
    }
  }

  /**
   * Creates or updates a structured supervisory cognitive signal.
   * Guarantees deduplication via deterministic fingerprinting.
   */
  async upsertCognitiveSignal(signal: WatchtowerCognitiveSignal): Promise<boolean> {
    if (!signal.userId || !signal.signalType || !signal.category) return false;

    try {
      const fingerprint = signal.fingerprint || generateSignalFingerprint(
        signal.userId,
        signal.signalType,
        signal.category,
        signal.entity,
        signal.evidence
      );

      const ttlHours = WATCHTOWER_HEARTBEAT_LIMITS.SIGNAL_DEFAULT_TTL_HOURS;
      const expiresAt = signal.expiresAt || new Date(Date.now() + ttlHours * 60 * 60 * 1000).toISOString();

      const { data, error } = await qt.track(
        'watchtower_upsert_signal',
        'watchtower_cognitive_signals',
        () =>
          supabaseAdmin
            .from('watchtower_cognitive_signals')
            .upsert(
              {
                user_id: signal.userId,
                signal_type: signal.signalType,
                category: signal.category,
                severity: signal.severity,
                entity: signal.entity,
                evidence: signal.evidence || {},
                missing: signal.missing || [],
                required_action: signal.requiredAction,
                fingerprint,
                status: signal.status || 'active',
                expires_at: expiresAt,
              },
              { onConflict: 'user_id, fingerprint' }
            )
            .select('id')
      );

      if (error) {
        logger.warn('[WatchtowerHeartbeat] Failed to upsert cognitive signal', {
          userId: signal.userId,
          fingerprint,
          error: error.message,
        });
        return false;
      }

      return (data || []).length > 0;
    } catch (err: any) {
      logger.error('[WatchtowerHeartbeat] Exception upserting signal', { userId: signal.userId, error: err?.message });
      return false;
    }
  }

  /**
   * Fetches active, unexpired supervisory signals for a user.
   */
  async getActiveSignals(userId: string): Promise<WatchtowerCognitiveSignal[]> {
    if (!userId) return [];

    try {
      const now = new Date().toISOString();
      const { data, error } = await qt.track(
        'watchtower_get_signals',
        'watchtower_cognitive_signals',
        () =>
          supabaseAdmin
            .from('watchtower_cognitive_signals')
            .select('*')
            .eq('user_id', userId)
            .eq('status', 'active')
            .gt('expires_at', now)
            .order('created_at', { ascending: false })
            .limit(10)
      );

      if (error || !data) return [];
      return data as WatchtowerCognitiveSignal[];
    } catch (err: any) {
      logger.warn('[WatchtowerHeartbeat] Error fetching active signals', { userId, error: err?.message });
      return [];
    }
  }

  /**
   * Marks expired cognitive signals as 'expired'.
   */
  async expireStaleSignals(): Promise<number> {
    try {
      const now = new Date().toISOString();
      const { data, error } = await qt.track(
        'watchtower_expire_signals',
        'watchtower_cognitive_signals',
        () =>
          supabaseAdmin
            .from('watchtower_cognitive_signals')
            .update({ status: 'expired' })
            .eq('status', 'active')
            .lte('expires_at', now)
            .select('id')
      );

      if (error || !data) return 0;
      return data.length;
    } catch (err: any) {
      logger.warn('[WatchtowerHeartbeat] Error expiring signals', { error: err?.message });
      return 0;
    }
  }

  private mapAnomalyToSignalCategory(code: string): WatchtowerCognitiveSignal['category'] {
    switch (code) {
      case 'W-001':
      case 'W-002':
      case 'W-003':
        return 'contradiction';
      case 'W-006':
      case 'W-017':
      case 'W-019':
        return 'stale_state';
      case 'W-007':
      case 'W-014':
      case 'W-021':
        return 'provenance_gap';
      default:
        return 'uncertainty';
    }
  }

  private mapAnomalyToRequiredAction(code: string): string {
    switch (code) {
      case 'W-003':
        return 'reconcile_canonical_key';
      case 'W-010':
        return 'verify_reminder_persistence';
      case 'W-017':
        return 'release_stale_followup_lock';
      case 'W-019':
        return 'archive_expired_reminder';
      default:
        return 'clarify_if_relevant';
    }
  }

  private mapAnomalyToRepairType(code: string): RepairType | null {
    switch (code) {
      case 'W-003':
        return 'MEMORY_ALIAS_CANONICALIZATION';
      case 'W-002':
        return 'GENERIC_RELATIONAL_NOISE';
      case 'W-010':
      case 'W-019':
        return 'EXPIRED_REMINDER_STATE';
      default:
        return null;
    }
  }
}

export const watchtowerHeartbeatService = new WatchtowerHeartbeatService();
