-- Add status column to reminders table to fix P0 bug
ALTER TABLE public.reminders ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending';
