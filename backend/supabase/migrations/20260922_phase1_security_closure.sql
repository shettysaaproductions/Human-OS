-- ============================================================
-- Migration: 20260922_phase1_security_closure.sql
-- Purpose: Close all 17 remaining unprotected public tables.
--
-- INDEPENDENT AUDIT FINDINGS (live Supabase, 2026-09-22):
--   Total public tables: 55
--   Tables without RLS:  17 (confirmed via pg_tables)
--   Tables with anon READ: 32 (confirmed via role_table_grants)
--
-- Classification per table:
--   USER_OWNED  → RLS + auth.uid() = user_id policy
--   SYSTEM_ONLY → RLS + service_role-only policy + REVOKE from anon/authenticated
--   CONFIG      → RLS + service_role-only policy + REVOKE from anon/authenticated
--
-- User-owned tables (6):
--   conversation_sessions, episodic_memories, nova_cognitive_doubts,
--   nova_corrections_log, recovery_archive, tombstones
--
-- System/config-only tables (11):
--   agent_metrics, app_settings, audit_logs, llm_providers,
--   memory_access_log, memory_events, nova_guardian_anomalies,
--   nova_guardian_repairs, nova_guardian_runs, nova_scan_checkpoints,
--   query_metrics
--
-- ALSO: Fix existing "public" role policies on user tables.
--   Several already-RLS-enabled tables use TO public in their
--   ALL policies. This is technically fine because USING (auth.uid() = user_id)
--   blocks anon (auth.uid() returns NULL for anon, which != any user_id).
--   We add explicit TO authenticated variants to make intent clear.
-- ============================================================

BEGIN;

-- ──────────────────────────────────────────────────────────────────────────────
-- SECTION A: USER-OWNED TABLES
-- Enable RLS + owner policy (auth.uid() = user_id)
-- ──────────────────────────────────────────────────────────────────────────────

-- A1. conversation_sessions
ALTER TABLE public.conversation_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS conversation_sessions_owner_all ON public.conversation_sessions;
CREATE POLICY conversation_sessions_owner_all
  ON public.conversation_sessions
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- A2. episodic_memories
ALTER TABLE public.episodic_memories ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS episodic_memories_owner_all ON public.episodic_memories;
CREATE POLICY episodic_memories_owner_all
  ON public.episodic_memories
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- A3. nova_cognitive_doubts (has user_id confirmed by pre-flight)
ALTER TABLE public.nova_cognitive_doubts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS nova_cognitive_doubts_service_all ON public.nova_cognitive_doubts;
DROP POLICY IF EXISTS nova_cognitive_doubts_owner_all ON public.nova_cognitive_doubts;
CREATE POLICY nova_cognitive_doubts_owner_all
  ON public.nova_cognitive_doubts FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- A4. nova_corrections_log (has user_id confirmed by pre-flight)
ALTER TABLE public.nova_corrections_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS nova_corrections_log_owner_all ON public.nova_corrections_log;
DROP POLICY IF EXISTS nova_corrections_log_service_all ON public.nova_corrections_log;
CREATE POLICY nova_corrections_log_owner_all
  ON public.nova_corrections_log FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- A5. recovery_archive (NO user_id confirmed by pre-flight — service_role only)
ALTER TABLE public.recovery_archive ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS recovery_archive_owner_all ON public.recovery_archive;
DROP POLICY IF EXISTS recovery_archive_service_all ON public.recovery_archive;
CREATE POLICY recovery_archive_service_all
  ON public.recovery_archive FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);
REVOKE ALL ON public.recovery_archive FROM anon;
REVOKE ALL ON public.recovery_archive FROM authenticated;

-- A6. tombstones (NO user_id confirmed by pre-flight — service_role only)
ALTER TABLE public.tombstones ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tombstones_owner_all ON public.tombstones;
DROP POLICY IF EXISTS tombstones_service_all ON public.tombstones;
CREATE POLICY tombstones_service_all
  ON public.tombstones FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);
REVOKE ALL ON public.tombstones FROM anon;
REVOKE ALL ON public.tombstones FROM authenticated;

-- ──────────────────────────────────────────────────────────────────────────────
-- SECTION B: SYSTEM-ONLY TABLES
-- Enable RLS + service_role-only policy + REVOKE from anon/authenticated
-- These tables must NEVER be accessible from the mobile client
-- ──────────────────────────────────────────────────────────────────────────────

-- B1. agent_metrics
ALTER TABLE public.agent_metrics ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS agent_metrics_service_all ON public.agent_metrics;
CREATE POLICY agent_metrics_service_all
  ON public.agent_metrics FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);
REVOKE ALL ON public.agent_metrics FROM anon;
REVOKE ALL ON public.agent_metrics FROM authenticated;

-- B2. audit_logs
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS audit_logs_service_all ON public.audit_logs;
CREATE POLICY audit_logs_service_all
  ON public.audit_logs FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);
REVOKE ALL ON public.audit_logs FROM anon;
REVOKE ALL ON public.audit_logs FROM authenticated;

-- B3. memory_access_log
ALTER TABLE public.memory_access_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS memory_access_log_service_all ON public.memory_access_log;
CREATE POLICY memory_access_log_service_all
  ON public.memory_access_log FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);
REVOKE ALL ON public.memory_access_log FROM anon;
REVOKE ALL ON public.memory_access_log FROM authenticated;

-- B4. memory_events
ALTER TABLE public.memory_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS memory_events_service_all ON public.memory_events;
CREATE POLICY memory_events_service_all
  ON public.memory_events FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);
REVOKE ALL ON public.memory_events FROM anon;
REVOKE ALL ON public.memory_events FROM authenticated;

-- B5. nova_guardian_anomalies
ALTER TABLE public.nova_guardian_anomalies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS nova_guardian_anomalies_service_all ON public.nova_guardian_anomalies;
CREATE POLICY nova_guardian_anomalies_service_all
  ON public.nova_guardian_anomalies FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);
REVOKE ALL ON public.nova_guardian_anomalies FROM anon;
REVOKE ALL ON public.nova_guardian_anomalies FROM authenticated;

-- B6. nova_guardian_repairs
ALTER TABLE public.nova_guardian_repairs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS nova_guardian_repairs_service_all ON public.nova_guardian_repairs;
CREATE POLICY nova_guardian_repairs_service_all
  ON public.nova_guardian_repairs FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);
REVOKE ALL ON public.nova_guardian_repairs FROM anon;
REVOKE ALL ON public.nova_guardian_repairs FROM authenticated;

-- B7. nova_guardian_runs
ALTER TABLE public.nova_guardian_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS nova_guardian_runs_service_all ON public.nova_guardian_runs;
CREATE POLICY nova_guardian_runs_service_all
  ON public.nova_guardian_runs FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);
REVOKE ALL ON public.nova_guardian_runs FROM anon;
REVOKE ALL ON public.nova_guardian_runs FROM authenticated;

-- B8. nova_scan_checkpoints
ALTER TABLE public.nova_scan_checkpoints ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS nova_scan_checkpoints_service_all ON public.nova_scan_checkpoints;
CREATE POLICY nova_scan_checkpoints_service_all
  ON public.nova_scan_checkpoints FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);
REVOKE ALL ON public.nova_scan_checkpoints FROM anon;
REVOKE ALL ON public.nova_scan_checkpoints FROM authenticated;

-- B9. query_metrics
ALTER TABLE public.query_metrics ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS query_metrics_service_all ON public.query_metrics;
CREATE POLICY query_metrics_service_all
  ON public.query_metrics FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);
REVOKE ALL ON public.query_metrics FROM anon;
REVOKE ALL ON public.query_metrics FROM authenticated;

-- ──────────────────────────────────────────────────────────────────────────────
-- SECTION C: CONFIG TABLES
-- app_settings: read-only for authenticated users (public config), no anon
-- llm_providers: service-role only (contains internal routing config)
-- ──────────────────────────────────────────────────────────────────────────────

-- C1. app_settings — read-only by authenticated users, service_role for writes
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS app_settings_authenticated_read ON public.app_settings;
DROP POLICY IF EXISTS app_settings_service_write ON public.app_settings;
CREATE POLICY app_settings_authenticated_read
  ON public.app_settings FOR SELECT
  TO authenticated
  USING (true);
CREATE POLICY app_settings_service_write
  ON public.app_settings FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);
REVOKE ALL ON public.app_settings FROM anon;

-- C2. llm_providers — service_role only (contains LLM routing config / API metadata)
ALTER TABLE public.llm_providers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS llm_providers_service_all ON public.llm_providers;
CREATE POLICY llm_providers_service_all
  ON public.llm_providers FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);
REVOKE ALL ON public.llm_providers FROM anon;
REVOKE ALL ON public.llm_providers FROM authenticated;

-- ──────────────────────────────────────────────────────────────────────────────
-- SECTION D: VERIFY AND TIGHTEN EXISTING POLICIES
-- Some "protected" tables use TO public instead of TO authenticated.
-- Replace with authenticated-only policies to make intent explicit.
-- Note: auth.uid() = user_id already blocks anon even with TO public,
-- but TO authenticated is more explicit and forward-safe.
-- ──────────────────────────────────────────────────────────────────────────────

-- D1. chat_history — re-pin to authenticated
DROP POLICY IF EXISTS chat_history_owner_all ON public.chat_history;
CREATE POLICY chat_history_owner_all
  ON public.chat_history FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- D2. memories
DROP POLICY IF EXISTS memories_owner_all ON public.memories;
CREATE POLICY memories_owner_all
  ON public.memories FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- D3. memory_bubbles
DROP POLICY IF EXISTS memory_bubbles_owner_all ON public.memory_bubbles;
CREATE POLICY memory_bubbles_owner_all
  ON public.memory_bubbles FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- D4. working_memory
DROP POLICY IF EXISTS working_memory_owner_all ON public.working_memory;
CREATE POLICY working_memory_owner_all
  ON public.working_memory FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- D5. kg_nodes
DROP POLICY IF EXISTS kg_nodes_owner_all ON public.kg_nodes;
CREATE POLICY kg_nodes_owner_all
  ON public.kg_nodes FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- D6. kg_edges
DROP POLICY IF EXISTS kg_edges_owner_all ON public.kg_edges;
CREATE POLICY kg_edges_owner_all
  ON public.kg_edges FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- D7. nova_agenda
DROP POLICY IF EXISTS nova_agenda_owner_all ON public.nova_agenda;
CREATE POLICY nova_agenda_owner_all
  ON public.nova_agenda FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- D8. nova_outreach_log
DROP POLICY IF EXISTS nova_outreach_log_owner_all ON public.nova_outreach_log;
CREATE POLICY nova_outreach_log_owner_all
  ON public.nova_outreach_log FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- D9. emotional_states
DROP POLICY IF EXISTS emotional_states_owner_all ON public.emotional_states;
CREATE POLICY emotional_states_owner_all
  ON public.emotional_states FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- D10. reflections
DROP POLICY IF EXISTS reflections_owner_all ON public.reflections;
CREATE POLICY reflections_owner_all
  ON public.reflections FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- D11. profiles
DROP POLICY IF EXISTS profiles_owner_all ON public.profiles;
CREATE POLICY profiles_owner_all
  ON public.profiles FOR ALL
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- D12. user_feedback
DROP POLICY IF EXISTS user_feedback_owner_all ON public.user_feedback;
CREATE POLICY user_feedback_owner_all
  ON public.user_feedback FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- D13. user_moments
DROP POLICY IF EXISTS user_moments_owner_all ON public.user_moments;
CREATE POLICY user_moments_owner_all
  ON public.user_moments FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- D14. user_moment_preferences
DROP POLICY IF EXISTS user_moment_preferences_owner_all ON public.user_moment_preferences;
CREATE POLICY user_moment_preferences_owner_all
  ON public.user_moment_preferences FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- D15. user_routines
DROP POLICY IF EXISTS user_routines_owner_all ON public.user_routines;
CREATE POLICY user_routines_owner_all
  ON public.user_routines FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- D16. life_threads
DROP POLICY IF EXISTS life_threads_owner_all ON public.life_threads;
DROP POLICY IF EXISTS "Users can manage own life threads" ON public.life_threads;
CREATE POLICY life_threads_owner_all
  ON public.life_threads FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- D17. reminders
DROP POLICY IF EXISTS reminders_owner_all ON public.reminders;
DROP POLICY IF EXISTS "Users can manage own reminders" ON public.reminders;
CREATE POLICY reminders_owner_all
  ON public.reminders FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

COMMIT;

-- ──────────────────────────────────────────────────────────────────────────────
-- VERIFICATION QUERY (run after migration)
-- Expected: 0 rows (all public tables have RLS enabled)
-- ──────────────────────────────────────────────────────────────────────────────
-- SELECT tablename, rowsecurity
-- FROM pg_tables
-- WHERE schemaname = 'public' AND rowsecurity = false
-- ORDER BY tablename;
