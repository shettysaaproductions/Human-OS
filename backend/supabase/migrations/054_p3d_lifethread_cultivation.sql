-- ─────────────────────────────────────────────────────────────────────────────
-- HUMAN OS — MIGRATION 054: Phase 3D LifeThread Cultivation Foundation
-- ─────────────────────────────────────────────────────────────────────────────
-- Pure additive extensions to public.life_threads.
-- Reuses existing public.life_threads.next_relevant_time.
-- Zero destructive statements (no DROP, no DELETE, no TRUNCATE).
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  -- 1. Cultivation Stage (DISCOVERY, PLANNING, IN_PROGRESS, WAITING_ON_EXTERNAL, STALLED_OR_UNCERTAIN, COMPLETION_PROPOSED, DORMANT)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'life_threads' AND column_name = 'cultivation_stage'
  ) THEN
    ALTER TABLE public.life_threads
      ADD COLUMN cultivation_stage TEXT NOT NULL DEFAULT 'DISCOVERY';
  END IF;

  -- 2. Category (PRODUCTIVITY, WELLBEING, CAREER, CREATIVE, PERSONAL, GENERAL)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'life_threads' AND column_name = 'category'
  ) THEN
    ALTER TABLE public.life_threads
      ADD COLUMN category TEXT NOT NULL DEFAULT 'GENERAL';
  END IF;

  -- 3. Blockers Array (JSONB bounded structured list)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'life_threads' AND column_name = 'blockers'
  ) THEN
    ALTER TABLE public.life_threads
      ADD COLUMN blockers JSONB NOT NULL DEFAULT '[]'::jsonb;
  END IF;

  -- 4. Milestones Array (JSONB bounded structured list)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'life_threads' AND column_name = 'milestones'
  ) THEN
    ALTER TABLE public.life_threads
      ADD COLUMN milestones JSONB NOT NULL DEFAULT '[]'::jsonb;
  END IF;

  -- 5. Next Useful Step Object (JSONB optional micro-step)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'life_threads' AND column_name = 'next_useful_step'
  ) THEN
    ALTER TABLE public.life_threads
      ADD COLUMN next_useful_step JSONB DEFAULT NULL;
  END IF;

  -- 6. Last Cultivated Timestamp (TIMESTAMPTZ for tracking background cultivation pulse)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'life_threads' AND column_name = 'last_cultivated_at'
  ) THEN
    ALTER TABLE public.life_threads
      ADD COLUMN last_cultivated_at TIMESTAMPTZ DEFAULT NOW();
  END IF;
END $$;

-- 7. Add index for fast cultivation queries without table locks
CREATE INDEX IF NOT EXISTS life_threads_cultivation_stage_idx
  ON public.life_threads(user_id, cultivation_stage, state);

CREATE INDEX IF NOT EXISTS life_threads_last_cultivated_idx
  ON public.life_threads(user_id, last_cultivated_at);
