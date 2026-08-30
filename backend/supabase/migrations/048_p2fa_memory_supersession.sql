-- ─────────────────────────────────────────────────────────────────────────────
-- HUMAN OS — MIGRATION 048: Phase 2F-A Memory Supersession & Lifecycle State
--
-- PURPOSE: Provide explicit columns for authoritative memory supersession,
-- tracking superseded_by provenance and distinguishing CURRENT, HISTORICAL,
-- SUPERSEDED, INVALIDATED, and PROPOSED lifecycle states.
-- Replace blanket unique index with partial unique index on active CURRENT rows.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.memories
  ADD COLUMN IF NOT EXISTS superseded_by UUID REFERENCES public.memories(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS superseded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS supersession_reason TEXT,
  ADD COLUMN IF NOT EXISTS lifecycle_state TEXT DEFAULT 'CURRENT';

-- Replace blanket unique index with partial unique index so historical/superseded rows can coexist
DROP INDEX IF EXISTS public.idx_memories_user_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_memories_user_current_key
  ON public.memories(user_id, key)
  WHERE is_archived = false AND (lifecycle_state IS NULL OR lifecycle_state = 'CURRENT');

CREATE INDEX IF NOT EXISTS idx_memories_user_key
  ON public.memories(user_id, key);

CREATE INDEX IF NOT EXISTS idx_memories_user_lifecycle
  ON public.memories(user_id, lifecycle_state)
  WHERE is_archived = false;

CREATE INDEX IF NOT EXISTS idx_memories_superseded_by
  ON public.memories(superseded_by)
  WHERE superseded_by IS NOT NULL;
