-- ============================================================
-- Migration: 20260922_rls_comprehensive_security.sql
-- Purpose: Enable RLS on ALL user-data and system tables.
--          Apply correct per-table policies.
--          Revoke unnecessary anon/authenticated table privileges.
--
-- Access model:
--   USER DATA TABLES: service_role + authenticated owner only
--   SYSTEM/JOB TABLES: service_role only (no user direct access)
--   PUBLIC TABLES: explicitly noted (none for this system)
--
-- IMPORTANT: Backend uses service_role key — service_role bypasses RLS.
--            All supabase-js calls from backend use service_role → unaffected.
--            Mobile uses anon key → JWT authenticated → user context available.
--            This migration only blocks anonymous (unauthenticated) access
--            and prevents authenticated cross-user data leakage.
-- ============================================================

-- ──────────────────────────────────────────────────────────────
-- SECTION A: USER-OWNED DATA TABLES
-- Policy: authenticated users can only see/modify their OWN rows.
--         Service role (backend) retains full access.
-- ──────────────────────────────────────────────────────────────

-- profiles
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "profiles_owner_select" ON public.profiles;
DROP POLICY IF EXISTS "profiles_owner_update" ON public.profiles;
CREATE POLICY "profiles_owner_select" ON public.profiles
  FOR SELECT USING (auth.uid() = id);
CREATE POLICY "profiles_owner_update" ON public.profiles
  FOR UPDATE USING (auth.uid() = id);

-- chat_history
ALTER TABLE public.chat_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "chat_history_owner_all" ON public.chat_history;
CREATE POLICY "chat_history_owner_all" ON public.chat_history
  FOR ALL USING (auth.uid() = user_id);

-- memories
ALTER TABLE public.memories ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "memories_owner_all" ON public.memories;
CREATE POLICY "memories_owner_all" ON public.memories
  FOR ALL USING (auth.uid() = user_id);

-- memory_bubbles
ALTER TABLE public.memory_bubbles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "memory_bubbles_owner_all" ON public.memory_bubbles;
CREATE POLICY "memory_bubbles_owner_all" ON public.memory_bubbles
  FOR ALL USING (auth.uid() = user_id);

-- working_memory
ALTER TABLE public.working_memory ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "working_memory_owner_all" ON public.working_memory;
CREATE POLICY "working_memory_owner_all" ON public.working_memory
  FOR ALL USING (auth.uid() = user_id);

-- kg_nodes
ALTER TABLE public.kg_nodes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "kg_nodes_owner_all" ON public.kg_nodes;
CREATE POLICY "kg_nodes_owner_all" ON public.kg_nodes
  FOR ALL USING (auth.uid() = user_id);

-- kg_edges
ALTER TABLE public.kg_edges ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "kg_edges_owner_all" ON public.kg_edges;
CREATE POLICY "kg_edges_owner_all" ON public.kg_edges
  FOR ALL USING (auth.uid() = user_id);

-- nova_agenda
ALTER TABLE public.nova_agenda ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "nova_agenda_owner_all" ON public.nova_agenda;
CREATE POLICY "nova_agenda_owner_all" ON public.nova_agenda
  FOR ALL USING (auth.uid() = user_id);

-- nova_outreach_log
ALTER TABLE public.nova_outreach_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "nova_outreach_log_owner_select" ON public.nova_outreach_log;
CREATE POLICY "nova_outreach_log_owner_select" ON public.nova_outreach_log
  FOR SELECT USING (auth.uid() = user_id);
-- Backend (service_role) handles all inserts/updates

-- emotional_states
ALTER TABLE public.emotional_states ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "emotional_states_owner_all" ON public.emotional_states;
CREATE POLICY "emotional_states_owner_all" ON public.emotional_states
  FOR ALL USING (auth.uid() = user_id);

-- reflections
ALTER TABLE public.reflections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "reflections_owner_all" ON public.reflections;
CREATE POLICY "reflections_owner_all" ON public.reflections
  FOR ALL USING (auth.uid() = user_id);

-- user_moments
ALTER TABLE public.user_moments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "user_moments_owner_all" ON public.user_moments;
CREATE POLICY "user_moments_owner_all" ON public.user_moments
  FOR ALL USING (auth.uid() = user_id);

-- user_moment_preferences
ALTER TABLE public.user_moment_preferences ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "user_moment_preferences_owner_all" ON public.user_moment_preferences;
CREATE POLICY "user_moment_preferences_owner_all" ON public.user_moment_preferences
  FOR ALL USING (auth.uid() = user_id);

-- user_routines
ALTER TABLE public.user_routines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "user_routines_owner_all" ON public.user_routines;
CREATE POLICY "user_routines_owner_all" ON public.user_routines
  FOR ALL USING (auth.uid() = user_id);

-- reminders
ALTER TABLE public.reminders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "reminders_owner_all" ON public.reminders;
CREATE POLICY "reminders_owner_all" ON public.reminders
  FOR ALL USING (auth.uid() = user_id);

-- life_threads
ALTER TABLE public.life_threads ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "life_threads_owner_all" ON public.life_threads;
CREATE POLICY "life_threads_owner_all" ON public.life_threads
  FOR ALL USING (auth.uid() = user_id);

-- short_term_memories
ALTER TABLE public.short_term_memories ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "short_term_memories_owner_all" ON public.short_term_memories;
CREATE POLICY "short_term_memories_owner_all" ON public.short_term_memories
  FOR ALL USING (auth.uid() = user_id);

-- user_presence
ALTER TABLE public.user_presence ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "user_presence_owner_all" ON public.user_presence;
CREATE POLICY "user_presence_owner_all" ON public.user_presence
  FOR ALL USING (auth.uid() = user_id);

-- canonical_entity_corrections (if exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'canonical_entity_corrections') THEN
    EXECUTE 'ALTER TABLE public.canonical_entity_corrections ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS "corrections_owner_all" ON public.canonical_entity_corrections';
    EXECUTE 'CREATE POLICY "corrections_owner_all" ON public.canonical_entity_corrections FOR ALL USING (auth.uid() = user_id)';
  END IF;
END $$;

-- ──────────────────────────────────────────────────────────────
-- SECTION B: SYSTEM / INFRASTRUCTURE TABLES
-- Policy: service_role only (no authenticated user direct access)
--         No user-facing policies needed — backend handles all ops.
-- ──────────────────────────────────────────────────────────────

-- background_jobs
ALTER TABLE public.background_jobs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "background_jobs_no_user_access" ON public.background_jobs;
-- No SELECT/INSERT/UPDATE/DELETE policies for authenticated/anon — service_role bypasses RLS

-- failed_jobs
ALTER TABLE public.failed_jobs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "failed_jobs_no_user_access" ON public.failed_jobs;

-- processed_jobs
ALTER TABLE public.processed_jobs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "processed_jobs_no_user_access" ON public.processed_jobs;

-- telemetry_events
ALTER TABLE public.telemetry_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "telemetry_events_owner_insert" ON public.telemetry_events;
-- Only backend can insert/read; users cannot query their own telemetry directly

-- ──────────────────────────────────────────────────────────────
-- SECTION C: CONDITIONAL TABLES (apply if exist)
-- ──────────────────────────────────────────────────────────────

DO $$
BEGIN
  -- presence_history
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'presence_history') THEN
    EXECUTE 'ALTER TABLE public.presence_history ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS "presence_history_owner_all" ON public.presence_history';
    EXECUTE 'CREATE POLICY "presence_history_owner_all" ON public.presence_history FOR ALL USING (auth.uid() = user_id)';
  END IF;

  -- audit_log (system only)
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'audit_log') THEN
    EXECUTE 'ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY';
    -- No user-facing policies: service_role only
  END IF;

  -- user_feedback
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'user_feedback') THEN
    EXECUTE 'ALTER TABLE public.user_feedback ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS "user_feedback_owner_all" ON public.user_feedback';
    EXECUTE 'CREATE POLICY "user_feedback_owner_all" ON public.user_feedback FOR ALL USING (auth.uid() = user_id)';
  END IF;

  -- nova_outreach_dispatched
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'nova_outreach_dispatched') THEN
    EXECUTE 'ALTER TABLE public.nova_outreach_dispatched ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS "outreach_dispatched_owner_select" ON public.nova_outreach_dispatched';
    EXECUTE 'CREATE POLICY "outreach_dispatched_owner_select" ON public.nova_outreach_dispatched FOR SELECT USING (auth.uid() = user_id)';
  END IF;
END $$;

-- ──────────────────────────────────────────────────────────────
-- SECTION D: kg_edges UNIQUE CONSTRAINT (previously unapplied)
-- ──────────────────────────────────────────────────────────────

-- First deduplicate any existing duplicate edges (keep the oldest by id)
DELETE FROM public.kg_edges
WHERE id NOT IN (
  SELECT MIN(id)
  FROM public.kg_edges
  GROUP BY user_id, source_node_id, target_node_id, relation_type
);

-- Now apply the unique index (safe — no duplicates remain)
DROP INDEX IF EXISTS public.idx_kg_edges_canonical_unique;
CREATE UNIQUE INDEX idx_kg_edges_canonical_unique
  ON public.kg_edges(user_id, source_node_id, target_node_id, relation_type);

-- ──────────────────────────────────────────────────────────────
-- SECTION E: REVOKE UNNECESSARY TABLE-LEVEL GRANTS
-- Supabase anon/authenticated roles should NOT have broad table grants
-- when RLS is in place. RLS policies are the access control layer.
-- These revokes are belt-and-suspenders.
-- ──────────────────────────────────────────────────────────────

-- Revoke broad table-level INSERT/UPDATE/DELETE from anon on system tables
REVOKE INSERT, UPDATE, DELETE ON public.background_jobs FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.failed_jobs FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.processed_jobs FROM anon, authenticated;
REVOKE ALL ON public.telemetry_events FROM anon;
REVOKE ALL ON public.background_jobs FROM anon;
REVOKE ALL ON public.failed_jobs FROM anon;
REVOKE ALL ON public.processed_jobs FROM anon;

-- Revoke anon SELECT from all user-data tables
-- (RLS will block if enabled, but explicit revoke is belt-and-suspenders)
REVOKE SELECT ON public.profiles FROM anon;
REVOKE SELECT ON public.chat_history FROM anon;
REVOKE SELECT ON public.memories FROM anon;
REVOKE SELECT ON public.memory_bubbles FROM anon;
REVOKE SELECT ON public.working_memory FROM anon;
REVOKE SELECT ON public.kg_nodes FROM anon;
REVOKE SELECT ON public.kg_edges FROM anon;
REVOKE SELECT ON public.nova_agenda FROM anon;
REVOKE SELECT ON public.nova_outreach_log FROM anon;
REVOKE SELECT ON public.emotional_states FROM anon;
REVOKE SELECT ON public.reflections FROM anon;
REVOKE SELECT ON public.user_moments FROM anon;
REVOKE SELECT ON public.user_moment_preferences FROM anon;
REVOKE SELECT ON public.user_routines FROM anon;
REVOKE SELECT ON public.reminders FROM anon;
REVOKE SELECT ON public.life_threads FROM anon;
REVOKE SELECT ON public.short_term_memories FROM anon;
REVOKE SELECT ON public.user_presence FROM anon;

-- ──────────────────────────────────────────────────────────────
-- SECTION F: VERIFICATION QUERIES (run after migration)
-- Copy-paste these into Supabase SQL editor to verify:
-- ──────────────────────────────────────────────────────────────

-- 1. Check RLS is enabled on all tables:
-- SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;

-- 2. Check unique index on kg_edges:
-- SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'kg_edges' AND schemaname = 'public';

-- 3. Check policies:
-- SELECT tablename, policyname, permissive, roles, cmd, qual FROM pg_policies WHERE schemaname = 'public' ORDER BY tablename;
