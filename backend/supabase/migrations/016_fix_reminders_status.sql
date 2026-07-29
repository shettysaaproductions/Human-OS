-- HUMAN OS -- MIGRATION 016: Fix Reminders Status Bug
-- Non-destructive: adds missing status column causing log spam

ALTER TABLE public.reminders
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';

CREATE INDEX IF NOT EXISTS reminders_status_idx ON public.reminders(status);
