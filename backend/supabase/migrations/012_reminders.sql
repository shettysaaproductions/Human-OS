-- ─────────────────────────────────────────────────────────────────
-- HUMAN OS v3.2 - MIGRATION 012 (Reminders Table Setup Revised)
-- ─────────────────────────────────────────────────────────────────

DROP TABLE IF EXISTS public.reminders CASCADE;

CREATE TABLE IF NOT EXISTS public.reminders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  trigger_at TIMESTAMPTZ NOT NULL,
  recurrence_type TEXT, -- NULL, 'hours', 'days'
  recurrence_interval INTEGER, -- NULL
  status TEXT NOT NULL DEFAULT 'active', -- 'active', 'completed', 'canceled'
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_reminders_user_status ON public.reminders(user_id, status);
CREATE INDEX IF NOT EXISTS idx_reminders_trigger_at ON public.reminders(trigger_at);
