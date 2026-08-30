-- ─────────────────────────────────────────────────────────────────────────────
-- HUMAN OS — MIGRATION 045: Phase 2C Safe Deterministic Repair Schema
--
-- PURPOSE: Provide auditable, idempotent storage for Guardian repair orders
-- and extend anomaly statuses for deterministic repair workflows.
--
-- TABLES:
--   1. nova_guardian_repairs — Immutable repair orders with before/after state & verification
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Create nova_guardian_repairs table
CREATE TABLE IF NOT EXISTS public.nova_guardian_repairs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  anomaly_id UUID REFERENCES public.nova_guardian_anomalies(id) ON DELETE SET NULL,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  repair_type TEXT NOT NULL CHECK (
    repair_type IN (
      'MEMORY_ALIAS_CANONICALIZATION',
      'GENERIC_RELATIONAL_NOISE',
      'DUPLICATE_REMINDER',
      'ORPHANED_LIFE_THREAD_ACTION',
      'EXPIRED_REMINDER_STATE'
    )
  ),
  target_entity_id TEXT NOT NULL,
  expected_current_state JSONB NOT NULL DEFAULT '{}'::jsonb,
  proposed_state JSONB NOT NULL DEFAULT '{}'::jsonb,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  authority TEXT NOT NULL DEFAULT 'watchtower_repair',
  source_turn_id TEXT,
  source_message_id TEXT,
  source_message_seq INTEGER,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (
    status IN (
      'pending',
      'executing',
      'resolved',
      'no_op_resolved',
      'rejected_stale',
      'failed',
      'human_review'
    )
  ),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  fingerprint TEXT NOT NULL,
  before_state JSONB,
  after_state JSONB,
  verification_result JSONB,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  executed_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  CONSTRAINT uq_repair_user_fingerprint UNIQUE (user_id, fingerprint)
);

-- 2. Indexes for efficient lookup & isolation
CREATE INDEX IF NOT EXISTS idx_guardian_repairs_user_status
  ON public.nova_guardian_repairs(user_id, status);

CREATE INDEX IF NOT EXISTS idx_guardian_repairs_anomaly
  ON public.nova_guardian_repairs(anomaly_id)
  WHERE anomaly_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_guardian_repairs_created_at
  ON public.nova_guardian_repairs(created_at DESC);

-- 3. Extend anomaly status check in public.nova_guardian_anomalies if table exists
DO $$
BEGIN
  ALTER TABLE public.nova_guardian_anomalies
    DROP CONSTRAINT IF EXISTS nova_guardian_anomalies_status_check;
    
  ALTER TABLE public.nova_guardian_anomalies
    ADD CONSTRAINT nova_guardian_anomalies_status_check CHECK (
      status IN (
        'detected',
        'repair_eligible',
        'repair_dispatched',
        'resolved',
        'no_op_resolved',
        'rejected_stale',
        'failed',
        'human_review',
        'dismissed'
      )
    );
EXCEPTION
  WHEN undefined_table THEN
    NULL;
END $$;
