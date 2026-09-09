-- Migration 065: Create nova_thoughts table for subconscious process logs
-- Resolves PGRST205 errors when mobile app loads thoughts for chat messages

CREATE TABLE IF NOT EXISTS public.nova_thoughts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  chat_message_id UUID REFERENCES public.chat_history(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  thoughts JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes for efficient lookup by chat message and timeline queries
CREATE INDEX IF NOT EXISTS idx_nova_thoughts_msg 
  ON public.nova_thoughts(chat_message_id);

CREATE INDEX IF NOT EXISTS idx_nova_thoughts_user_time 
  ON public.nova_thoughts(user_id, created_at DESC);

-- Enable Row Level Security
ALTER TABLE public.nova_thoughts ENABLE ROW LEVEL SECURITY;

-- Service role & user policies
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'nova_thoughts' 
    AND policyname = 'nova_thoughts_service_all'
  ) THEN
    CREATE POLICY "nova_thoughts_service_all" 
      ON public.nova_thoughts 
      FOR ALL 
      USING (true) 
      WITH CHECK (true);
  END IF;
END
$$;

-- Reload Supabase PostgREST schema cache
NOTIFY pgrst, 'reload schema';
