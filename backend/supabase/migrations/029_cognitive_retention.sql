-- Migration: 029_cognitive_retention.sql
-- Implements Phase 6.1 Cognitive Storage and Resource Governance Schema

-- 1. chat_history modifications for bounded compaction pipeline
ALTER TABLE public.chat_history 
ADD COLUMN IF NOT EXISTS compaction_status TEXT DEFAULT 'raw',
ADD COLUMN IF NOT EXISTS compacted_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS compaction_version INTEGER,
ADD COLUMN IF NOT EXISTS episode_id UUID REFERENCES public.episodic_memories(id) ON DELETE SET NULL;

-- Indexes for efficient lifecycle queries (finding raw rows to compact, or deletion_eligible rows to delete)
CREATE INDEX IF NOT EXISTS idx_chat_history_compaction_status ON public.chat_history(compaction_status);
CREATE INDEX IF NOT EXISTS idx_chat_history_created_at ON public.chat_history(created_at);

-- 2. memories modifications for explicit protection semantics
ALTER TABLE public.memories
ADD COLUMN IF NOT EXISTS protection_source TEXT,
ADD COLUMN IF NOT EXISTS protected_at TIMESTAMPTZ;

-- 3. Operational indexes for queue lifecycle cleanup
CREATE INDEX IF NOT EXISTS idx_background_jobs_finished_at ON public.background_jobs(finished_at);
CREATE INDEX IF NOT EXISTS idx_background_jobs_created_at ON public.background_jobs(created_at);
CREATE INDEX IF NOT EXISTS idx_failed_jobs_failed_at ON public.failed_jobs(failed_at);

-- 4. RPC for cognitive health metrics
CREATE OR REPLACE FUNCTION get_cognitive_health_metrics()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_raw_count int;
  v_pending_compaction int;
  v_memories_active int;
  v_memories_archived int;
  v_jobs_pending int;
  v_jobs_failed int;
  v_lag_days int;
BEGIN
  -- Count chat history in various states
  SELECT count(*) INTO v_raw_count FROM chat_history WHERE compaction_status = 'raw';
  SELECT count(*) INTO v_pending_compaction FROM chat_history WHERE compaction_status = 'compaction_pending';
  
  -- Count memories
  SELECT count(*) INTO v_memories_active FROM memories WHERE is_archived = false;
  SELECT count(*) INTO v_memories_archived FROM memories WHERE is_archived = true;
  
  -- Count jobs
  SELECT count(*) INTO v_jobs_pending FROM background_jobs WHERE status = 'pending';
  SELECT count(*) INTO v_jobs_failed FROM background_jobs WHERE status = 'failed';
  
  -- Calculate retention lag (oldest raw message age in days)
  SELECT EXTRACT(DAY FROM NOW() - MIN(created_at)) INTO v_lag_days 
  FROM chat_history 
  WHERE compaction_status = 'raw';
  
  IF v_lag_days IS NULL THEN
    v_lag_days := 0;
  END IF;

  RETURN json_build_object(
    'chat_history_raw_count', v_raw_count,
    'chat_history_compaction_pending_count', v_pending_compaction,
    'memories_active_count', v_memories_active,
    'memories_archived_count', v_memories_archived,
    'jobs_pending_count', v_jobs_pending,
    'jobs_failed_count', v_jobs_failed,
    'is_maintenance_required', (v_raw_count > 500 OR v_jobs_pending > 5000),
    'retention_lag_days', v_lag_days
  );
END;
$$;
