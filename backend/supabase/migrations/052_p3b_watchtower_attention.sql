-- ─────────────────────────────────────────────────────────────────────────────
-- HUMAN OS — MIGRATION 052: Watchtower Phase 3B Attention & Priority Schema
--
-- PURPOSE: Provide durable, structured attention decisions and priority ranking
-- for Nova's cognitive awareness and proactive gate integration.
--
-- TABLES:
--   1. watchtower_attention_decisions — Attention state, priority scores, and actions
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.watchtower_attention_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (
    target_type IN (
      'guardian_signal',
      'cognitive_doubt',
      'life_thread',
      'reminder',
      'memory_change'
    )
  ),
  target_id TEXT NOT NULL,
  attention_class TEXT NOT NULL CHECK (
    attention_class IN ('IGNORE', 'WATCH', 'ATTENTION', 'ACTIONABLE', 'URGENT')
  ),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (
    status IN ('PENDING', 'WATCHING', 'READY', 'DEFERRED', 'ACTED', 'DISMISSED', 'EXPIRED')
  ),
  importance INTEGER NOT NULL DEFAULT 0,
  urgency INTEGER NOT NULL DEFAULT 0,
  goal_relevance INTEGER NOT NULL DEFAULT 0,
  deadline_proximity INTEGER NOT NULL DEFAULT 0,
  novelty INTEGER NOT NULL DEFAULT 0,
  confidence INTEGER NOT NULL DEFAULT 0,
  recency INTEGER NOT NULL DEFAULT 0,
  already_handled_penalty INTEGER NOT NULL DEFAULT 0,
  interruption_cost INTEGER NOT NULL DEFAULT 0,
  composite_score INTEGER NOT NULL DEFAULT 0,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  reason TEXT NOT NULL,
  recommended_action TEXT,
  defer_until TIMESTAMPTZ,
  fingerprint TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT uq_watchtower_attention_user_fingerprint UNIQUE(user_id, fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_watchtower_attention_user_status
  ON public.watchtower_attention_decisions(user_id, status);

CREATE INDEX IF NOT EXISTS idx_watchtower_attention_class
  ON public.watchtower_attention_decisions(user_id, attention_class)
  WHERE status IN ('READY', 'WATCHING', 'DEFERRED');

CREATE INDEX IF NOT EXISTS idx_watchtower_attention_expires_at
  ON public.watchtower_attention_decisions(expires_at)
  WHERE status IN ('READY', 'WATCHING', 'DEFERRED');

-- Enable RLS
ALTER TABLE public.watchtower_attention_decisions ENABLE ROW LEVEL SECURITY;

-- Allow service role full access
CREATE POLICY "Service role full access on watchtower_attention_decisions"
  ON public.watchtower_attention_decisions FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMENT ON TABLE public.watchtower_attention_decisions IS
  'Watchtower Phase 3B: Structured, bounded attention decisions and priority ranking for Nova attention.';
