-- Migration 034: Add logical_key for multiple distinct facts per source message
ALTER TABLE short_term_memories ADD COLUMN IF NOT EXISTS logical_key TEXT DEFAULT 'archive';

-- Update the uniqueness constraint to use logical_key
ALTER TABLE short_term_memories DROP CONSTRAINT IF EXISTS unique_short_term_memory_source;
ALTER TABLE short_term_memories ADD CONSTRAINT unique_short_term_memory_source UNIQUE (user_id, source_message_id, logical_key);
