-- ─────────────────────────────────────────────────────────────────
-- MOMENT ENGINE MVP DATABASE SCHEMA
-- ─────────────────────────────────────────────────────────────────

-- 1. Create user_moment_preferences table
CREATE TABLE IF NOT EXISTS public.user_moment_preferences (
  user_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  goal_followups_enabled BOOLEAN DEFAULT true,
  child_milestones_enabled BOOLEAN DEFAULT true,
  quiet_hours TEXT DEFAULT '22:00-08:00',
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Create user_moments table for delivery logs & telemetry tracking
CREATE TABLE IF NOT EXISTS public.user_moments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  moment_type TEXT NOT NULL, -- 'GOAL_FOLLOW_UP', 'CHILD_MILESTONE'
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  source_memory_id UUID,
  status TEXT DEFAULT 'generated', -- 'generated', 'opened', 'dismissed'
  created_at TIMESTAMPTZ DEFAULT now(),
  opened_at TIMESTAMPTZ,
  dismissed_at TIMESTAMPTZ
);

-- Indexes for fast isolation and sorting
CREATE INDEX IF NOT EXISTS idx_user_moments_user_id ON public.user_moments(user_id);
CREATE INDEX IF NOT EXISTS idx_user_moments_created_at ON public.user_moments(created_at);
