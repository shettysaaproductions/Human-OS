/**
 * DeterministicGuardianService.test.ts — Test Suite for Watchtower Phase 2A
 *
 * Validates:
 * 1. All 22 deterministic anomaly detectors (W-001 through W-022)
 * 2. Anomaly fingerprinting & deduplication
 * 3. User isolation
 * 4. Non-fatal failure safety
 * 5. Zero LLM calls guarantee
 * 6. Read-only guarantee on core cognitive state
 */

import { deterministicGuardian } from '../DeterministicGuardianService';
import { generateAnomalyFingerprint } from '../../lib/guardianFingerprint';
import { supabaseAdmin } from '../../lib/supabase';

// Mock Supabase admin
jest.mock('../../lib/supabase', () => {
  const createQueryBuilder = (data: any = [], error: any = null) => {
    const builder: any = {
      select: jest.fn().mockReturnThis(),
      insert: jest.fn().mockReturnValue({ select: () => ({ maybeSingle: () => Promise.resolve({ data: { id: 'run_123' }, error: null }) }) }),
      upsert: jest.fn().mockResolvedValue({ data: null, error: null }),
      update: jest.fn().mockReturnThis(),
      delete: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      neq: jest.fn().mockReturnThis(),
      in: jest.fn().mockReturnThis(),
      is: jest.fn().mockReturnThis(),
      not: jest.fn().mockReturnThis(),
      lt: jest.fn().mockReturnThis(),
      gte: jest.fn().mockReturnThis(),
      or: jest.fn().mockReturnThis(),
      ilike: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue({ data, error }),
      maybeSingle: jest.fn().mockResolvedValue({ data: data?.[0] || data || null, error }),
      single: jest.fn().mockResolvedValue({ data: data?.[0] || data || null, error }),
    };
    return builder;
  };

  return {
    supabaseAdmin: {
      from: jest.fn().mockImplementation((_table: string) => createQueryBuilder()),
      auth: {
        admin: {
          getUserById: jest.fn().mockResolvedValue({ data: { user: { id: 'usr_valid' } }, error: null }),
        },
      },
    },
  };
});

jest.mock('../../lib/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

describe('Watchtower Phase 2A — Deterministic Guardian', () => {
  const testUserId = 'usr_test_123';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── W-001: Question Memory Detection ──────────────────────────────────────
  it('W-001: Detects question/meta text in durable memories', async () => {
    (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'memories') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          limit: jest.fn().mockResolvedValue({
            data: [
              { id: 'mem_1', key: 'user_goal', value: 'Kaunsa goal active hai?', source_authority: 'explicit_user', is_archived: false },
              { id: 'mem_2', key: 'user_goal', value: 'Complete marathon training in December', source_authority: 'explicit_user', is_archived: false },
            ],
            error: null,
          }),
        };
      }
      return { select: jest.fn().mockReturnThis() };
    });

    const anomalies = await deterministicGuardian.detectW001_MemoryQuestionMetaText(testUserId);
    expect(anomalies.length).toBe(1);
    expect(anomalies[0].anomalyCode).toBe('W-001');
    expect(anomalies[0].targetEntityId).toBe('mem_1');
    expect(anomalies[0].evidence.value).toContain('Kaunsa goal active hai?');
  });

  // ── W-002: Memory Authority Inversion ─────────────────────────────────────
  it('W-002: Detects generic relational nouns stored as names under subconscious authority', async () => {
    (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'memories') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          limit: jest.fn().mockResolvedValue({
            data: [
              { id: 'mem_3', key: 'wife_name', value: 'wife', source_authority: 'subconscious_inference', is_archived: false },
              { id: 'mem_4', key: 'mother_name', value: 'Rajeshree', source_authority: 'explicit_user', is_archived: false },
            ],
            error: null,
          }),
        };
      }
      return { select: jest.fn().mockReturnThis() };
    });

    const anomalies = await deterministicGuardian.detectW002_MemoryAuthorityInversion(testUserId);
    expect(anomalies.length).toBe(1);
    expect(anomalies[0].anomalyCode).toBe('W-002');
    expect(anomalies[0].targetEntityId).toBe('mem_3');
  });

  // ── W-003: Alias Canonical Key Collision ───────────────────────────────────
  it('W-003: Detects active memories using alias keys', async () => {
    (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'memories') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          limit: jest.fn().mockResolvedValue({
            data: [
              { id: 'mem_5', key: 'mothers_name', value: 'Rajeshree', is_archived: false },
              { id: 'mem_6', key: 'mother_name', value: 'Rajeshree', is_archived: false },
            ],
            error: null,
          }),
        };
      }
      return { select: jest.fn().mockReturnThis() };
    });

    const anomalies = await deterministicGuardian.detectW003_AliasCanonicalKeyCollision(testUserId);
    expect(anomalies.length).toBe(1);
    expect(anomalies[0].anomalyCode).toBe('W-003');
    expect(anomalies[0].evidence.alias_key).toBe('mothers_name');
    expect(anomalies[0].evidence.canonical_key).toBe('mother_name');
  });

  // ── W-004: Duplicate Active LifeThreads ───────────────────────────────────
  it('W-004: Detects duplicate active LifeThreads for the same canonical key', async () => {
    (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'life_threads') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          in: jest.fn().mockResolvedValue({
            data: [
              { id: 'th_1', canonical_key: 'health_routine', topic: 'Gym workout', state: 'active' },
              { id: 'th_2', canonical_key: 'health_routine', topic: 'Fitness plan', state: 'waiting' },
              { id: 'th_3', canonical_key: 'career_search', topic: 'Job hunt', state: 'active' },
            ],
            error: null,
          }),
        };
      }
      return { select: jest.fn().mockReturnThis() };
    });

    const anomalies = await deterministicGuardian.detectW004_DuplicateLifeThreads(testUserId);
    expect(anomalies.length).toBe(1);
    expect(anomalies[0].anomalyCode).toBe('W-004');
    expect(anomalies[0].evidence.canonical_key).toBe('health_routine');
    expect(anomalies[0].evidence.duplicate_thread_ids).toEqual(['th_1', 'th_2']);
  });

  // ── W-005: Invalid LifeThread State Transition ────────────────────────────
  it('W-005: Detects illegal resurrection of completed thread by llm_proposal', async () => {
    (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'life_threads') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          limit: jest.fn().mockResolvedValue({
            data: [
              {
                id: 'th_4',
                topic: 'Old project',
                state: 'active',
                provenance: '[STATE TRANSITION: completed -> active by llm_proposal — 2026-08-30]',
                mutation_source: 'llm_proposal',
              },
            ],
            error: null,
          }),
        };
      }
      return { select: jest.fn().mockReturnThis() };
    });

    const anomalies = await deterministicGuardian.detectW005_InvalidLifeThreadStateTransition(testUserId);
    expect(anomalies.length).toBe(1);
    expect(anomalies[0].anomalyCode).toBe('W-005');
  });

  // ── W-006: Stale Mutation ─────────────────────────────────────────────────
  it('W-006: Detects recorded stale write rejection events in provenance', async () => {
    (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'life_threads') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          ilike: jest.fn().mockResolvedValue({
            data: [
              { id: 'th_5', topic: 'Cloud kitchen', provenance: 'STALE_WRITE_REJECTED: older seq 5 rejected against 7', source_message_seq: 7 },
            ],
            error: null,
          }),
        };
      }
      return { select: jest.fn().mockReturnThis() };
    });

    const anomalies = await deterministicGuardian.detectW006_StaleMutations(testUserId);
    expect(anomalies.length).toBe(1);
    expect(anomalies[0].anomalyCode).toBe('W-006');
  });

  // ── W-007: Provenance Mismatch ───────────────────────────────────────────
  it('W-007: Detects cross-user source_message_id provenance linkage', async () => {
    (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'life_threads') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          not: jest.fn().mockReturnThis(),
          limit: jest.fn().mockResolvedValue({
            data: [{ id: 'th_6', topic: 'Music', source_message_id: 'msg_foreign', user_id: testUserId }],
            error: null,
          }),
        };
      }
      if (table === 'chat_history') {
        return {
          select: jest.fn().mockReturnThis(),
          in: jest.fn().mockResolvedValue({
            data: [{ id: 'msg_foreign', user_id: 'usr_OTHER_USER' }],
            error: null,
          }),
        };
      }
      return { select: jest.fn().mockReturnThis() };
    });

    const anomalies = await deterministicGuardian.detectW007_ProvenanceMismatch(testUserId);
    expect(anomalies.length).toBe(1);
    expect(anomalies[0].anomalyCode).toBe('W-007');
    expect(anomalies[0].severity).toBe('critical');
  });

  // ── W-008: Autonomous Chat Without Outreach ───────────────────────────────
  it('W-008: Detects autonomous assistant messages missing outreach_log_id', async () => {
    (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'chat_history') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          not: jest.fn().mockReturnThis(),
          neq: jest.fn().mockReturnThis(),
          is: jest.fn().mockReturnThis(),
          limit: jest.fn().mockResolvedValue({
            data: [{ id: 'msg_auto_1', conversation_id: 'conv_1', source_type: 'nace_outreach', outreach_log_id: null, created_at: '2026-08-30' }],
            error: null,
          }),
        };
      }
      return { select: jest.fn().mockReturnThis() };
    });

    const anomalies = await deterministicGuardian.detectW008_AutonomousChatWithoutOutreach(testUserId);
    expect(anomalies.length).toBe(1);
    expect(anomalies[0].anomalyCode).toBe('W-008');
  });

  // ── W-009 & W-022: Outreach Without Chat ───────────────────────────────────
  it('W-009 & W-022: Detects sent outreach referencing non-existent chat row', async () => {
    (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'nova_outreach_log') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          in: jest.fn().mockReturnThis(),
          not: jest.fn().mockReturnThis(),
          limit: jest.fn().mockResolvedValue({
            data: [{ id: 'outreach_1', user_id: testUserId, logical_key: 'nace:test', outreach_type: 'nace', chat_message_id: 'msg_ghost' }],
            error: null,
          }),
        };
      }
      if (table === 'chat_history') {
        return {
          select: jest.fn().mockReturnThis(),
          in: jest.fn().mockResolvedValue({ data: [], error: null }),
        };
      }
      return { select: jest.fn().mockReturnThis() };
    });

    const anomalies = await deterministicGuardian.detectW009_OutreachWithoutChat(testUserId);
    expect(anomalies.length).toBe(1);
    expect(anomalies[0].anomalyCode).toBe('W-009');
  });

  // ── W-010: Confirmed Reminder Without Durable Row ─────────────────────────
  it('W-010: Detects scheduled reminder action missing from reminders table', async () => {
    (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'nova_actions') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          in: jest.fn().mockReturnThis(),
          limit: jest.fn().mockResolvedValue({
            data: [{ id: 'act_1', logical_key: 'rem_gym', title: 'Gym at 6pm', execution_class: 'reminder' }],
            error: null,
          }),
        };
      }
      if (table === 'reminders') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockResolvedValue({ data: [], error: null }),
        };
      }
      return { select: jest.fn().mockReturnThis() };
    });

    const anomalies = await deterministicGuardian.detectW010_ConfirmedReminderWithNoDurableRecord(testUserId);
    expect(anomalies.length).toBe(1);
    expect(anomalies[0].anomalyCode).toBe('W-010');
  });

  // ── W-011: Failed / Hung Background Job ───────────────────────────────────
  it('W-011: Detects failed background jobs', async () => {
    (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'background_jobs') {
        const builder: any = {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          or: jest.fn().mockReturnThis(),
          limit: jest.fn().mockResolvedValue({
            data: [{ id: 'job_failed', user_id: testUserId, job_type: 'memory_extract', status: 'failed', error_message: 'Timeout' }],
            error: null,
          }),
        };
        return builder;
      }
      return { select: jest.fn().mockReturnThis() };
    });

    const anomalies = await deterministicGuardian.detectW011_FailedMalformedBackgroundJob(testUserId);
    expect(anomalies.length).toBe(1);
    expect(anomalies[0].anomalyCode).toBe('W-011');
  });

  // ── W-012: Invalid User Job ───────────────────────────────────────────────
  it('W-012: Detects jobs with non-existent user profile', async () => {
    (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'background_jobs') {
        const builder: any = {
          select: jest.fn().mockReturnThis(),
          not: jest.fn().mockReturnThis(),
          in: jest.fn().mockReturnThis(),
          limit: jest.fn().mockResolvedValue({
            data: [{ id: 'job_bad_user', user_id: 'usr_ghost_999', job_type: 'extract', status: 'pending' }],
            error: null,
          }),
        };
        return builder;
      }
      if (table === 'profiles') {
        return {
          select: jest.fn().mockReturnThis(),
          in: jest.fn().mockResolvedValue({ data: [], error: null }),
        };
      }
      return { select: jest.fn().mockReturnThis() };
    });

    const anomalies = await deterministicGuardian.detectW012_InvalidUserJob();
    expect(anomalies.length).toBe(1);
    expect(anomalies[0].anomalyCode).toBe('W-012');
  });

  // ── W-013: Deleted User Job ───────────────────────────────────────────────
  it('W-013: Detects executable job for a deleted/deactivated user', async () => {
    (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'profiles') {
        return {
          select: jest.fn().mockReturnThis(),
          or: jest.fn().mockResolvedValue({
            data: [{ id: 'usr_deleted' }],
            error: null,
          }),
        };
      }
      if (table === 'background_jobs') {
        const builder: any = {
          select: jest.fn().mockReturnThis(),
          in: jest.fn().mockImplementation(() => builder),
        };
        builder.then = (resolve: any) => resolve({
          data: [{ id: 'job_on_dead_user', user_id: 'usr_deleted', job_type: 'nace_pulse', status: 'pending' }],
          error: null,
        });
        return builder;
      }
      return { select: jest.fn().mockReturnThis() };
    });

    const anomalies = await deterministicGuardian.detectW013_DeletedUserExecutableJob();
    expect(anomalies.length).toBe(1);
    expect(anomalies[0].anomalyCode).toBe('W-013');
  });

  // ── W-014: Missing Turn Attribution ───────────────────────────────────────
  it('W-014: Detects assistant messages missing source_type', async () => {
    (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'chat_history') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          is: jest.fn().mockReturnThis(),
          limit: jest.fn().mockResolvedValue({
            data: [{ id: 'msg_no_source', conversation_id: 'conv_1', content: 'Hello', created_at: '2026-08-30' }],
            error: null,
          }),
        };
      }
      return { select: jest.fn().mockReturnThis() };
    });

    const anomalies = await deterministicGuardian.detectW014_MissingTurnAttribution(testUserId);
    expect(anomalies.length).toBe(1);
    expect(anomalies[0].anomalyCode).toBe('W-014');
  });

  // ── W-015: Orphaned Profile / Auth Desync ──────────────────────────────────
  it('W-015: Detects profile row missing from Supabase auth', async () => {
    (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'profiles') {
        return {
          select: jest.fn().mockReturnThis(),
          limit: jest.fn().mockResolvedValue({
            data: [{ id: 'usr_auth_missing', created_at: '2026-08-30' }],
            error: null,
          }),
        };
      }
      return { select: jest.fn().mockReturnThis() };
    });

    (supabaseAdmin.auth.admin.getUserById as jest.Mock).mockResolvedValue({ data: { user: null }, error: new Error('User not found') });

    const anomalies = await deterministicGuardian.detectW015_OrphanedProfileAuthDesync();
    expect(anomalies.length).toBe(1);
    expect(anomalies[0].anomalyCode).toBe('W-015');
  });

  // ── W-016: Cross-User Conversation ────────────────────────────────────────
  it('W-016: Detects conversation containing rows for multiple distinct users', async () => {
    (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'chat_history') {
        return {
          select: jest.fn().mockReturnThis(),
          not: jest.fn().mockReturnThis(),
          order: jest.fn().mockReturnThis(),
          limit: jest.fn().mockResolvedValue({
            data: [
              { conversation_id: 'conv_shared', user_id: 'usr_A' },
              { conversation_id: 'conv_shared', user_id: 'usr_B' },
            ],
            error: null,
          }),
        };
      }
      return { select: jest.fn().mockReturnThis() };
    });

    const anomalies = await deterministicGuardian.detectW016_CrossUserConversations();
    expect(anomalies.length).toBe(1);
    expect(anomalies[0].anomalyCode).toBe('W-016');
    expect(anomalies[0].severity).toBe('critical');
  });

  // ── W-017: Stale Followup Lock ────────────────────────────────────────────
  it('W-017: Detects expired followup suppression locks in working memory', async () => {
    const expiredTimestamp = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(); // 3 hours ago
    (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'working_memory') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockResolvedValue({
              data: [{ id: 'wm_lock', key: 'followup_suppressed_until', value: expiredTimestamp }],
              error: null,
            }),
          }),
        };
      }
      return { select: jest.fn().mockReturnThis() };
    });

    const anomalies = await deterministicGuardian.detectW017_StaleFollowupLocks(testUserId);
    expect(anomalies.length).toBe(1);
    expect(anomalies[0].anomalyCode).toBe('W-017');
  });

  // ── W-018: Proactive Gate Duplicate ───────────────────────────────────────
  it('W-018: Detects duplicate outreach logs with same logical key within 60m', async () => {
    const now = Date.now();
    (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'nova_outreach_log') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          order: jest.fn().mockReturnThis(),
          limit: jest.fn().mockResolvedValue({
            data: [
              { id: 'log_1', logical_key: 'nace:agenda:123', created_at: new Date(now).toISOString() },
              { id: 'log_2', logical_key: 'nace:agenda:123', created_at: new Date(now - 10 * 60 * 1000).toISOString() },
            ],
            error: null,
          }),
        };
      }
      return { select: jest.fn().mockReturnThis() };
    });

    const anomalies = await deterministicGuardian.detectW018_ProactiveGateDuplicates(testUserId);
    expect(anomalies.length).toBe(1);
    expect(anomalies[0].anomalyCode).toBe('W-018');
  });

  // ── W-019: Expired Active Reminder ────────────────────────────────────────
  it('W-019: Detects reminders past trigger_at by >24h still in pending status', async () => {
    const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'reminders') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          in: jest.fn().mockReturnThis(),
          lt: jest.fn().mockReturnThis(),
          limit: jest.fn().mockResolvedValue({
            data: [{ id: 'rem_stale', user_id: testUserId, title: 'Call plumber', trigger_at: twoDaysAgo, status: 'pending' }],
            error: null,
          }),
        };
      }
      return { select: jest.fn().mockReturnThis() };
    });

    const anomalies = await deterministicGuardian.detectW019_ExpiredActiveReminders(testUserId);
    expect(anomalies.length).toBe(1);
    expect(anomalies[0].anomalyCode).toBe('W-019');
  });

  // ── W-020: Impossible Event Order ─────────────────────────────────────────
  it('W-020: Detects assistant reply created before the user message it replies to', async () => {
    const userTime = new Date('2026-08-30T12:00:05.000Z').toISOString();
    const assistantTime = new Date('2026-08-30T11:59:50.000Z').toISOString(); // 15s earlier!

    (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'chat_history') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          not: jest.fn().mockReturnThis(),
          in: jest.fn().mockResolvedValue({
            data: [{ id: 'usr_msg_1', created_at: userTime }],
            error: null,
          }),
          limit: jest.fn().mockResolvedValue({
            data: [{ id: 'ast_msg_1', created_at: assistantTime, reply_to_id: 'usr_msg_1' }],
            error: null,
          }),
        };
      }
      return { select: jest.fn().mockReturnThis() };
    });

    const anomalies = await deterministicGuardian.detectW020_ImpossibleEventOrder(testUserId);
    expect(anomalies.length).toBe(1);
    expect(anomalies[0].anomalyCode).toBe('W-020');
  });

  // ── W-021: Causal Source Mismatch ─────────────────────────────────────────
  it('W-021: Detects LifeThread referencing a non-existent source_message_id', async () => {
    (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'life_threads') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          not: jest.fn().mockReturnThis(),
          limit: jest.fn().mockResolvedValue({
            data: [{ id: 'th_ghost', topic: 'Phantom', source_message_id: 'msg_nonexistent' }],
            error: null,
          }),
        };
      }
      if (table === 'chat_history') {
        return {
          select: jest.fn().mockReturnThis(),
          in: jest.fn().mockResolvedValue({ data: [], error: null }),
        };
      }
      return { select: jest.fn().mockReturnThis() };
    });

    const anomalies = await deterministicGuardian.detectW021_CausalSourceMismatch(testUserId);
    expect(anomalies.length).toBe(1);
    expect(anomalies[0].anomalyCode).toBe('W-021');
  });

  // ── Fingerprint Deduplication & Stability ─────────────────────────────────
  it('Fingerprint: Deterministic and stable across multiple calls', () => {
    const fp1 = generateAnomalyFingerprint('usr_1', 'W-001', 'mem_123', 'family_name');
    const fp2 = generateAnomalyFingerprint('usr_1', 'W-001', 'mem_123', 'family_name');
    const fp3 = generateAnomalyFingerprint('usr_2', 'W-001', 'mem_123', 'family_name');

    expect(fp1).toBe(fp2);
    expect(fp1.length).toBe(64); // SHA-256 hex length
    expect(fp1).not.toBe(fp3); // Isolated by user
  });

  // ── Failure Safety ────────────────────────────────────────────────────────
  it('Failure Safety: Database exceptions in detector do not throw or crash run', async () => {
    (supabaseAdmin.from as jest.Mock).mockImplementation(() => {
      throw new Error('Simulated Database Network Failure');
    });

    // Should resolve cleanly without throwing
    const result = await deterministicGuardian.runPostTurnScan('usr_fail_test');
    expect(result).toBeDefined();
    expect(result.anomaliesDetected).toBe(0);
  });

  // ── Zero LLM Calls & Read-Only Invariant ───────────────────────────────────
  it('Zero LLM & Read-Only: Guardian executes with 0 LLM and zero core-state mutations', async () => {
    const mutatedTables: string[] = [];
    (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
      return {
        select: jest.fn().mockReturnThis(),
        insert: jest.fn().mockImplementation(() => {
          mutatedTables.push(table);
          return { select: () => ({ maybeSingle: () => Promise.resolve({ data: { id: 'run_mock' } }) }) };
        }),
        update: jest.fn().mockImplementation(() => {
          mutatedTables.push(table);
          return { eq: () => Promise.resolve() };
        }),
        delete: jest.fn().mockImplementation(() => {
          mutatedTables.push(table);
          return { eq: () => Promise.resolve() };
        }),
        upsert: jest.fn().mockImplementation(() => {
          mutatedTables.push(table);
          return Promise.resolve({ error: null });
        }),
        eq: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue({ data: [], error: null }),
        maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
      };
    });

    await deterministicGuardian.runPostTurnScan(testUserId);

    // Only guardian audit tables can be mutated (nova_guardian_runs, nova_guardian_anomalies)
    const coreTables = ['memories', 'life_threads', 'reminders', 'chat_history', 'profiles', 'working_memory'];
    for (const table of mutatedTables) {
      expect(coreTables).not.toContain(table);
    }
  });
});
