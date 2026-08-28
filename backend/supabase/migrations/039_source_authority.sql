-- ─────────────────────────────────────────────────────────────────
-- Migration 039: Add source_authority column to memories table
--
-- PURPOSE: Encode WHO said a memory fact, separate from is_protected
-- which controls retention/pruning semantics (Phase 6.1 - unchanged).
--
-- source_authority values (ascending authority):
--   subconscious_inference  — LLM extracted without explicit user statement
--   confirmed_memory        — fact confirmed by user interaction pattern
--   deterministic           — extracted by TurnAnalyzer deterministic rules
--   explicit_user           — user stated this directly / explicit correction
--   needs_review            — set by reconciliation script when evidence is ambiguous
--
-- Authority rule (enforced in memoryRepository.ts):
--   A lower-authority write MUST NOT overwrite a higher-authority row
--   UNLESS correction_intent = true (user explicitly correcting a fact).
-- ─────────────────────────────────────────────────────────────────

-- 1. Add the column (nullable so existing rows don't break)
ALTER TABLE memories
  ADD COLUMN IF NOT EXISTS source_authority TEXT DEFAULT 'subconscious_inference';

-- 2. Back-fill: deterministic facts already have protection_source = 'user_explicit'
--    Promote those to 'deterministic' authority (they were extracted by TurnAnalyzer)
UPDATE memories
  SET source_authority = 'deterministic'
  WHERE protection_source = 'user_explicit'
    AND source_authority = 'subconscious_inference';

-- 3. Back-fill: memories where is_user_confirmed = true → confirmed_memory
UPDATE memories
  SET source_authority = 'confirmed_memory'
  WHERE is_user_confirmed = true
    AND source_authority = 'subconscious_inference';

-- 4. Index for authority-aware lookups (used in upsertMemory authority check)
CREATE INDEX IF NOT EXISTS idx_memories_source_authority
  ON memories(user_id, source_authority);

-- 5. Reload PostgREST schema cache (run manually in Supabase SQL editor after this migration):
-- NOTIFY pgrst, 'reload schema';
