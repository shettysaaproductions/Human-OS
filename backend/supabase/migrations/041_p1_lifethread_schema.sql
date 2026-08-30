-- ─────────────────────────────────────────────────────────────────────────────
-- HUMAN OS — MIGRATION 041: Life Thread Canonical Schema (Phase 1 Part A)
--
-- PURPOSE: Add canonical identity, turn attribution, message sequence,
-- mutation source, and optimistic concurrency versioning columns.
--
-- NOTE: The partial unique index is intentionally NOT created here.
-- Per Phase 1 Amendment 2, existing duplicates must be reconciled via
-- scripts/reconcile_lifethreads.ts before creating the unique constraint.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Add canonical identity and optimistic concurrency columns
ALTER TABLE public.life_threads
  ADD COLUMN IF NOT EXISTS canonical_key TEXT,
  ADD COLUMN IF NOT EXISTS last_turn_id UUID,
  ADD COLUMN IF NOT EXISTS source_message_id UUID,
  ADD COLUMN IF NOT EXISTS source_message_seq BIGINT,
  ADD COLUMN IF NOT EXISTS mutation_source TEXT DEFAULT 'llm_proposal',
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;

-- 2. Index for canonical key lookups
CREATE INDEX IF NOT EXISTS life_threads_canonical_key_idx
  ON public.life_threads(user_id, canonical_key);

-- 3. Index for turn & audit lookups
CREATE INDEX IF NOT EXISTS life_threads_turn_audit_idx
  ON public.life_threads(user_id, last_turn_id);

-- 4. Reload PostgREST schema cache
-- NOTIFY pgrst, 'reload schema';
