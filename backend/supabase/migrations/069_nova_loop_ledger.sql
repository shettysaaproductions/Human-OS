-- ─────────────────────────────────────────────────────────────────────────────
-- HUMAN OS — MIGRATION 069: Nova Loop Engineering Ledger & Checkpoint Schema
--
-- PURPOSE: Provide auditable, offline engineering tracking for conversational
-- flaws, context amnesias, regression prevention, and safe checkpoint advancement.
--
-- TABLES:
--   1. nova_loop_checkpoints       — Monotonic (created_at, message_id) cursor tracking
--   2. nova_engineering_incidents  — Unique-fingerprinted conversational incident ledger
--   3. nova_incident_verifications — Replay test & resolution verification history
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Create nova_loop_checkpoints table
CREATE TABLE IF NOT EXISTS public.nova_loop_checkpoints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stage TEXT NOT NULL UNIQUE, -- e.g. 'conversational_audit', 'memory_consistency'
  last_scanned_created_at TIMESTAMPTZ NOT NULL DEFAULT '1970-01-01T00:00:00Z',
  last_scanned_message_id UUID, -- Tied to chat_history.id for tie-breaking identical timestamps
  total_scanned_count BIGINT NOT NULL DEFAULT 0,
  incidents_found INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed default conversational_audit checkpoint if not exists
INSERT INTO public.nova_loop_checkpoints (stage, last_scanned_created_at, total_scanned_count, incidents_found)
VALUES ('conversational_audit', '1970-01-01T00:00:00Z', 0, 0)
ON CONFLICT (stage) DO NOTHING;

-- 2. Create nova_engineering_incidents table
CREATE TABLE IF NOT EXISTS public.nova_engineering_incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fingerprint TEXT NOT NULL UNIQUE, -- Stable SHA-256 hash of defect pattern
  flaw_type TEXT NOT NULL,          -- e.g. 'CONTEXT_AMNESIA', 'SEMANTIC_CONTRADICTION', 'GOAL_DERAILMENT', etc.
  severity TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'investigating', 'resolved', 'regression', 'blocked', 'dismissed')),
  confidence NUMERIC(4,3) NOT NULL DEFAULT 1.000,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  conversation_id TEXT,
  source_message_id UUID,
  trigger_turn_id TEXT,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb, -- Observable, reproducible dialogue evidence (NO hidden thought traces)
  required_capability TEXT NOT NULL DEFAULT 'DEEP_SEMANTIC_REASONING', -- 'SURFACE_AUDIT' | 'DEEP_SEMANTIC_REASONING' | 'ROOT_CAUSE_DIAGNOSIS'
  detection_count INTEGER NOT NULL DEFAULT 1,
  first_detected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_detected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  resolution_note TEXT,
  blocked_reason TEXT,
  recommended_action TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_nova_incidents_status
  ON public.nova_engineering_incidents(status);

CREATE INDEX IF NOT EXISTS idx_nova_incidents_fingerprint
  ON public.nova_engineering_incidents(fingerprint);

CREATE INDEX IF NOT EXISTS idx_nova_incidents_user_id
  ON public.nova_engineering_incidents(user_id);

CREATE INDEX IF NOT EXISTS idx_nova_incidents_created_at
  ON public.nova_engineering_incidents(created_at DESC);

-- 3. Create nova_incident_verifications table
CREATE TABLE IF NOT EXISTS public.nova_incident_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id UUID NOT NULL REFERENCES public.nova_engineering_incidents(id) ON DELETE CASCADE,
  verification_type TEXT NOT NULL, -- 'REPLAY_TEST' | 'CANONICAL_AUDIT' | 'MANUAL_SIGN_OFF'
  passed BOOLEAN NOT NULL DEFAULT false,
  tested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  tested_commit TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_nova_verifications_incident
  ON public.nova_incident_verifications(incident_id);

CREATE INDEX IF NOT EXISTS idx_nova_verifications_tested_at
  ON public.nova_incident_verifications(tested_at DESC);

-- 4. Enable Row Level Security & Service Role Access Only
ALTER TABLE public.nova_loop_checkpoints ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS nova_loop_checkpoints_service_all ON public.nova_loop_checkpoints;
CREATE POLICY nova_loop_checkpoints_service_all
  ON public.nova_loop_checkpoints FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);
REVOKE ALL ON public.nova_loop_checkpoints FROM anon;
REVOKE ALL ON public.nova_loop_checkpoints FROM authenticated;

ALTER TABLE public.nova_engineering_incidents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS nova_engineering_incidents_service_all ON public.nova_engineering_incidents;
CREATE POLICY nova_engineering_incidents_service_all
  ON public.nova_engineering_incidents FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);
REVOKE ALL ON public.nova_engineering_incidents FROM anon;
REVOKE ALL ON public.nova_engineering_incidents FROM authenticated;

ALTER TABLE public.nova_incident_verifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS nova_incident_verifications_service_all ON public.nova_incident_verifications;
CREATE POLICY nova_incident_verifications_service_all
  ON public.nova_incident_verifications FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);
REVOKE ALL ON public.nova_incident_verifications FROM anon;
REVOKE ALL ON public.nova_incident_verifications FROM authenticated;

NOTIFY pgrst, 'reload schema';
