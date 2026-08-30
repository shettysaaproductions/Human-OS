-- Phase 2E-A: Memory Lifecycle Schema Foundation

-- 1. Source References (Provenance)
-- Allows a compressed memory to retain citations to its constituent evidence
ALTER TABLE public.memories
ADD COLUMN IF NOT EXISTS source_references JSONB;

-- 2. Lifecycle Status Metadata
-- Minimal fields to prevent duplicate processing during the nightly Phase 2E consolidation job.

ALTER TABLE public.working_memory
ADD COLUMN IF NOT EXISTS promotion_status TEXT,
ADD COLUMN IF NOT EXISTS compression_status TEXT;

ALTER TABLE public.episodic_memories
ADD COLUMN IF NOT EXISTS promotion_status TEXT,
ADD COLUMN IF NOT EXISTS compression_status TEXT,
ADD COLUMN IF NOT EXISTS is_archived BOOLEAN DEFAULT false;

-- Semantic memories can also be compressed further in the future
ALTER TABLE public.memories
ADD COLUMN IF NOT EXISTS compression_status TEXT;
