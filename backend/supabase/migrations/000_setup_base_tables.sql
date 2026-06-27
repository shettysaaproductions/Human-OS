-- ─────────────────────────────────────────────────────────────────
-- HUMAN OS: BASE TABLES SETUP (profiles, chat_history)
-- ─────────────────────────────────────────────────────────────────

-- 1. PROFILES TABLE
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY,
  preferred_name text,
  companion_personality text,
  onboarding_completed boolean DEFAULT false,
  onboarding_completed_at timestamptz,
  onboarding_version integer DEFAULT 1,
  timezone text,
  last_active_at timestamptz,
  updated_at timestamptz DEFAULT now()
);

-- 2. CHAT HISTORY TABLE
CREATE TABLE IF NOT EXISTS public.chat_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  conversation_id text,
  role text NOT NULL,
  content text NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_chat_history_user_id ON public.chat_history(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_history_conv_id ON public.chat_history(conversation_id);
