-- 060_add_memory_enabled.sql — Add per-user MEMORY_ENABLED privacy control
-- Default true for backward compatibility (existing users remain enabled)
-- This is a privacy control, not destructive delete

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'memory_enabled'
  ) THEN
    ALTER TABLE public.profiles ADD COLUMN memory_enabled BOOLEAN NOT NULL DEFAULT true;
  END IF;
END $$;

-- Backfill existing NULLs (if any) to true and ensure default
UPDATE public.profiles SET memory_enabled = true WHERE memory_enabled IS NULL;

-- Index not needed (single row per user, queried by PK)

COMMENT ON COLUMN public.profiles.memory_enabled IS 'Privacy control: when false, no new persistent semantic memory may be created, no correction persisted, no queued write persists, no memory injection into context. Existing memories remain stored.';
