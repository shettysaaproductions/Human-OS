-- Add source_log column to nova_behavioral_patches for audit trail
-- Allows tracing which user correction or auto-scan generated a patch
ALTER TABLE public.nova_behavioral_patches 
ADD COLUMN IF NOT EXISTS source_log TEXT;
