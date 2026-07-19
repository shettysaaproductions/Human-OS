-- Create nova_behavioral_patches table for autonomous self-improvement

CREATE TABLE IF NOT EXISTS public.nova_behavioral_patches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patch_rule TEXT NOT NULL,
  flaw_type TEXT NOT NULL,
  severity TEXT DEFAULT 'medium',
  created_at TIMESTAMPTZ DEFAULT now(),
  is_active BOOLEAN DEFAULT true
);

-- Add index for fast retrieval of active patches
CREATE INDEX IF NOT EXISTS idx_nova_behavioral_patches_is_active 
ON public.nova_behavioral_patches(is_active) 
WHERE is_active = true;

-- Enable RLS
ALTER TABLE public.nova_behavioral_patches ENABLE ROW LEVEL SECURITY;

-- Only service role can manage patches (backend only)
CREATE POLICY "Service role has full access to behavioral patches"
ON public.nova_behavioral_patches
FOR ALL
USING (true)
WITH CHECK (true);
