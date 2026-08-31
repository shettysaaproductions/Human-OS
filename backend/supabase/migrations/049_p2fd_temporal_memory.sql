-- ─────────────────────────────────────────────────────────────────────────────
-- HUMAN OS — MIGRATION 049: Phase 2F-D Temporal Memory Lifecycle Hardening
--
-- PURPOSE: Provide explicit columns for temporal memory lifecycle semantics,
-- supporting partial date precision ('year_only', 'month_year', 'exact_date')
-- without false date fabrication, and structured temporal metadata.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.memories
  ADD COLUMN IF NOT EXISTS valid_from TEXT,
  ADD COLUMN IF NOT EXISTS valid_until TEXT,
  ADD COLUMN IF NOT EXISTS temporal_precision TEXT DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS temporal_metadata JSONB DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_memories_valid_from
  ON public.memories(valid_from)
  WHERE valid_from IS NOT NULL;
