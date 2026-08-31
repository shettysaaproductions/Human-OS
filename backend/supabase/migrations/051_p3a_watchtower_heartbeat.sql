-- ─────────────────────────────────────────────────────────────────────────────
-- HUMAN OS — MIGRATION 051: Watchtower Phase 3A Heartbeat Foundation Schema
--
-- PURPOSE: Provide durable, database-backed execution identity, distributed
-- lease locking, and structured cognitive signals for the Watchtower heartbeat layer.
--
-- TABLES:
--   1. watchtower_heartbeat_runs     — Logical heartbeat runs and lease locks
--   2. watchtower_cognitive_signals  — Structured, expiring supervisory signals
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Create watchtower_heartbeat_runs table
CREATE TABLE IF NOT EXISTS public.watchtower_heartbeat_runs (
  id TEXT PRIMARY KEY, -- e.g. 'watchtower:2026-08-31:13:00'
  status TEXT NOT NULL DEFAULT 'STARTED' CHECK (
    status IN ('STARTED', 'RUNNING', 'COMPLETED', 'PARTIAL', 'FAILED', 'LEASE_EXPIRED')
  ),
  lease_owner TEXT NOT NULL,
  lease_until TIMESTAMPTZ NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  total_users_scanned INTEGER NOT NULL DEFAULT 0,
  observations_count INTEGER NOT NULL DEFAULT 0,
  anomalies_count INTEGER NOT NULL DEFAULT 0,
  doubts_count INTEGER NOT NULL DEFAULT 0,
  repairs_queued INTEGER NOT NULL DEFAULT 0,
  semantic_escalations INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_watchtower_heartbeat_runs_status
  ON public.watchtower_heartbeat_runs(status, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_watchtower_heartbeat_runs_lease
  ON public.watchtower_heartbeat_runs(status, lease_until);

-- 2. Create watchtower_cognitive_signals table
CREATE TABLE IF NOT EXISTS public.watchtower_cognitive_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  signal_type TEXT NOT NULL,
  category TEXT NOT NULL CHECK (
    category IN (
      'uncertainty',
      'contradiction',
      'provenance_gap',
      'stale_state',
      'repair_required',
      'clarification_required'
    )
  ),
  severity TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  entity TEXT NOT NULL,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  missing TEXT[] NOT NULL DEFAULT '{}',
  required_action TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'consumed', 'resolved', 'expired')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT uq_watchtower_signals_user_fingerprint UNIQUE(user_id, fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_watchtower_signals_user_status
  ON public.watchtower_cognitive_signals(user_id, status);

CREATE INDEX IF NOT EXISTS idx_watchtower_signals_expires_at
  ON public.watchtower_cognitive_signals(expires_at)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_watchtower_signals_category
  ON public.watchtower_cognitive_signals(category);

-- Enable RLS
ALTER TABLE public.watchtower_heartbeat_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.watchtower_cognitive_signals ENABLE ROW LEVEL SECURITY;

-- Allow service role full access
CREATE POLICY "Service role full access on watchtower_heartbeat_runs"
  ON public.watchtower_heartbeat_runs FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access on watchtower_cognitive_signals"
  ON public.watchtower_cognitive_signals FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMENT ON TABLE public.watchtower_heartbeat_runs IS
  'Watchtower Phase 3A: Database-backed distributed lease locks and telemetry for supervisory heartbeat runs.';

COMMENT ON TABLE public.watchtower_cognitive_signals IS
  'Watchtower Phase 3A: Structured, expiring supervisory cognitive signals for Nova context and proactive systems.';
