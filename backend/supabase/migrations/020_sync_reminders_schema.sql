-- ─────────────────────────────────────────────────────────────────
-- HUMAN OS - MIGRATION 020 (Sync Reminders Schema)
-- ─────────────────────────────────────────────────────────────────

-- 1. Rename columns to match codebase
ALTER TABLE public.reminders RENAME COLUMN title TO text;
ALTER TABLE public.reminders RENAME COLUMN scheduled_at TO trigger_at;
ALTER TABLE public.reminders RENAME COLUMN repeat_pattern TO recurrence_type;

-- 2. Add missing columns expected by codebase
ALTER TABLE public.reminders ADD COLUMN IF NOT EXISTS recurrence_interval INTEGER DEFAULT NULL;
ALTER TABLE public.reminders ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';

-- 3. Drop unused columns
ALTER TABLE public.reminders DROP COLUMN IF EXISTS body;
ALTER TABLE public.reminders DROP COLUMN IF EXISTS repeat_times;
ALTER TABLE public.reminders DROP COLUMN IF EXISTS is_active;
