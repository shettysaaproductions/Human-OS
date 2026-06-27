-- Beta Polish Sprint: user_feedback and telemetry_events tables

-- User Feedback table
CREATE TABLE IF NOT EXISTS public.user_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  feedback_type TEXT NOT NULL CHECK (feedback_type IN ('bug', 'idea', 'emotional_reaction', 'general')),
  message TEXT NOT NULL,
  rating INTEGER CHECK (rating >= 1 AND rating <= 5),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_feedback_user_id ON public.user_feedback(user_id);
CREATE INDEX IF NOT EXISTS idx_user_feedback_type ON public.user_feedback(feedback_type);

-- Telemetry events table (for crash and error tracking)
CREATE TABLE IF NOT EXISTS public.telemetry_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,  -- 'crash', 'api_failure', 'memory_error', 'reflection_failure', 'moment_failure', 'app_open'
  event_data JSONB DEFAULT '{}',
  platform TEXT,             -- 'ios', 'android'
  app_version TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_telemetry_events_user_id ON public.telemetry_events(user_id);
CREATE INDEX IF NOT EXISTS idx_telemetry_events_type ON public.telemetry_events(event_type);
CREATE INDEX IF NOT EXISTS idx_telemetry_events_created ON public.telemetry_events(created_at);

-- Grant service role access
GRANT SELECT, INSERT ON public.user_feedback TO service_role;
GRANT SELECT, INSERT ON public.telemetry_events TO service_role;
