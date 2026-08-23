-- ─────────────────────────────────────────────────────────────────────────────
-- HUMAN OS — MIGRATION 035: Life Threads
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.life_threads (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  topic               TEXT NOT NULL,
  state               TEXT NOT NULL DEFAULT 'active', -- active, waiting, blocked, completed, abandoned
  priority            TEXT NOT NULL DEFAULT 'medium', -- low, medium, high
  provenance          TEXT,
  related_memories    JSONB DEFAULT '[]'::jsonb,
  related_goals       JSONB DEFAULT '[]'::jsonb,
  last_relevant_at    TIMESTAMPTZ DEFAULT NOW(),
  next_relevant_time  TIMESTAMPTZ,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS life_threads_user_idx ON public.life_threads(user_id);
CREATE INDEX IF NOT EXISTS life_threads_state_idx ON public.life_threads(state);
CREATE INDEX IF NOT EXISTS life_threads_last_rel_idx ON public.life_threads(last_relevant_at);

ALTER TABLE public.life_threads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own life threads" ON public.life_threads
  FOR ALL USING (auth.uid() = user_id);
