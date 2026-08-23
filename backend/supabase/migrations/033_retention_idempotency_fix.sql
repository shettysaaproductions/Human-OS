-- Migration 033: Fix idempotency constraint (Semantic Safety)
ALTER TABLE short_term_memories DROP CONSTRAINT IF EXISTS unique_short_term_memory_source;
ALTER TABLE short_term_memories ADD CONSTRAINT unique_short_term_memory_source UNIQUE (user_id, source_message_id, category);
