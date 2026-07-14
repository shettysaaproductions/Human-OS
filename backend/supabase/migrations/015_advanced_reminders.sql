-- HUMAN OS -- MIGRATION 015: Advanced Reminders Schema Extension
-- Non-destructive: only adds columns. No data loss.
-- Run this in the Supabase SQL Editor.

ALTER TABLE public.reminders
  ADD COLUMN IF NOT EXISTS active_days    TEXT[]       DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS active_months  TEXT[]       DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS active_year    INTEGER      DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS end_at         TIMESTAMPTZ  DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS is_auto        BOOLEAN      DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS notes          TEXT         DEFAULT NULL;

-- active_days:   e.g. ['monday','saturday','sunday'] -- NULL = every day
-- active_months: e.g. ['july','december']            -- NULL = every month
-- active_year:   e.g. 2027                           -- NULL = every year
-- end_at:        absolute timestamp when recurrence stops
-- is_auto:       true = Nova auto-detected and set this (not user-requested)
-- notes:         internal context for why Nova set this reminder

CREATE INDEX IF NOT EXISTS reminders_active_days_idx
  ON public.reminders USING GIN (active_days);

CREATE INDEX IF NOT EXISTS reminders_active_months_idx
  ON public.reminders USING GIN (active_months);

CREATE INDEX IF NOT EXISTS reminders_end_at_idx
  ON public.reminders (end_at)
  WHERE end_at IS NOT NULL;

GRANT ALL ON public.reminders TO service_role;
