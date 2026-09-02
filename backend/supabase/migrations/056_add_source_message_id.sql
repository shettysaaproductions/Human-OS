-- ─────────────────────────────────────────────────────────────────────────────
-- HUMAN OS — MIGRATION 056: Add source_message_id to memories
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.memories ADD COLUMN IF NOT EXISTS source_message_id uuid REFERENCES public.chat_history(id) ON DELETE SET NULL;
ALTER TABLE public.memories ADD COLUMN IF NOT EXISTS is_protected boolean DEFAULT false;
ALTER TABLE public.memories ADD COLUMN IF NOT EXISTS valid_from TEXT;
ALTER TABLE public.memories ADD COLUMN IF NOT EXISTS valid_until TEXT;
ALTER TABLE public.memories ADD COLUMN IF NOT EXISTS temporal_precision TEXT DEFAULT 'unknown';
ALTER TABLE public.memories ADD COLUMN IF NOT EXISTS temporal_metadata JSONB DEFAULT '{}'::jsonb;
