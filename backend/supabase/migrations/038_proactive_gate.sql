-- ─────────────────────────────────────────────────────────────────────────────
-- HUMAN OS — MIGRATION 038: Proactive Gate Schema
-- Adds logical_key (idempotency) and replied_at (close-the-loop) columns
-- to nova_outreach_log. Also adds supporting indexes.
-- Safe to run multiple times (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS).
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Add logical_key: deterministic idempotency key per outreach reason.
--    E.g. "nace:agenda:AGENDA_ID", "followup:ignored:NOVA_MSG_ID"
ALTER TABLE IF EXISTS public.nova_outreach_log
  ADD COLUMN IF NOT EXISTS logical_key TEXT,
  ADD COLUMN IF NOT EXISTS replied_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- 2. Index for efficient logical_key dedup queries (within time windows).
CREATE INDEX IF NOT EXISTS nova_outreach_log_logical_key_idx
  ON public.nova_outreach_log (user_id, logical_key, created_at DESC)
  WHERE logical_key IS NOT NULL;

-- 3. Index for cooldown queries (most recent outreach per user).
CREATE INDEX IF NOT EXISTS nova_outreach_log_user_created_idx
  ON public.nova_outreach_log (user_id, created_at DESC);

-- 4. Index for unreplied outreach count (escalation tracking).
CREATE INDEX IF NOT EXISTS nova_outreach_log_unreplied_idx
  ON public.nova_outreach_log (user_id, created_at DESC)
  WHERE replied_at IS NULL;

-- Reload PostgREST schema so the new columns are immediately visible.
NOTIFY pgrst, 'reload schema';
