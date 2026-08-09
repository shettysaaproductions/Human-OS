-- HUMAN OS -- MIGRATION 024: Reminder purpose, urgency, event triggers, end conditions
-- Non-destructive: only adds columns / relaxes constraints. No data loss.
-- Run this in the Supabase SQL Editor (or via npm run db:migrate if wired up).

-- 1. New columns
ALTER TABLE public.reminders
  ADD COLUMN IF NOT EXISTS purpose         TEXT         DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS urgency         VARCHAR(10)  DEFAULT 'medium',   -- low | medium | high (informational)
  ADD COLUMN IF NOT EXISTS event_trigger   VARCHAR(100) DEFAULT NULL,        -- free-text: 'wake_up', 'left_the_office', ...
  ADD COLUMN IF NOT EXISTS end_condition   VARCHAR(20)  DEFAULT 'until_cancelled';

-- 2. Event-triggered reminders have NO fixed time. Relax the NOT NULL so they can
--    exist with trigger_at = NULL. The time-based poll (lte trigger_at) naturally
--    skips NULL, so they only fire via EventDetector.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'reminders' AND column_name = 'trigger_at' AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE public.reminders ALTER COLUMN trigger_at DROP NOT NULL;
  END IF;
END $$;

-- 3. Partial index for EventDetector lookups (user + event + still-active)
CREATE INDEX IF NOT EXISTS idx_reminders_event_trigger
  ON public.reminders(user_id, event_trigger)
  WHERE event_trigger IS NOT NULL AND status = 'active';

-- 4. CHECK constraints on the enum-ish fields (idempotent via exception handling)
DO $$
BEGIN
  ALTER TABLE public.reminders
    ADD CONSTRAINT reminders_urgency_check
    CHECK (urgency IN ('low', 'medium', 'high'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
BEGIN
  ALTER TABLE public.reminders
    ADD CONSTRAINT reminders_end_condition_check
    CHECK (end_condition IN ('until_cancelled', 'until_date', 'until_count'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
