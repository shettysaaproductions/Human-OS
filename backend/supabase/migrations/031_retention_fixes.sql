-- Migration 031: Fix Health RPC and enforce memory idempotency

-- 1. Fix get_cognitive_health_metrics RPC (query memories instead of short_term_memories)
CREATE OR REPLACE FUNCTION public.get_cognitive_health_metrics()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_raw_count int;
    v_compaction_pending int;
    v_memories_active int;
    v_memories_archived int;
    v_jobs_pending int;
    v_jobs_failed int;
    v_retention_lag_days int;
    v_is_maintenance_required boolean;
BEGIN
    SELECT count(*) INTO v_raw_count FROM chat_history WHERE compaction_status = 'raw';
    SELECT count(*) INTO v_compaction_pending FROM chat_history WHERE compaction_status = 'compaction_pending';
    
    SELECT count(*) INTO v_memories_active FROM memories WHERE is_archived = false;
    SELECT count(*) INTO v_memories_archived FROM memories WHERE is_archived = true;
    
    SELECT count(*) INTO v_jobs_pending FROM background_jobs WHERE status = 'pending';
    SELECT count(*) INTO v_jobs_failed FROM failed_jobs;
    
    v_retention_lag_days := 0; 
    v_is_maintenance_required := (v_raw_count > 500) OR (v_jobs_pending > 1000);
    
    RETURN json_build_object(
        'chat_history_raw_count', COALESCE(v_raw_count, 0),
        'chat_history_compaction_pending_count', COALESCE(v_compaction_pending, 0),
        'memories_active_count', COALESCE(v_memories_active, 0),
        'memories_archived_count', COALESCE(v_memories_archived, 0),
        'jobs_pending_count', COALESCE(v_jobs_pending, 0),
        'jobs_failed_count', COALESCE(v_jobs_failed, 0),
        'is_maintenance_required', v_is_maintenance_required,
        'retention_lag_days', v_retention_lag_days
    );
END;
$$;

-- 2. Clean up any existing exact duplicates in short_term_memories based on user_id and source_message_id
DELETE FROM short_term_memories a USING (
  SELECT MIN(ctid) as ctid, user_id, source_message_id
  FROM short_term_memories
  WHERE source_message_id IS NOT NULL
  GROUP BY user_id, source_message_id HAVING COUNT(*) > 1
) b
WHERE a.user_id = b.user_id 
  AND a.source_message_id = b.source_message_id 
  AND a.ctid <> b.ctid;

-- 3. Add idempotency unique constraint to prevent duplicate extraction from same chat history row
ALTER TABLE short_term_memories ADD CONSTRAINT unique_short_term_memory_source UNIQUE (user_id, source_message_id);
