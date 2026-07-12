-- ─────────────────────────────────────────────────────────────────────────────
-- HUMAN OS — MIGRATION 013: Fix Reminders Table + Nova Followup Scheduler
-- ─────────────────────────────────────────────────────────────────────────────
-- Drops the old mismatched reminders table and rebuilds with columns that
-- match what ReminderSchedulerService.ts actually uses. Also adds the
-- nova_followups table for human-like follow-up scheduling.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Step 1: Rebuild reminders with correct schema ─────────────────────────────
DROP TABLE IF EXISTS public.reminders CASCADE;

CREATE TABLE IF NOT EXISTS public.reminders (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  text                TEXT NOT NULL,
  trigger_at          TIMESTAMPTZ NOT NULL,
  recurrence_type     TEXT DEFAULT NULL,     -- 'hours' | 'days' | null
  recurrence_interval INTEGER DEFAULT NULL,
  status              TEXT NOT NULL DEFAULT 'active',  -- 'active' | 'completed' | 'cancelled'
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS reminders_user_id_idx  ON public.reminders(user_id);
CREATE INDEX IF NOT EXISTS reminders_trigger_idx  ON public.reminders(trigger_at);
CREATE INDEX IF NOT EXISTS reminders_status_idx   ON public.reminders(status);

ALTER TABLE public.reminders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own reminders" ON public.reminders
  FOR ALL USING (auth.uid() = user_id);

-- ── Step 2: Nova follow-up scheduler ─────────────────────────────────────────
-- After every conversation turn, the backend writes a scheduled follow-up here.
-- The reminders scheduler polls this every 10s and fires push notifications.
CREATE TABLE IF NOT EXISTS public.nova_followups (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  conversation_id  UUID NOT NULL,
  message          TEXT NOT NULL,           -- the follow-up Nova will send
  fire_at          TIMESTAMPTZ NOT NULL,    -- when to send it
  status           TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'sent' | 'cancelled'
  context_summary  TEXT,                   -- what was being discussed
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS nova_followups_user_idx    ON public.nova_followups(user_id);
CREATE INDEX IF NOT EXISTS nova_followups_fire_at_idx ON public.nova_followups(fire_at);
CREATE INDEX IF NOT EXISTS nova_followups_status_idx  ON public.nova_followups(status);

ALTER TABLE public.nova_followups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own followups" ON public.nova_followups
  FOR SELECT USING (auth.uid() = user_id);
