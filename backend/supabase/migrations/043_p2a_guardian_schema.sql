-- ─────────────────────────────────────────────────────────────────────────────
-- HUMAN OS — MIGRATION 043: Watchtower Phase 2A Deterministic Guardian Schema
--
-- PURPOSE: Provide lightweight, bounded, user-scoped tables for recording
-- deterministic Guardian heartbeat runs and anomaly detections.
--
-- TABLES:
--   1. nova_guardian_runs       — Lightweight run records (bounded metadata)
--   2. nova_guardian_anomalies  — Unique-fingerprinted anomaly records
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Create nova_guardian_runs table
CREATE TABLE IF NOT EXISTS public.nova_guardian_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  turn_id TEXT,
  source_message_id TEXT,
  trigger_type TEXT NOT NULL, -- 'post_turn' | 'life_thread_mutation' | 'memory_mutation' | 'autonomous_outreach' | 'manual_scan'
  execution_level INTEGER NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  duration_ms INTEGER,
  anomalies_detected INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_guardian_runs_created_at
  ON public.nova_guardian_runs(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_guardian_runs_user_created
  ON public.nova_guardian_runs(user_id, created_at DESC)
  WHERE user_id IS NOT NULL;

-- 2. Create nova_guardian_anomalies table
CREATE TABLE IF NOT EXISTS public.nova_guardian_anomalies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID REFERENCES public.nova_guardian_runs(id) ON DELETE SET NULL,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  anomaly_code TEXT NOT NULL, -- e.g. 'W-001' .. 'W-022'
  severity TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  status TEXT NOT NULL DEFAULT 'detected' CHECK (status IN ('detected', 'resolved', 'dismissed', 'human_review')),
  fingerprint TEXT NOT NULL,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  repair_attempts INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  last_detected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  detection_count INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT uq_user_anomaly_fingerprint UNIQUE (user_id, fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_guardian_anomalies_user_status
  ON public.nova_guardian_anomalies(user_id, status);

CREATE INDEX IF NOT EXISTS idx_guardian_anomalies_code
  ON public.nova_guardian_anomalies(anomaly_code);

CREATE INDEX IF NOT EXISTS idx_guardian_anomalies_created_at
  ON public.nova_guardian_anomalies(created_at DESC);

-- 3. Reload PostgREST schema cache
-- NOTIFY pgrst, 'reload schema';
