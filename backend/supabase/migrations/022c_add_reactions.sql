-- Migration: 20260720021600_add_reactions.sql
-- Add user_reaction column to chat_history

ALTER TABLE public.chat_history 
ADD COLUMN IF NOT EXISTS user_reaction text;
