-- ─────────────────────────────────────────────────────────────────────────────
-- HUMAN OS — MIGRATION 037: Intelligence Reliability Pass
-- Idempotent schema guards for life_threads and nova_actions, plus index
-- additions that improve CognitiveContextService retrieval performance.
-- ─────────────────────────────────────────────────────────────────────────────

-- GUARD: life_threads — ensure all columns that BackgroundActionService
-- and CognitiveContextService reference actually exist in production.
ALTER TABLE IF EXISTS public.life_threads
  ADD COLUMN IF NOT EXISTS provenance TEXT,
  ADD COLUMN IF NOT EXISTS related_memories JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS related_goals JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS last_relevant_at TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS next_relevant_time TIMESTAMPTZ;

-- GUARD: nova_actions — ensure all columns exist.
ALTER TABLE IF EXISTS public.nova_actions
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS source_message_id UUID,
  ADD COLUMN IF NOT EXISTS dependency_ids JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS provenance TEXT,
  ADD COLUMN IF NOT EXISTS retry_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_error TEXT;

-- INDEX: life_threads by priority (for NACE proactive grounding queries)
CREATE INDEX IF NOT EXISTS life_threads_priority_idx ON public.life_threads(priority);

-- INDEX: nova_actions by source_thread_id (ActionIntelligenceService lookup)
-- Already defined in 036, but guard idempotently.
CREATE INDEX IF NOT EXISTS nova_actions_thread_state_idx
  ON public.nova_actions(source_thread_id, state)
  WHERE source_thread_id IS NOT NULL;

-- INDEX: memories is_archived partial index — improves all active memory reads
CREATE INDEX IF NOT EXISTS memories_active_idx
  ON public.memories(user_id, updated_at DESC)
  WHERE is_archived = false;

-- Reload PostgREST schema cache so new columns are immediately visible.
-- Run this or click "Reload schema cache" in Supabase dashboard after applying.
NOTIFY pgrst, 'reload schema';
