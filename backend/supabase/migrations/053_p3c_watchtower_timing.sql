-- ─────────────────────────────────────────────────────────────────────────────
-- HUMAN OS — MIGRATION 053: Watchtower Phase 3C-A Timing Schema
--
-- PURPOSE: Provide bounded, structured timing decision logs and outreach
-- eligibility audit records for Nova proactive cognition.
--
-- TABLES:
--   1. watchtower_timing_logs — Governed timing decisions and context snapshots
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.watchtower_timing_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  attention_decision_id UUID REFERENCES public.watchtower_attention_decisions(id) ON DELETE CASCADE,
  timing_state TEXT NOT NULL CHECK (
    timing_state IN ('NOW', 'SOON', 'WAIT', 'QUIET', 'BLOCKED', 'EXPIRED')
  ),
  outreach_eligibility TEXT NOT NULL CHECK (
    outreach_eligibility IN ('PROACTIVE_ELIGIBLE', 'DEFER', 'SUPPRESS', 'EXPIRED')
  ),
  confidence TEXT NOT NULL CHECK (
    confidence IN ('HIGH_CONFIDENCE', 'MEDIUM_CONFIDENCE', 'LOW_CONFIDENCE')
  ),
  source_class TEXT NOT NULL DEFAULT 'AUTONOMOUS_PROACTIVE' CHECK (
    source_class IN ('USER_REQUESTED', 'SYSTEM_REQUIRED', 'AUTONOMOUS_PROACTIVE', 'COGNITIVE_CLARIFICATION')
  ),
  burden_count_24h INTEGER NOT NULL DEFAULT 0,
  reason_code TEXT NOT NULL DEFAULT 'timing_evaluated',
  rejection_reason TEXT,
  defer_until TIMESTAMPTZ,
  context_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  fingerprint TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT uq_watchtower_timing_user_fingerprint UNIQUE(user_id, fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_watchtower_timing_user_created
  ON public.watchtower_timing_logs(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_watchtower_timing_expires_at
  ON public.watchtower_timing_logs(expires_at);

CREATE INDEX IF NOT EXISTS idx_watchtower_timing_eligibility
  ON public.watchtower_timing_logs(user_id, outreach_eligibility);

-- Enable Row Level Security
ALTER TABLE public.watchtower_timing_logs ENABLE ROW LEVEL SECURITY;

-- Allow service role full access
CREATE POLICY "Service role full access on watchtower_timing_logs"
  ON public.watchtower_timing_logs FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMENT ON TABLE public.watchtower_timing_logs IS
  'Watchtower Phase 3C-A: Governed contextual timing decisions and outreach eligibility records.';
