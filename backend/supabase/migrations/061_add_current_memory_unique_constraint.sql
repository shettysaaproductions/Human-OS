-- 061_add_current_memory_unique_constraint.sql — Enforce ONE CURRENT memory per user + canonical key
-- Drop any existing index and create the exact single authoritative partial unique index constraint.

DROP INDEX IF EXISTS public.idx_memories_user_current_key;

CREATE UNIQUE INDEX idx_memories_user_current_key
  ON public.memories(user_id, key)
  WHERE is_archived = false AND (lifecycle_state IS NULL OR lifecycle_state = 'CURRENT');