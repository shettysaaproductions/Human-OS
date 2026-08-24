-- ─────────────────────────────────────────────────────────────────────────────
-- HUMAN OS — MIGRATION 036: Nova Actions
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.nova_actions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  logical_key         TEXT NOT NULL, -- user_id + normalized intent + source/identity hash for idempotency
  title               TEXT NOT NULL,
  description         TEXT,
  state               TEXT NOT NULL DEFAULT 'suggested', -- suggested, pending_confirmation, scheduled, in_progress, completed, cancelled, blocked
  priority            TEXT NOT NULL DEFAULT 'medium', -- low, medium, high
  execution_class     TEXT NOT NULL DEFAULT 'SAFE_AUTOMATIC', -- SAFE_AUTOMATIC, USER_VISIBLE_REVERSIBLE, CONFIRMATION_REQUIRED
  source_thread_id    UUID REFERENCES public.life_threads(id) ON DELETE CASCADE,
  source_message_id   UUID,
  due_at              TIMESTAMPTZ,
  dependency_ids      JSONB DEFAULT '[]'::jsonb, -- array of nova_actions.id
  provenance          TEXT,
  retry_count         INTEGER DEFAULT 0,
  last_error          TEXT,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, logical_key)
);

CREATE INDEX IF NOT EXISTS nova_actions_user_idx ON public.nova_actions(user_id);
CREATE INDEX IF NOT EXISTS nova_actions_state_idx ON public.nova_actions(state);
CREATE INDEX IF NOT EXISTS nova_actions_due_at_idx ON public.nova_actions(due_at);
CREATE INDEX IF NOT EXISTS nova_actions_thread_idx ON public.nova_actions(source_thread_id);

ALTER TABLE public.nova_actions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own nova actions" ON public.nova_actions
  FOR ALL USING (auth.uid() = user_id);
