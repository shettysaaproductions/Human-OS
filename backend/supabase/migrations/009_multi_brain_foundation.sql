-- Multi-Brain Foundation: App Settings Table
-- Stores global configuration for model routing, AI preferences, and system settings.

CREATE TABLE IF NOT EXISTS public.app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Add description column if it doesn't already exist (idempotent)
ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- Seed default model settings
INSERT INTO public.app_settings (key, value, description) VALUES
  ('default_chat_model',      'meta/llama-3.1-8b-instruct',  'Primary model for general chat conversations'),
  ('default_reasoning_model', 'meta/llama-3.1-70b-instruct', 'Model used for complex reasoning tasks'),
  ('default_embedding_model', 'nv-embedqa-e5-v5',            'Embedding model for semantic search'),
  ('fallback_model',          'mock',                         'Model to use when primary models fail')
ON CONFLICT (key) DO NOTHING;

-- Grant service role access
GRANT SELECT, INSERT, UPDATE ON public.app_settings TO service_role;
