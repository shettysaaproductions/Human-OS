-- ─────────────────────────────────────────────────────────────────
-- HUMAN OS v3.2 - MIGRATION 012 (Reminders Table Setup Revised)
-- ─────────────────────────────────────────────────────────────────

DROP TABLE IF EXISTS public.reminders CASCADE;

CREATE TABLE IF NOT EXISTS public.reminders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT,
  scheduled_at TIMESTAMPTZ NOT NULL,
  repeat_pattern TEXT DEFAULT NULL,
  repeat_times TEXT[] DEFAULT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS reminders_user_id_idx ON public.reminders(user_id);
CREATE INDEX IF NOT EXISTS reminders_scheduled_idx ON public.reminders(scheduled_at);

ALTER TABLE public.reminders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own reminders" ON public.reminders
  FOR ALL USING (auth.uid() = user_id);
