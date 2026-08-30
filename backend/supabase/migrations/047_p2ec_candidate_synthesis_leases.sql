-- ─────────────────────────────────────────────────────────────────────────────
-- HUMAN OS — MIGRATION 047: Phase 2E-C Candidate Synthesis Concurrency Leases
--
-- PURPOSE: Provide durable, database-backed execution identity and distributed
-- lease locking for nightly candidate synthesis (Phase 2E-C).
--
-- TABLES:
--   1. candidate_synthesis_runs   — Daily logical run identity (one per day)
--   2. candidate_synthesis_claims — Per-user distributed lease claims
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Create candidate_synthesis_runs table
CREATE TABLE IF NOT EXISTS public.candidate_synthesis_runs (
  id TEXT PRIMARY KEY, -- e.g. 'candidate_synthesis:2026-08-30'
  status TEXT NOT NULL DEFAULT 'running', -- 'running' | 'completed' | 'failed'
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  total_users INTEGER NOT NULL DEFAULT 0,
  candidates_created INTEGER NOT NULL DEFAULT 0,
  model_calls INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_candidate_synthesis_runs_status
  ON public.candidate_synthesis_runs(status, started_at DESC);

-- 2. Create candidate_synthesis_claims table
CREATE TABLE IF NOT EXISTS public.candidate_synthesis_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id TEXT NOT NULL REFERENCES public.candidate_synthesis_runs(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'claimed', -- 'claimed' | 'completed' | 'failed'
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  lease_until TIMESTAMPTZ NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 1,
  candidates_count INTEGER NOT NULL DEFAULT 0,
  model_called BOOLEAN NOT NULL DEFAULT false,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(run_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_candidate_synthesis_claims_run_user
  ON public.candidate_synthesis_claims(run_id, user_id);

CREATE INDEX IF NOT EXISTS idx_candidate_synthesis_claims_lease
  ON public.candidate_synthesis_claims(status, lease_until);

-- Enable RLS
ALTER TABLE public.candidate_synthesis_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.candidate_synthesis_claims ENABLE ROW LEVEL SECURITY;

-- Allow service role full access
CREATE POLICY "Service role full access on candidate_synthesis_runs"
  ON public.candidate_synthesis_runs FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access on candidate_synthesis_claims"
  ON public.candidate_synthesis_claims FOR ALL TO service_role USING (true) WITH CHECK (true);
