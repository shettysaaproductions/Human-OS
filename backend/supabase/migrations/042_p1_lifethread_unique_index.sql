-- ─────────────────────────────────────────────────────────────────────────────
-- HUMAN OS — MIGRATION 042: Life Thread Partial Unique Index (Phase 1 Part B)
--
-- PURPOSE: Enforce at most ONE active, waiting, or blocked thread per
-- (user_id, canonical_key). Historical completed/abandoned/superseded
-- threads remain preserved without index collision.
--
-- PREREQUISITE: Run `npx tsx scripts/reconcile_lifethreads.ts --apply`
-- to reconcile any pre-existing duplicate active threads before running this.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE UNIQUE INDEX IF NOT EXISTS life_threads_user_canonical_active_idx
  ON public.life_threads(user_id, canonical_key)
  WHERE state IN ('active', 'waiting', 'blocked');

-- Reload PostgREST schema cache
-- NOTIFY pgrst, 'reload schema';
