-- HUMAN OS -- MIGRATION 025: UNIQUE(user_id, key) on working_memory
-- Fixes: upsert(...).onConflict('user_id,key') in NovaFollowupService / BackgroundActionService
-- throws "no unique or exclusion constraint matching the ON CONFLICT specification" because
-- working_memory had no unique constraint. Every suppression write was silently failing.
-- Non-destructive: dedups existing rows (keeps newest per user+key), then adds the index.
-- Run this in the Supabase SQL Editor (or npm run db:migrate if wired up).

-- 1. Dedupe existing rows: keep only the newest created_at per (user_id, key).
--    (The same key can't meaningfully hold two values; drops stale older rows.)
DELETE FROM public.working_memory a
  USING public.working_memory b
  WHERE a.user_id = b.user_id
    AND a.key = b.key
    AND a.created_at < b.created_at;

-- 2. Now safe to enforce uniqueness.
CREATE UNIQUE INDEX IF NOT EXISTS idx_working_memory_user_key
  ON public.working_memory(user_id, key);
