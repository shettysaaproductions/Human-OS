-- Migration 030: Critical Retention and Memory Safety Remediation

-- 1. Create Recovery Archive for soft-deleted chat history
CREATE TABLE IF NOT EXISTS public.recovery_archive (
    id UUID PRIMARY KEY,
    original_payload JSONB NOT NULL,
    deleted_at TIMESTAMPTZ DEFAULT NOW(),
    expected_expiry TIMESTAMPTZ DEFAULT NOW() + INTERVAL '7 days'
);

-- 2. Create Tombstones for metadata-only retention
CREATE TABLE IF NOT EXISTS public.tombstones (
    id UUID PRIMARY KEY,
    table_name TEXT NOT NULL,
    reason TEXT NOT NULL,
    deleted_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Create Audit Logs
CREATE TABLE IF NOT EXISTS public.audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    action TEXT NOT NULL,
    source_message_id UUID,
    batch_id UUID,
    timestamp TIMESTAMPTZ DEFAULT NOW(),
    retention_policy_version TEXT,
    actor TEXT NOT NULL,
    result TEXT NOT NULL
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_recovery_archive_expiry ON public.recovery_archive(expected_expiry);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON public.audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_message_id ON public.audit_logs(source_message_id);

-- Ensure get_cognitive_health_metrics uses COALESCE correctly
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
    
    SELECT count(*) INTO v_memories_active FROM short_term_memories WHERE is_archived = false;
    SELECT count(*) INTO v_memories_archived FROM short_term_memories WHERE is_archived = true;
    
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
