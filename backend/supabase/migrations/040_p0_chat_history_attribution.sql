-- ─────────────────────────────────────────────────────────────────
-- Migration 040: P0-C — Chat History Source Attribution
--
-- PURPOSE: Add source_type and outreach_log_id to chat_history so that
-- every assistant row is permanently traceable to the system component
-- that generated it. Both columns are nullable for backward compatibility
-- — all historical rows remain valid with NULL values.
--
-- source_type values:
--   conversational  — normal user-initiated chat reply (chat route)
--   nace_outreach   — NACE 15-min autonomous outreach
--   session_start   — session_start_cognition event
--   session_end     — session_end_proactive_check event
--   followup        — NovaFollowupService scheduled followup
--   reminder        — ReminderEngine notification (future use)
--
-- outreach_log_id: FK to nova_outreach_log.id for autonomous messages.
--   NULL for conversational rows and historical autonomous rows.
-- ─────────────────────────────────────────────────────────────────

-- 1. Add source_type column (nullable, no default — explicit on every new write)
ALTER TABLE chat_history
  ADD COLUMN IF NOT EXISTS source_type TEXT;

-- 2. Add outreach_log_id column (nullable UUID — links autonomous messages to gate log)
ALTER TABLE chat_history
  ADD COLUMN IF NOT EXISTS outreach_log_id UUID;

-- 3. Index for querying autonomous messages efficiently
CREATE INDEX IF NOT EXISTS idx_chat_history_source_type
  ON chat_history(user_id, source_type)
  WHERE source_type IS NOT NULL;

-- 4. Index for outreach traceability joins
CREATE INDEX IF NOT EXISTS idx_chat_history_outreach_log_id
  ON chat_history(outreach_log_id)
  WHERE outreach_log_id IS NOT NULL;

-- 5. Reload PostgREST schema cache (run manually in Supabase SQL editor after migration):
-- NOTIFY pgrst, 'reload schema';
