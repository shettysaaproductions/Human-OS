-- Migration 032: Transaction-Safe Retention and Recovery
-- Provides ACID guarantees for physical deletion and memory restoration

-- 1. Atomic Physical Deletion
CREATE OR REPLACE FUNCTION process_physical_deletion_batch(p_batch_size INT)
RETURNS SETOF uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_deleted_ids uuid[];
BEGIN
    -- Verify safety flag (passed in by caller or checked here - we rely on the application to not call this if disabled, 
    -- but we enforce the expiry strictly here).
    
    WITH target_archives AS (
        SELECT id FROM recovery_archive 
        WHERE expected_expiry < NOW()
        FOR UPDATE SKIP LOCKED
        LIMIT p_batch_size
    ),
    deleted_chat AS (
        DELETE FROM chat_history 
        WHERE id IN (SELECT id FROM target_archives) 
          AND compaction_status = 'soft_deleted'
        RETURNING id
    ),
    deleted_archive AS (
        DELETE FROM recovery_archive
        WHERE id IN (SELECT id FROM deleted_chat)
        RETURNING id
    ),
    inserted_audits AS (
        INSERT INTO audit_logs (action, source_message_id, actor, result)
        SELECT 'PHYSICAL_DELETE', id, 'system', 'SUCCESS'
        FROM deleted_chat
        RETURNING source_message_id
    )
    SELECT array_agg(source_message_id) INTO v_deleted_ids FROM inserted_audits;
    
    IF v_deleted_ids IS NOT NULL THEN
        RETURN QUERY SELECT unnest(v_deleted_ids);
    END IF;
    RETURN;
END;
$$;

-- 2. Atomic Restore
CREATE OR REPLACE FUNCTION restore_soft_deleted_memory(p_id UUID)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_payload JSONB;
    v_expiry TIMESTAMPTZ;
BEGIN
    -- Get and lock the archive row
    SELECT original_payload, expected_expiry INTO v_payload, v_expiry
    FROM recovery_archive
    WHERE id = p_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN FALSE; -- Physically deleted or never archived
    END IF;

    IF v_expiry < NOW() THEN
        RETURN FALSE; -- Expired, ineligible for restore
    END IF;

    -- Upsert the original row
    INSERT INTO chat_history (
        id, role, content, created_at, user_id, 
        compaction_status, compacted_at, compaction_version, episode_id
    )
    SELECT 
        (v_payload->>'id')::uuid, 
        v_payload->>'role', 
        v_payload->>'content', 
        (v_payload->>'created_at')::timestamptz,
        (v_payload->>'user_id')::uuid,
        'raw', 
        NULL, 
        NULL, 
        NULL
    ON CONFLICT (id) DO UPDATE SET
        compaction_status = 'raw',
        content = EXCLUDED.content;

    -- Log audit
    INSERT INTO audit_logs (action, source_message_id, actor, result)
    VALUES ('RESTORE', p_id, 'system', 'SUCCESS');

    -- Cleanup
    DELETE FROM recovery_archive WHERE id = p_id;
    DELETE FROM tombstones WHERE id = p_id;

    RETURN TRUE;
END;
$$;
