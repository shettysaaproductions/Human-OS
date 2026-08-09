-- ─────────────────────────────────────────────────────────────────
-- HUMAN OS - MIGRATION 020 (Sync Reminders Schema)
-- ─────────────────────────────────────────────────────────────────
-- NOTE: RENAME COLUMN has no IF EXISTS, so a plain ALTER aborts the whole
-- migration pipeline on a fresh apply (columns already named `text`) or any
-- re-run. All renames below are guarded so the migration is idempotent.

-- 1. Rename columns to match codebase (guarded: only rename when source exists
--    AND target does not already exist).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'reminders' AND column_name = 'title')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'reminders' AND column_name = 'text') THEN
    ALTER TABLE public.reminders RENAME COLUMN title TO text;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'reminders' AND column_name = 'scheduled_at')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'reminders' AND column_name = 'trigger_at') THEN
    ALTER TABLE public.reminders RENAME COLUMN scheduled_at TO trigger_at;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'reminders' AND column_name = 'repeat_pattern')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'reminders' AND column_name = 'recurrence_type') THEN
    ALTER TABLE public.reminders RENAME COLUMN repeat_pattern TO recurrence_type;
  END IF;
END $$;

-- 2. Add missing columns expected by codebase
ALTER TABLE public.reminders ADD COLUMN IF NOT EXISTS recurrence_interval INTEGER DEFAULT NULL;
ALTER TABLE public.reminders ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';

-- 3. Drop unused columns
ALTER TABLE public.reminders DROP COLUMN IF EXISTS body;
ALTER TABLE public.reminders DROP COLUMN IF EXISTS repeat_times;
ALTER TABLE public.reminders DROP COLUMN IF EXISTS is_active;
