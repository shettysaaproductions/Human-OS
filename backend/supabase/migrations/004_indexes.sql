-- Human OS v3 Infrastructure Optimization — Migration 004
-- Run this in Supabase SQL Editor before deploying the backend.

-- ─────────────────────────────────────────────────────────────────
-- 1. Missing Indexes
-- ─────────────────────────────────────────────────────────────────

-- Faster conversation session upsert (user + date lookup)
CREATE INDEX IF NOT EXISTS idx_conversation_sessions_date
  ON public.conversation_sessions(user_id, session_date);

-- Faster working memory TTL expiry check
CREATE INDEX IF NOT EXISTS idx_working_memory_expires
  ON public.working_memory(user_id, expires_at);

-- Faster background job polling by status
CREATE INDEX IF NOT EXISTS idx_background_jobs_status
  ON public.background_jobs(status, created_at);

-- Faster idempotency checks
CREATE INDEX IF NOT EXISTS idx_processed_jobs_agent_message
  ON public.processed_jobs(agent_name, message_id);

-- Faster agent metrics analysis
CREATE INDEX IF NOT EXISTS idx_agent_metrics_agent_name
  ON public.agent_metrics(agent_name, created_at);

-- Faster memory key lookup (used in upsertMemory)
CREATE UNIQUE INDEX IF NOT EXISTS idx_memories_user_key
  ON public.memories(user_id, key);

-- Faster KG node name lookup
CREATE UNIQUE INDEX IF NOT EXISTS idx_kg_nodes_user_name
  ON public.kg_nodes(user_id, name);

-- ─────────────────────────────────────────────────────────────────
-- 2. Query Metrics Table
-- ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.query_metrics (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  query_name   TEXT        NOT NULL,
  table_name   TEXT        NOT NULL,
  duration_ms  INTEGER     NOT NULL,
  rows_returned INTEGER    NOT NULL DEFAULT 0,
  estimated_bytes INTEGER  NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_query_metrics_name
  ON public.query_metrics(query_name, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_query_metrics_created
  ON public.query_metrics(created_at DESC);

-- Auto-prune: keep only last 7 days of query metrics to prevent table bloat
-- (Run this as a pg_cron job in production, or manually weekly)
-- DELETE FROM public.query_metrics WHERE created_at < now() - interval '7 days';
