-- Migration: 016_chat_history_meta.sql
-- Add a JSONB column to chat_history to store consciousness telemetry and debugging context.

ALTER TABLE public.chat_history 
ADD COLUMN IF NOT EXISTS meta jsonb DEFAULT '{}'::jsonb;
