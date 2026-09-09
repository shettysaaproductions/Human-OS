-- Migration 064: Add push_token and timezone_offset to profiles, and create user_presence_history

-- 1. Ensure profiles table has push_token, timezone_offset, and country
ALTER TABLE public.profiles 
  ADD COLUMN IF NOT EXISTS push_token text,
  ADD COLUMN IF NOT EXISTS timezone_offset integer DEFAULT 330,
  ADD COLUMN IF NOT EXISTS country text DEFAULT 'IN';

-- 2. Backfill existing profiles with 330 (IST) if timezone is Asia/Calcutta or Asia/Kolkata
UPDATE public.profiles 
SET timezone_offset = 330 
WHERE (timezone = 'Asia/Calcutta' OR timezone = 'Asia/Kolkata' OR timezone IS NULL) 
  AND (timezone_offset IS NULL OR timezone_offset = 0);

-- 3. Create user_presence_history table if not exists
CREATE TABLE IF NOT EXISTS public.user_presence_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('online', 'typing', 'away', 'offline')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast session retrieval and timeline queries
CREATE INDEX IF NOT EXISTS idx_user_presence_history_user_created 
ON public.user_presence_history(user_id, created_at DESC);

-- Enable RLS
ALTER TABLE public.user_presence_history ENABLE ROW LEVEL SECURITY;

-- Policies for user_presence_history
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'user_presence_history' 
    AND policyname = 'user_presence_history_service_all'
  ) THEN
    CREATE POLICY "user_presence_history_service_all" 
    ON public.user_presence_history 
    FOR ALL 
    USING (true) 
    WITH CHECK (true);
  END IF;
END
$$;

-- 4. Widen nova_outreach_log.outreach_type CHECK constraint to support session_start, curiosity, followup, reminder, and nace
ALTER TABLE public.nova_outreach_log
  DROP CONSTRAINT IF EXISTS nova_outreach_log_outreach_type_check;

ALTER TABLE public.nova_outreach_log
  ADD CONSTRAINT nova_outreach_log_outreach_type_check
  CHECK (outreach_type IN (
    'agenda_followup',
    'engagement_checkin',
    'mood_checkin',
    'life_curiosity',
    'proactive',
    'proactive_weather',
    'session_start',
    'curiosity',
    'followup',
    'reminder',
    'nace'
  ));

-- Reload Supabase PostgREST schema cache
NOTIFY pgrst, 'reload schema';
