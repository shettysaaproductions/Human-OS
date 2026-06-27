-- ─────────────────────────────────────────────────────────────────
-- ADMIN PANEL AND DYNAMIC CONFIGURATIONS SCHEMA
-- ─────────────────────────────────────────────────────────────────

-- 1. LLM PROVIDERS CONFIGURATION TABLE
CREATE TABLE IF NOT EXISTS public.llm_providers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_name text NOT NULL,             -- e.g. 'openai', 'anthropic', 'google'
  model_name text NOT NULL,                -- e.g. 'gpt-4o', 'claude-3-5-sonnet', 'gemini-1.5-flash'
  api_key_encrypted text,                 -- Encrypted API key stored in DB
  is_active boolean DEFAULT true,
  priority integer DEFAULT 1,             -- Higher priority takes precedence for fallbacks
  monthly_limit numeric DEFAULT 0,        -- Maximum budget for this provider
  created_at timestamptz DEFAULT now()
);

-- Indexing for fast dynamic routing checks
CREATE INDEX IF NOT EXISTS idx_llm_providers_active ON public.llm_providers(is_active);
CREATE INDEX IF NOT EXISTS idx_llm_providers_priority ON public.llm_providers(priority DESC);

-- 2. APPLICATION LIVE SETTINGS TABLE
CREATE TABLE IF NOT EXISTS public.app_settings (
  key text PRIMARY KEY,                   -- Config identifier (e.g. 'personality_style', 'system_mode')
  value text NOT NULL,                    -- Stringified config value or JSON
  updated_at timestamptz DEFAULT now()
);

-- Seed initial basic settings
INSERT INTO public.app_settings (key, value) VALUES 
('default_model_tier', 'gemini-1.5-flash'),
('safety_trigger_action', 'block_response')
ON CONFLICT (key) DO NOTHING;
