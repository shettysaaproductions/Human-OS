-- Migration: 017_reply_to_feature.sql
-- Add reply capabilities to chat_history table

ALTER TABLE public.chat_history 
ADD COLUMN IF NOT EXISTS reply_to_id uuid REFERENCES public.chat_history(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS reply_to_content text;
