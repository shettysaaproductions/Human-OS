/**
 * DeterministicGuardianService.ts — Watchtower Phase 2A Deterministic Guardian
 *
 * ARCHITECTURAL INVARIANTS:
 * 1. READ-ONLY ON CORE STATE: Never updates, deletes, or mutates memories, life_threads,
 *    reminders, or chat_history.
 * 2. ZERO LLM CALLS: 100% deterministic TypeScript & PostgreSQL verification logic.
 * 3. NO FALSE POSITIVES: Prefers NO_ANOMALY over speculative anomaly. Inconclusive = no flag.
 * 4. BOUNDED RUN RECORDS: Writes lightweight metadata to `nova_guardian_runs`.
 * 5. DETERMINISTIC DEDUPLICATION: Writes to `nova_guardian_anomalies` with stable SHA-256 fingerprints.
 * 6. FAIL-SAFE: Errors are captured and logged; guardian execution NEVER blocks or breaks chat.
 */

import { supabaseAdmin } from '../lib/supabase';
import { logger } from '../lib/logger';
import { qt } from '../lib/queryTracker';
import { canonicalizeKey } from '../lib/memoryKeySchema';
import { isGarbageMemoryValue } from '../lib/memoryFilters';
import { generateAnomalyFingerprint } from '../lib/guardianFingerprint';
import {
  GuardianAnomalyDraft,
  GuardianRunResult,
  GuardianTriggerType,
  GuardianScanReport,
  GuardianAnomalyRecord,
} from '../types/guardian';
import { canonicalStateReconciler } from './CanonicalStateReconciler';
import { RepairOrderDraft } from '../types/canonicalRepair';

export class DeterministicGuardianService {
  /**
   * Post-Turn Trigger: Evaluates invariants relevant immediately after a user conversational turn.
   */
  async runPostTurnScan(
    userId: string,
    turnId?: string,
    sourceMessageId?: string
  ): Promise<GuardianRunResult> {
    return this.executeGuardianRun(userId, 'post_turn', { turnId, sourceMessageId }, async (uId) => {
      const anomalies: GuardianAnomalyDraft[] = [];
      const [
        w001, w002, w003, w004, w008, w014, w016, w017, w020, w021
      ] = await Promise.all([
        this.detectW001_MemoryQuestionMetaText(uId),
        this.detectW002_MemoryAuthorityInversion(uId),
        this.detectW003_AliasCanonicalKeyCollision(uId),
        this.detectW004_DuplicateLifeThreads(uId),
        this.detectW008_AutonomousChatWithoutOutreach(uId),
        this.detectW014_MissingTurnAttribution(uId),
        this.detectW016_CrossUserConversations(),
        this.detectW017_StaleFollowupLocks(uId),
        this.detectW020_ImpossibleEventOrder(uId),
        this.detectW021_CausalSourceMismatch(uId),
      ]);

      anomalies.push(...w001, ...w002, ...w003, ...w004, ...w008, ...w014, ...w016, ...w017, ...w020, ...w021);
      return anomalies;
    });
  }

  /**
   * State Mutation Trigger: Evaluates invariants after a life_thread or memory write.
   */
  async runMutationScan(
    userId: string,
    entityType: 'life_thread' | 'memory',
    _entityId?: string
  ): Promise<GuardianRunResult> {
    const triggerType: GuardianTriggerType = entityType === 'life_thread'
      ? 'life_thread_mutation'
      : 'memory_mutation';

    return this.executeGuardianRun(userId, triggerType, {}, async (uId) => {
      const anomalies: GuardianAnomalyDraft[] = [];
      if (entityType === 'life_thread') {
        const [w004, w005, w007, w021] = await Promise.all([
          this.detectW004_DuplicateLifeThreads(uId),
          this.detectW005_InvalidLifeThreadStateTransition(uId),
          this.detectW007_ProvenanceMismatch(uId),
          this.detectW021_CausalSourceMismatch(uId),
        ]);
        anomalies.push(...w004, ...w005, ...w007, ...w021);
      } else {
        const [w001, w002, w003] = await Promise.all([
          this.detectW001_MemoryQuestionMetaText(uId),
          this.detectW002_MemoryAuthorityInversion(uId),
          this.detectW003_AliasCanonicalKeyCollision(uId),
        ]);
        anomalies.push(...w001, ...w002, ...w003);
      }
      return anomalies;
    });
  }

  /**
   * Autonomous Outreach Trigger: Evaluates outreach causal link integrity.
   */
  async runOutreachScan(userId: string, outreachLogId?: string): Promise<GuardianRunResult> {
    return this.executeGuardianRun(userId, 'autonomous_outreach', { outreachLogId }, async (uId) => {
      const [w008, w009, w018, w022] = await Promise.all([
        this.detectW008_AutonomousChatWithoutOutreach(uId),
        this.detectW009_OutreachWithoutChat(uId),
        this.detectW018_ProactiveGateDuplicates(uId),
        this.detectW022_DurableStateOutputAgreementFailure(uId),
      ]);
      return [...w008, ...w009, ...w018, ...w022];
    });
  }

  /**
   * Manual / Scheduled Full System Scan (Read-Only).
   */
  async runFullScan(userId?: string): Promise<GuardianScanReport> {
    const startedAt = Date.now();
    const anomalies: GuardianAnomalyDraft[] = [];

    if (userId) {
      const userRes = await this.executeGuardianRun(userId, 'manual_scan', {}, async (uId) => {
        return this.runAllDetectorsForUser(uId);
      });
      return {
        totalRuns: 1,
        anomaliesByCode: this.aggregateByCode(userRes.anomalies),
        anomaliesBySeverity: this.aggregateBySeverity(userRes.anomalies),
        anomalies: await this.fetchStoredAnomalies(userId),
        falsePositiveCandidates: 0,
        unknownInconclusive: 0,
      };
    }

    // System-wide scan across all users and global invariants
    const { data: userProfiles } = await supabaseAdmin.from('profiles').select('id').limit(200);
    const userIds = (userProfiles || []).map((p: any) => p.id);

    for (const uId of userIds) {
      const userAnomalies = await this.runAllDetectorsForUser(uId);
      anomalies.push(...userAnomalies);
    }

    // Global cross-user and job detectors
    const [w011, w012, w013, w015, w016] = await Promise.all([
      this.detectW011_FailedMalformedBackgroundJob(),
      this.detectW012_InvalidUserJob(),
      this.detectW013_DeletedUserExecutableJob(),
      this.detectW015_OrphanedProfileAuthDesync(),
      this.detectW016_CrossUserConversations(),
    ]);
    anomalies.push(...w011, ...w012, ...w013, ...w015, ...w016);

    // Record the overall manual run
    const runId = await this.recordRun(null, 'manual_scan', null, null, anomalies.length, Date.now() - startedAt);
    if (runId && anomalies.length > 0) {
      await this.persistAnomalies(runId, anomalies);
    }

    const storedAnomalies = await this.fetchStoredAnomalies();

    return {
      totalRuns: 1,
      anomaliesByCode: this.aggregateByCode(anomalies),
      anomaliesBySeverity: this.aggregateBySeverity(anomalies),
      anomalies: storedAnomalies,
      falsePositiveCandidates: 0,
      unknownInconclusive: 0,
    };
  }

  /**
   * Runs all user-scoped detectors.
   */
  async runAllDetectorsForUser(userId: string): Promise<GuardianAnomalyDraft[]> {
    const results = await Promise.all([
      this.detectW001_MemoryQuestionMetaText(userId),
      this.detectW002_MemoryAuthorityInversion(userId),
      this.detectW003_AliasCanonicalKeyCollision(userId),
      this.detectW004_DuplicateLifeThreads(userId),
      this.detectW005_InvalidLifeThreadStateTransition(userId),
      this.detectW006_StaleMutations(userId),
      this.detectW007_ProvenanceMismatch(userId),
      this.detectW008_AutonomousChatWithoutOutreach(userId),
      this.detectW009_OutreachWithoutChat(userId),
      this.detectW010_ConfirmedReminderWithNoDurableRecord(userId),
      this.detectW011_FailedMalformedBackgroundJob(userId),
      this.detectW014_MissingTurnAttribution(userId),
      this.detectW017_StaleFollowupLocks(userId),
      this.detectW018_ProactiveGateDuplicates(userId),
      this.detectW019_ExpiredActiveReminders(userId),
      this.detectW020_ImpossibleEventOrder(userId),
      this.detectW021_CausalSourceMismatch(userId),
      this.detectW022_DurableStateOutputAgreementFailure(userId),
    ]);
    return results.flat();
  }

  // ───────────────────────────────────────────────────────────────────────────
  // DETECTOR IMPLEMENTATIONS (W-001 through W-022)
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * W-001: MEMORY QUESTION / META TEXT
   * Detects durable memory whose value is a question or meta text.
   */
  async detectW001_MemoryQuestionMetaText(userId: string): Promise<GuardianAnomalyDraft[]> {
    const drafts: GuardianAnomalyDraft[] = [];
    const { data: memories, error } = await qt.track('guardian_w001_memories', 'memories', () =>
      supabaseAdmin
        .from('memories')
        .select('id, key, value, source_message, source_authority, is_archived')
        .eq('user_id', userId)
        .eq('is_archived', false)
        .limit(100)
    );

    if (error || !memories) return drafts;

    for (const mem of memories) {
      const val = (mem.value || '').trim();
      const isQuestion = isGarbageMemoryValue(mem.key, val, 'memoryRepository') ||
        val.endsWith('?') ||
        /^(kaunsa|kya|kaise|what is|how to|abhi mere important goals kya hain)/i.test(val);

      if (isQuestion) {
        const fingerprint = generateAnomalyFingerprint(userId, 'W-001', mem.id, mem.key);
        drafts.push({
          anomalyCode: 'W-001',
          severity: 'medium',
          targetEntityId: mem.id,
          fingerprint,
          evidence: {
            memory_id: mem.id,
            key: mem.key,
            value: val,
            source_authority: mem.source_authority,
            reason: 'Memory value contains question syntax or classified garbage text',
          },
        });
      }
    }

    return drafts;
  }

  /**
   * W-002: MEMORY AUTHORITY INVERSION
   * Detects when a subconscious inference overwrote or set a generic relation noun as a name.
   */
  async detectW002_MemoryAuthorityInversion(userId: string): Promise<GuardianAnomalyDraft[]> {
    const drafts: GuardianAnomalyDraft[] = [];
    const GENERIC_NOUNS = new Set([
      'wife', 'husband', 'mom', 'mother', 'dad', 'father', 'bhai', 'brother',
      'sister', 'son', 'daughter', 'didi', 'bhabhi', 'spouse', 'partner', 'friend'
    ]);

    const { data: memories, error } = await qt.track('guardian_w002_memories', 'memories', () =>
      supabaseAdmin
        .from('memories')
        .select('id, key, value, source_authority, is_archived')
        .eq('user_id', userId)
        .eq('is_archived', false)
        .limit(100)
    );

    if (error || !memories) return drafts;

    for (const mem of memories) {
      if (mem.key.endsWith('_name')) {
        const valLower = (mem.value || '').toLowerCase().trim();
        if (GENERIC_NOUNS.has(valLower) && mem.source_authority === 'subconscious_inference') {
          const fingerprint = generateAnomalyFingerprint(userId, 'W-002', mem.id, mem.key);
          drafts.push({
            anomalyCode: 'W-002',
            severity: 'high',
            targetEntityId: mem.id,
            fingerprint,
            evidence: {
              memory_id: mem.id,
              key: mem.key,
              value: mem.value,
              source_authority: mem.source_authority,
              reason: 'Relational noun stored as name under subconscious_inference authority',
            },
          });
        }
      }
    }

    return drafts;
  }

  /**
   * W-003: ALIAS / CANONICAL KEY COLLISION
   * Detects active memories using alias keys where canonical normalization produces a different key.
   */
  async detectW003_AliasCanonicalKeyCollision(userId: string): Promise<GuardianAnomalyDraft[]> {
    const drafts: GuardianAnomalyDraft[] = [];
    const { data: memories, error } = await qt.track('guardian_w003_memories', 'memories', () =>
      supabaseAdmin
        .from('memories')
        .select('id, key, value, is_archived')
        .eq('user_id', userId)
        .eq('is_archived', false)
        .limit(100)
    );

    if (error || !memories) return drafts;

    for (const mem of memories) {
      const { canonical, wasAliased } = canonicalizeKey(mem.key);
      if (wasAliased && canonical !== mem.key) {
        const fingerprint = generateAnomalyFingerprint(userId, 'W-003', mem.id, mem.key);
        drafts.push({
          anomalyCode: 'W-003',
          severity: 'low',
          targetEntityId: mem.id,
          fingerprint,
          evidence: {
            memory_id: mem.id,
            alias_key: mem.key,
            canonical_key: canonical,
            value: mem.value,
          },
        });
      }
    }

    return drafts;
  }

  /**
   * W-004: DUPLICATE ACTIVE/WAITING LIFE THREAD
   * Detects multiple active/waiting/blocked LifeThreads violating canonical identity.
   */
  async detectW004_DuplicateLifeThreads(userId: string): Promise<GuardianAnomalyDraft[]> {
    const drafts: GuardianAnomalyDraft[] = [];
    const { data: threads, error } = await qt.track('guardian_w004_threads', 'life_threads', () =>
      supabaseAdmin
        .from('life_threads')
        .select('id, canonical_key, topic, state, created_at')
        .eq('user_id', userId)
        .in('state', ['active', 'waiting', 'blocked'])
    );

    if (error || !threads || threads.length <= 1) return drafts;

    const grouped: Record<string, typeof threads> = {};
    for (const t of threads) {
      const key = t.canonical_key || t.topic.toLowerCase().trim();
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(t);
    }

    for (const [key, list] of Object.entries(grouped)) {
      if (list.length > 1) {
        const primaryId = list[0].id;
        const fingerprint = generateAnomalyFingerprint(userId, 'W-004', primaryId, key);
        drafts.push({
          anomalyCode: 'W-004',
          severity: 'high',
          targetEntityId: primaryId,
          fingerprint,
          evidence: {
            user_id: userId,
            canonical_key: key,
            duplicate_thread_ids: list.map(t => t.id),
            states: list.map(t => t.state),
            topics: list.map(t => t.topic),
          },
        });
      }
    }

    return drafts;
  }

  /**
   * W-005: INVALID LIFE THREAD STATE TRANSITION
   * Detects illegal state transitions in provenance logs (e.g., llm_proposal reopening terminal threads).
   */
  async detectW005_InvalidLifeThreadStateTransition(userId: string): Promise<GuardianAnomalyDraft[]> {
    const drafts: GuardianAnomalyDraft[] = [];
    const { data: threads, error } = await qt.track('guardian_w005_threads', 'life_threads', () =>
      supabaseAdmin
        .from('life_threads')
        .select('id, topic, state, provenance, mutation_source')
        .eq('user_id', userId)
        .limit(100)
    );

    if (error || !threads) return drafts;

    for (const thread of threads) {
      const prov = thread.provenance || '';
      // Check for illegal transition signature: completed/abandoned -> active by llm_proposal
      if (
        (prov.includes('completed -> active by llm_proposal') || prov.includes('abandoned -> active by llm_proposal'))
      ) {
        const fingerprint = generateAnomalyFingerprint(userId, 'W-005', thread.id, thread.state);
        drafts.push({
          anomalyCode: 'W-005',
          severity: 'high',
          targetEntityId: thread.id,
          fingerprint,
          evidence: {
            thread_id: thread.id,
            topic: thread.topic,
            current_state: thread.state,
            mutation_source: thread.mutation_source,
            discrepancy: 'Terminal thread resurrected by unauthorized llm_proposal source in provenance history',
          },
        });
      }
    }

    return drafts;
  }

  /**
   * W-006: STALE MUTATION
   * Detects observed stale mutation attempts recorded in provenance.
   */
  async detectW006_StaleMutations(userId: string): Promise<GuardianAnomalyDraft[]> {
    const drafts: GuardianAnomalyDraft[] = [];
    const { data: threads, error } = await qt.track('guardian_w006_threads', 'life_threads', () =>
      supabaseAdmin
        .from('life_threads')
        .select('id, topic, provenance, source_message_seq')
        .eq('user_id', userId)
        .ilike('provenance', '%STALE_WRITE_REJECTED%')
    );

    if (error || !threads) return drafts;

    for (const thread of threads) {
      const fingerprint = generateAnomalyFingerprint(userId, 'W-006', thread.id, 'stale_write');
      drafts.push({
        anomalyCode: 'W-006',
        severity: 'low',
        targetEntityId: thread.id,
        fingerprint,
        evidence: {
          thread_id: thread.id,
          topic: thread.topic,
          source_message_seq: thread.source_message_seq,
          note: 'Stale write rejection recorded for thread',
        },
      });
    }

    return drafts;
  }

  /**
   * W-007: PROVENANCE MISMATCH
   * Detects when a mutation references a turn/message from another user or missing record.
   */
  async detectW007_ProvenanceMismatch(userId: string): Promise<GuardianAnomalyDraft[]> {
    const drafts: GuardianAnomalyDraft[] = [];
    const { data: threads, error } = await qt.track('guardian_w007_threads', 'life_threads', () =>
      supabaseAdmin
        .from('life_threads')
        .select('id, topic, source_message_id, user_id')
        .eq('user_id', userId)
        .not('source_message_id', 'is', null)
        .limit(50)
    );

    if (error || !threads || threads.length === 0) return drafts;

    const sourceMsgIds = threads.map(t => t.source_message_id).filter(Boolean);
    const { data: messages } = await supabaseAdmin
      .from('chat_history')
      .select('id, user_id')
      .in('id', sourceMsgIds);

    const msgMap = new Map((messages || []).map((m: any) => [m.id, m.user_id]));

    for (const t of threads) {
      if (t.source_message_id && msgMap.has(t.source_message_id)) {
        const msgUserId = msgMap.get(t.source_message_id);
        if (msgUserId && msgUserId !== userId) {
          const fingerprint = generateAnomalyFingerprint(userId, 'W-007', t.id, t.source_message_id);
          drafts.push({
            anomalyCode: 'W-007',
            severity: 'critical',
            targetEntityId: t.id,
            fingerprint,
            evidence: {
              thread_id: t.id,
              thread_user_id: userId,
              source_message_id: t.source_message_id,
              message_owner_user_id: msgUserId,
              discrepancy: 'LifeThread source_message_id references message owned by a different user',
            },
          });
        }
      }
    }

    return drafts;
  }

  /**
   * W-008: AUTONOMOUS CHAT WITHOUT OUTREACH
   * Detects assistant messages in chat_history where source_type != 'conversational' but outreach_log_id is null.
   */
  async detectW008_AutonomousChatWithoutOutreach(userId: string): Promise<GuardianAnomalyDraft[]> {
    const drafts: GuardianAnomalyDraft[] = [];
    const { data: messages, error } = await qt.track('guardian_w008_chat', 'chat_history', () =>
      supabaseAdmin
        .from('chat_history')
        .select('id, conversation_id, source_type, outreach_log_id, created_at')
        .eq('user_id', userId)
        .eq('role', 'assistant')
        .not('source_type', 'is', null)
        .neq('source_type', 'conversational')
        .is('outreach_log_id', null)
        .limit(50)
    );

    if (error || !messages) return drafts;

    for (const msg of messages) {
      const fingerprint = generateAnomalyFingerprint(userId, 'W-008', msg.id, msg.source_type);
      drafts.push({
        anomalyCode: 'W-008',
        severity: 'medium',
        targetEntityId: msg.id,
        fingerprint,
        evidence: {
          message_id: msg.id,
          conversation_id: msg.conversation_id,
          source_type: msg.source_type,
          created_at: msg.created_at,
          discrepancy: 'Autonomous assistant message is missing foreign key to nova_outreach_log',
        },
      });
    }

    return drafts;
  }

  /**
   * W-009: OUTREACH WITHOUT CHAT
   * Detects sent outreach logs where the specified chat_message_id does not exist in chat_history.
   */
  async detectW009_OutreachWithoutChat(userId: string): Promise<GuardianAnomalyDraft[]> {
    const drafts: GuardianAnomalyDraft[] = [];
    const { data: outreachLogs, error } = await qt.track('guardian_w009_outreach', 'nova_outreach_log', () =>
      supabaseAdmin
        .from('nova_outreach_log')
        .select('id, user_id, logical_key, outreach_type, chat_message_id, created_at')
        .eq('user_id', userId)
        .in('status', ['sent', 'delivered'])
        .not('chat_message_id', 'is', null)
        .limit(50)
    );

    if (error || !outreachLogs || outreachLogs.length === 0) return drafts;

    const chatMsgIds = outreachLogs.map(o => o.chat_message_id).filter(Boolean);
    const { data: chatRows } = await supabaseAdmin
      .from('chat_history')
      .select('id')
      .in('id', chatMsgIds);

    const existingChatIds = new Set((chatRows || []).map((c: any) => c.id));

    for (const log of outreachLogs) {
      if (log.chat_message_id && !existingChatIds.has(log.chat_message_id)) {
        const fingerprint = generateAnomalyFingerprint(userId, 'W-009', log.id, log.chat_message_id);
        drafts.push({
          anomalyCode: 'W-009',
          severity: 'medium',
          targetEntityId: log.id,
          fingerprint,
          evidence: {
            outreach_log_id: log.id,
            logical_key: log.logical_key,
            outreach_type: log.outreach_type,
            expected_chat_message_id: log.chat_message_id,
            discrepancy: 'Outreach record references chat_message_id that does not exist in chat_history',
          },
        });
      }
    }

    return drafts;
  }

  /**
   * W-010: CONFIRMED REMINDER WITH NO DURABLE RECORD
   * Detects reminder creation records/events that have no corresponding row in reminders table.
   */
  async detectW010_ConfirmedReminderWithNoDurableRecord(userId: string): Promise<GuardianAnomalyDraft[]> {
    const drafts: GuardianAnomalyDraft[] = [];
    // Check reminders where reminder is referenced in actions or thoughts but missing
    const { data: actions, error } = await qt.track('guardian_w010_actions', 'nova_actions', () =>
      supabaseAdmin
        .from('nova_actions')
        .select('id, logical_key, title, metadata')
        .eq('user_id', userId)
        .eq('execution_class', 'reminder')
        .in('state', ['scheduled', 'in_progress'])
        .limit(50)
    );

    if (error || !actions || actions.length === 0) return drafts;

    const { data: reminders } = await supabaseAdmin
      .from('reminders')
      .select('id, user_id, text')
      .eq('user_id', userId);

    const reminderTitles = new Set((reminders || []).map((r: any) => (r.text || '').toLowerCase().trim()));

    for (const act of actions) {
      const titleLower = (act.title || '').toLowerCase().trim();
      if (titleLower && !reminderTitles.has(titleLower)) {
        const fingerprint = generateAnomalyFingerprint(userId, 'W-010', act.id, act.logical_key);
        drafts.push({
          anomalyCode: 'W-010',
          severity: 'high',
          targetEntityId: act.id,
          fingerprint,
          evidence: {
            action_id: act.id,
            logical_key: act.logical_key,
            action_title: act.title,
            discrepancy: 'Scheduled reminder action exists without corresponding active row in reminders table',
          },
        });
      }
    }

    return drafts;
  }

  /**
   * W-011: FAILED / MALFORMED BACKGROUND JOB
   * Detects background jobs that have explicitly failed or are hung running > 15 minutes.
   */
  async detectW011_FailedMalformedBackgroundJob(userId?: string): Promise<GuardianAnomalyDraft[]> {
    const drafts: GuardianAnomalyDraft[] = [];
    const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();

    let builder = supabaseAdmin
      .from('background_jobs')
      .select('id, user_id, job_type, status, error_message, started_at, payload, created_at');

    if (userId) {
      builder = builder.eq('user_id', userId);
    }

    const { data: jobs, error } = await qt.track('guardian_w011_jobs', 'background_jobs', () =>
      builder.or(`status.eq.failed,and(status.eq.running,started_at.lt.${fifteenMinutesAgo})`).limit(50)
    );
    if (error || !jobs) return drafts;

    for (const job of jobs) {
      const isHung = job.status === 'running' && job.started_at && job.started_at < fifteenMinutesAgo;
      const isMalformed = !job.payload || typeof job.payload !== 'object';
      const uId = job.user_id || 'system';

      const fingerprint = generateAnomalyFingerprint(uId, 'W-011', job.id, job.job_type);
      drafts.push({
        anomalyCode: 'W-011',
        severity: isHung ? 'high' : 'medium',
        targetEntityId: job.id,
        fingerprint,
        evidence: {
          job_id: job.id,
          user_id: job.user_id,
          job_type: job.job_type,
          status: job.status,
          is_hung: isHung,
          is_malformed: isMalformed,
          error_message: job.error_message || (isHung ? 'Job hung in running state > 15m' : null),
        },
      });
    }

    return drafts;
  }

  /**
   * W-012: INVALID USER JOB
   * Detects jobs referencing a user_id that does not exist in profiles.
   */
  async detectW012_InvalidUserJob(): Promise<GuardianAnomalyDraft[]> {
    const drafts: GuardianAnomalyDraft[] = [];
    const { data: jobs, error } = await qt.track('guardian_w012_jobs', 'background_jobs', () =>
      supabaseAdmin
        .from('background_jobs')
        .select('id, user_id, job_type, status')
        .not('user_id', 'is', null)
        .in('status', ['pending', 'running'])
        .limit(50)
    );

    if (error || !jobs || jobs.length === 0) return drafts;

    const userIds = Array.from(new Set(jobs.map(j => j.user_id).filter(Boolean)));
    const { data: profiles } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .in('id', userIds);

    const validUserIds = new Set((profiles || []).map((p: any) => p.id));

    for (const job of jobs) {
      if (job.user_id && !validUserIds.has(job.user_id)) {
        const fingerprint = generateAnomalyFingerprint(job.user_id, 'W-012', job.id, job.job_type);
        drafts.push({
          anomalyCode: 'W-012',
          severity: 'high',
          targetEntityId: job.id,
          fingerprint,
          evidence: {
            job_id: job.id,
            invalid_user_id: job.user_id,
            job_type: job.job_type,
            status: job.status,
            discrepancy: 'Background job references non-existent user profile',
          },
        });
      }
    }

    return drafts;
  }

  /**
   * W-013: DELETED/DEAD USER WITH EXECUTABLE JOB
   * Detects pending/running jobs for deactivated profiles.
   */
  async detectW013_DeletedUserExecutableJob(): Promise<GuardianAnomalyDraft[]> {
    const drafts: GuardianAnomalyDraft[] = [];
    const { data: profiles, error } = await qt.track('guardian_w013_profiles', 'profiles', () =>
      supabaseAdmin
        .from('profiles')
        .select('id')
        .or('is_deleted.eq.true,is_active.eq.false')
    );

    if (error || !profiles || profiles.length === 0) return drafts;

    const deadUserIds = profiles.map((p: any) => p.id);
    const { data: deadJobs } = await supabaseAdmin
      .from('background_jobs')
      .select('id, user_id, job_type, status')
      .in('user_id', deadUserIds)
      .in('status', ['pending', 'running']);

    for (const job of deadJobs || []) {
      const fingerprint = generateAnomalyFingerprint(job.user_id, 'W-013', job.id, job.job_type);
      drafts.push({
        anomalyCode: 'W-013',
        severity: 'high',
        targetEntityId: job.id,
        fingerprint,
        evidence: {
          job_id: job.id,
          user_id: job.user_id,
          job_type: job.job_type,
          status: job.status,
          discrepancy: 'Pending/running job belongs to a deactivated/deleted user account',
        },
      });
    }

    return drafts;
  }

  /**
   * W-014: MISSING TURN ATTRIBUTION
   * Detects assistant messages missing source_type attribution.
   */
  async detectW014_MissingTurnAttribution(userId: string): Promise<GuardianAnomalyDraft[]> {
    const drafts: GuardianAnomalyDraft[] = [];
    const { data: messages, error } = await qt.track('guardian_w014_chat', 'chat_history', () =>
      supabaseAdmin
        .from('chat_history')
        .select('id, conversation_id, content, created_at')
        .eq('user_id', userId)
        .eq('role', 'assistant')
        .is('source_type', null)
        .limit(20)
    );

    if (error || !messages) return drafts;

    for (const msg of messages) {
      const fingerprint = generateAnomalyFingerprint(userId, 'W-014', msg.id, 'missing_source_type');
      drafts.push({
        anomalyCode: 'W-014',
        severity: 'low',
        targetEntityId: msg.id,
        fingerprint,
        evidence: {
          message_id: msg.id,
          conversation_id: msg.conversation_id,
          created_at: msg.created_at,
          discrepancy: 'Assistant chat row missing required Phase 0 source_type attribution',
        },
      });
    }

    return drafts;
  }

  /**
   * W-015: ORPHANED PROFILE/AUTH DESYNC
   * Detects profile records that have no valid Supabase auth user.
   */
  async detectW015_OrphanedProfileAuthDesync(): Promise<GuardianAnomalyDraft[]> {
    const drafts: GuardianAnomalyDraft[] = [];
    try {
      const { data: profiles, error } = await qt.track('guardian_w015_profiles', 'profiles', () =>
        supabaseAdmin.from('profiles').select('id, created_at').limit(50)
      );

      if (error || !profiles) return drafts;

      for (const p of profiles) {
        // Query auth admin API safely for existence
        const { data: authUser, error: authErr } = await supabaseAdmin.auth.admin.getUserById(p.id);
        if (authErr || !authUser?.user) {
          const fingerprint = generateAnomalyFingerprint(p.id, 'W-015', p.id, 'auth_desync');
          drafts.push({
            anomalyCode: 'W-015',
            severity: 'high',
            targetEntityId: p.id,
            fingerprint,
            evidence: {
              profile_id: p.id,
              created_at: p.created_at,
              discrepancy: 'Profile row exists with no corresponding record in auth.users',
            },
          });
        }
      }
    } catch (err: any) {
      logger.warn('[DeterministicGuardian] W-015 check skipped due to auth permission boundary', { error: err?.message });
    }

    return drafts;
  }

  /**
   * W-016: CROSS-USER CONVERSATION OWNERSHIP VIOLATION
   * Detects a conversation_id containing records for more than one distinct user_id.
   */
  async detectW016_CrossUserConversations(): Promise<GuardianAnomalyDraft[]> {
    const drafts: GuardianAnomalyDraft[] = [];
    const { data: convRows, error } = await qt.track('guardian_w016_chat', 'chat_history', () =>
      supabaseAdmin
        .from('chat_history')
        .select('conversation_id, user_id')
        .not('conversation_id', 'is', null)
        .order('created_at', { ascending: false })
        .limit(300)
    );

    if (error || !convRows || convRows.length === 0) return drafts;

    const convUsers: Record<string, Set<string>> = {};
    for (const r of convRows) {
      if (!r.conversation_id || !r.user_id) continue;
      if (!convUsers[r.conversation_id]) convUsers[r.conversation_id] = new Set();
      convUsers[r.conversation_id].add(r.user_id);
    }

    for (const [convId, userSet] of Object.entries(convUsers)) {
      if (userSet.size > 1) {
        const uList = Array.from(userSet);
        const primaryUser = uList[0];
        const fingerprint = generateAnomalyFingerprint(primaryUser, 'W-016', convId, uList.sort().join(':'));
        drafts.push({
          anomalyCode: 'W-016',
          severity: 'critical',
          targetEntityId: convId,
          fingerprint,
          evidence: {
            conversation_id: convId,
            violating_user_ids: uList,
            discrepancy: 'Conversation ID contains messages from multiple distinct users',
          },
        });
      }
    }

    return drafts;
  }

  /**
   * W-017: STALE FOLLOWUP / LOCK STATE
   * Detects working_memory rows with expired followup suppression timestamps.
   */
  async detectW017_StaleFollowupLocks(userId: string): Promise<GuardianAnomalyDraft[]> {
    const drafts: GuardianAnomalyDraft[] = [];
    const { data: rows, error } = await qt.track('guardian_w017_wm', 'working_memory', () =>
      supabaseAdmin
        .from('working_memory')
        .select('id, key, value, updated_at')
        .eq('user_id', userId)
        .eq('key', 'followup_suppressed_until')
    );

    if (error || !rows) return drafts;

    const now = Date.now();
    for (const r of rows) {
      const expTime = new Date(r.value || 0).getTime();
      // If expired more than 1 hour ago but still present
      if (expTime > 0 && expTime < now - (60 * 60 * 1000)) {
        const fingerprint = generateAnomalyFingerprint(userId, 'W-017', r.id, r.key);
        drafts.push({
          anomalyCode: 'W-017',
          severity: 'low',
          targetEntityId: r.id,
          fingerprint,
          evidence: {
            working_memory_id: r.id,
            key: r.key,
            value: r.value,
            expired_by_hours: Math.round((now - expTime) / (1000 * 60 * 60)),
          },
        });
      }
    }

    return drafts;
  }

  /**
   * W-018: PROACTIVE GATE DUPLICATE
   * Detects duplicate autonomous outreach records with the same logical key inside the 60m window.
   */
  async detectW018_ProactiveGateDuplicates(userId: string): Promise<GuardianAnomalyDraft[]> {
    const drafts: GuardianAnomalyDraft[] = [];
    const { data: logs, error } = await qt.track('guardian_w018_outreach', 'nova_outreach_log', () =>
      supabaseAdmin
        .from('nova_outreach_log')
        .select('id, logical_key, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(50)
    );

    if (error || !logs || logs.length <= 1) return drafts;

    const grouped: Record<string, typeof logs> = {};
    for (const log of logs) {
      if (!log.logical_key) continue;
      if (!grouped[log.logical_key]) grouped[log.logical_key] = [];
      grouped[log.logical_key].push(log);
    }

    for (const [lKey, entries] of Object.entries(grouped)) {
      if (entries.length > 1) {
        for (let i = 0; i < entries.length - 1; i++) {
          const t1 = new Date(entries[i].created_at).getTime();
          const t2 = new Date(entries[i + 1].created_at).getTime();
          const diffMin = Math.abs(t1 - t2) / (1000 * 60);

          if (diffMin < 60) {
            const fingerprint = generateAnomalyFingerprint(userId, 'W-018', entries[i].id, lKey);
            drafts.push({
              anomalyCode: 'W-018',
              severity: 'medium',
              targetEntityId: entries[i].id,
              fingerprint,
              evidence: {
                logical_key: lKey,
                outreach_id_1: entries[i].id,
                outreach_id_2: entries[i + 1].id,
                difference_minutes: diffMin,
                discrepancy: 'Multiple proactive outreach logs fired for the same logical key within the 60m window',
              },
            });
            break;
          }
        }
      }
    }

    return drafts;
  }

  /**
   * W-019: EXPIRED ACTIVE REMINDER
   * Detects reminders past their trigger time by > 24 hours that remain in pending state.
   */
  async detectW019_ExpiredActiveReminders(userId: string): Promise<GuardianAnomalyDraft[]> {
    const drafts: GuardianAnomalyDraft[] = [];
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { data: reminders, error } = await qt.track('guardian_w019_reminders', 'reminders', () =>
      supabaseAdmin
        .from('reminders')
        .select('id, user_id, text, trigger_at, status')
        .eq('user_id', userId)
        .in('status', ['pending', 'active'])
        .lt('trigger_at', oneDayAgo)
        .limit(50)
    );

    if (error || !reminders) return drafts;

    for (const r of reminders) {
      const fingerprint = generateAnomalyFingerprint(userId, 'W-019', r.id, r.trigger_at);
      drafts.push({
        anomalyCode: 'W-019',
        severity: 'medium',
        targetEntityId: r.id,
        fingerprint,
        evidence: {
          reminder_id: r.id,
          text: r.text,
          trigger_at: r.trigger_at,
          status: r.status,
          discrepancy: 'Active reminder trigger_at is overdue by more than 24 hours without completion',
        },
      });
    }

    return drafts;
  }

  /**
   * W-020: IMPOSSIBLE EVENT ORDER
   * Detects chronological violations (e.g., assistant reply created before user message it replies to).
   */
  async detectW020_ImpossibleEventOrder(userId: string): Promise<GuardianAnomalyDraft[]> {
    const drafts: GuardianAnomalyDraft[] = [];
    const { data: replies, error } = await qt.track('guardian_w020_chat', 'chat_history', () =>
      supabaseAdmin
        .from('chat_history')
        .select('id, created_at, reply_to_id')
        .eq('user_id', userId)
        .eq('role', 'assistant')
        .not('reply_to_id', 'is', null)
        .limit(50)
    );

    if (error || !replies || replies.length === 0) return drafts;

    const parentIds = replies.map(r => r.reply_to_id).filter(Boolean);
    const { data: parents } = await supabaseAdmin
      .from('chat_history')
      .select('id, created_at')
      .in('id', parentIds);

    const parentMap = new Map((parents || []).map((p: any) => [p.id, new Date(p.created_at).getTime()]));

    for (const rep of replies) {
      if (rep.reply_to_id && parentMap.has(rep.reply_to_id)) {
        const parentTime = parentMap.get(rep.reply_to_id)!;
        const childTime = new Date(rep.created_at).getTime();

        // If assistant reply is recorded before the user message by more than 1 second (clock drift buffer)
        if (childTime < parentTime - 1000) {
          const fingerprint = generateAnomalyFingerprint(userId, 'W-020', rep.id, rep.reply_to_id);
          drafts.push({
            anomalyCode: 'W-020',
            severity: 'medium',
            targetEntityId: rep.id,
            fingerprint,
            evidence: {
              reply_message_id: rep.id,
              parent_message_id: rep.reply_to_id,
              reply_created_at: rep.created_at,
              parent_created_at: new Date(parentTime).toISOString(),
              drift_ms: parentTime - childTime,
              discrepancy: 'Assistant reply timestamp precedes user parent message timestamp',
            },
          });
        }
      }
    }

    return drafts;
  }

  /**
   * W-021: CAUSAL SOURCE MISMATCH
   * Detects when a mutation claims a source message that belongs to a different conversation/user.
   */
  async detectW021_CausalSourceMismatch(userId: string): Promise<GuardianAnomalyDraft[]> {
    const drafts: GuardianAnomalyDraft[] = [];
    const { data: threads, error } = await qt.track('guardian_w021_threads', 'life_threads', () =>
      supabaseAdmin
        .from('life_threads')
        .select('id, topic, source_message_id')
        .eq('user_id', userId)
        .not('source_message_id', 'is', null)
        .limit(30)
    );

    if (error || !threads || threads.length === 0) return drafts;

    const msgIds = threads.map(t => t.source_message_id).filter(Boolean);
    const { data: messages } = await supabaseAdmin
      .from('chat_history')
      .select('id, user_id, role')
      .in('id', msgIds);

    const msgMap = new Map((messages || []).map((m: any) => [m.id, m]));

    for (const t of threads) {
      if (t.source_message_id) {
        const msg = msgMap.get(t.source_message_id);
        if (!msg) {
          const fingerprint = generateAnomalyFingerprint(userId, 'W-021', t.id, t.source_message_id);
          drafts.push({
            anomalyCode: 'W-021',
            severity: 'medium',
            targetEntityId: t.id,
            fingerprint,
            evidence: {
              thread_id: t.id,
              claimed_source_message_id: t.source_message_id,
              discrepancy: 'LifeThread claims source_message_id that does not exist in chat_history',
            },
          });
        }
      }
    }

    return drafts;
  }

  /**
   * W-022: DURABLE STATE / OUTPUT AGREEMENT FAILURE
   * Detects when a persisted outreach log marks delivery but the chat message row is absent.
   */
  async detectW022_DurableStateOutputAgreementFailure(userId: string): Promise<GuardianAnomalyDraft[]> {
    return this.detectW009_OutreachWithoutChat(userId);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // EXECUTION & PERSISTENCE HELPERS
  // ───────────────────────────────────────────────────────────────────────────

  private async executeGuardianRun(
    userId: string,
    triggerType: GuardianTriggerType,
    opts: { turnId?: string; sourceMessageId?: string; outreachLogId?: string },
    detectorFn: (uId: string) => Promise<GuardianAnomalyDraft[]>
  ): Promise<GuardianRunResult> {
    const startedAt = Date.now();
    let anomalies: GuardianAnomalyDraft[] = [];

    try {
      anomalies = await detectorFn(userId);
    } catch (err: any) {
      logger.error('[DeterministicGuardian] Anomaly detector execution failed', {
        userId, triggerType, error: err?.message || err
      });
      // Fail closed: continue safely without throwing
    }

    const durationMs = Date.now() - startedAt;

    let runId = 'ephemeral_run';
    try {
      runId = await this.recordRun(
        userId,
        triggerType,
        opts.turnId || null,
        opts.sourceMessageId || null,
        anomalies.length,
        durationMs
      );

      if (anomalies.length > 0 && runId) {
        await this.persistAnomalies(runId, anomalies);
      }
    } catch (persistErr: any) {
      logger.warn('[DeterministicGuardian] Run persistence failed (non-fatal)', {
        userId, triggerType, error: persistErr?.message
      });
    }

    logger.info('[DeterministicGuardian] Run completed', {
      runId, userId, triggerType, anomaliesDetected: anomalies.length, durationMs
    });

    return {
      runId,
      userId,
      triggerType,
      anomaliesDetected: anomalies.length,
      durationMs,
      anomalies,
    };
  }

  private async recordRun(
    userId: string | null,
    triggerType: GuardianTriggerType,
    turnId: string | null,
    sourceMessageId: string | null,
    anomaliesDetected: number,
    durationMs: number
  ): Promise<string> {
    const now = new Date().toISOString();
    const { data, error } = await supabaseAdmin
      .from('nova_guardian_runs')
      .insert({
        user_id: userId,
        turn_id: turnId,
        source_message_id: sourceMessageId,
        trigger_type: triggerType,
        execution_level: 0,
        started_at: now,
        completed_at: now,
        duration_ms: durationMs,
        anomalies_detected: anomaliesDetected,
      })
      .select('id')
      .maybeSingle();

    if (error || !data) {
      logger.debug('[DeterministicGuardian] Could not record run to DB', { error: error?.message });
      return `local_${Date.now()}`;
    }

    return data.id;
  }

  private async persistAnomalies(runId: string, drafts: GuardianAnomalyDraft[]): Promise<void> {
    const now = new Date().toISOString();

    for (const draft of drafts) {
      try {
        const payload = {
          run_id: runId.startsWith('local_') ? null : runId,
          user_id: (draft.evidence.user_id || draft.evidence.thread_user_id || draft.targetEntityId),
          anomaly_code: draft.anomalyCode,
          severity: draft.severity,
          status: 'detected',
          fingerprint: draft.fingerprint,
          evidence: draft.evidence,
          created_at: now,
          last_detected_at: now,
          detection_count: 1,
        };

        // Try upsert on (user_id, fingerprint) constraint
        const { error } = await supabaseAdmin
          .from('nova_guardian_anomalies')
          .upsert(payload, {
            onConflict: 'user_id,fingerprint',
            ignoreDuplicates: false,
          });

        if (error) {
          logger.debug('[DeterministicGuardian] Anomaly upsert skipped/failed', {
            code: draft.anomalyCode, fingerprint: draft.fingerprint, error: error.message
          });
        }
      } catch (err: any) {
        logger.debug('[DeterministicGuardian] Anomaly row persist threw', { error: err?.message });
      }
    }
  }

  private async fetchStoredAnomalies(userId?: string): Promise<GuardianAnomalyRecord[]> {
    try {
      let q = supabaseAdmin.from('nova_guardian_anomalies').select('*').order('created_at', { ascending: false });
      if (userId) q = q.eq('user_id', userId);
      const { data } = await q.limit(100);
      return (data || []) as GuardianAnomalyRecord[];
    } catch {
      return [];
    }
  }

  private aggregateByCode(drafts: GuardianAnomalyDraft[]): Record<string, number> {
    const map: Record<string, number> = {};
    for (const d of drafts) {
      map[d.anomalyCode] = (map[d.anomalyCode] || 0) + 1;
    }
    return map;
  }

  private aggregateBySeverity(drafts: GuardianAnomalyDraft[]): Record<string, number> {
    const map: Record<string, number> = {};
    for (const d of drafts) {
      map[d.severity] = (map[d.severity] || 0) + 1;
    }
    return map;
  }

  /**
   * Phase 2C Safe Deterministic Repair Generator & Dispatcher
   * Converts approved Watchtower anomalies into typed Repair Orders for CanonicalStateReconciler.
   */
  async evaluateAndDispatchRepairs(userId: string, anomalies: GuardianAnomalyDraft[]): Promise<number> {
    let dispatchedCount = 0;

    for (const anomaly of anomalies) {
      try {
        let repairDraft: RepairOrderDraft | null = null;

        // REPAIR A: Memory Alias Canonicalization (W-003)
        if (anomaly.anomalyCode === 'W-003' && anomaly.targetEntityId) {
          repairDraft = {
            userId,
            repairType: 'MEMORY_ALIAS_CANONICALIZATION',
            targetEntityId: anomaly.targetEntityId,
            expectedCurrentState: { key: anomaly.evidence.alias_key },
            proposedState: { canonical_key: anomaly.evidence.canonical_key },
            evidence: anomaly.evidence,
            authority: 'watchtower_repair',
          };
        }

        // REPAIR B: Generic Relational Noise Memory (W-002)
        else if (anomaly.anomalyCode === 'W-002' && anomaly.targetEntityId) {
          repairDraft = {
            userId,
            repairType: 'GENERIC_RELATIONAL_NOISE',
            targetEntityId: anomaly.targetEntityId,
            expectedCurrentState: { value: anomaly.evidence.value },
            proposedState: { is_archived: true },
            evidence: anomaly.evidence,
            authority: 'watchtower_repair',
          };
        }

        // REPAIR E: Expired Deterministic Reminder (W-019)
        else if (anomaly.anomalyCode === 'W-019' && anomaly.targetEntityId) {
          repairDraft = {
            userId,
            repairType: 'EXPIRED_REMINDER_STATE',
            targetEntityId: anomaly.targetEntityId,
            expectedCurrentState: { status: 'active' },
            proposedState: { status: 'expired' },
            evidence: anomaly.evidence,
            authority: 'watchtower_repair',
          };
        }

        if (repairDraft) {
          const order = await canonicalStateReconciler.submitRepairOrder(repairDraft);
          if (order) {
            await canonicalStateReconciler.executeRepair(order.id);
            dispatchedCount++;
          }
        }
      } catch (err: any) {
        logger.debug('[DeterministicGuardian] evaluateAndDispatchRepairs non-fatal error', { error: err?.message });
      }
    }

    return dispatchedCount;
  }
}

export const deterministicGuardian = new DeterministicGuardianService();
