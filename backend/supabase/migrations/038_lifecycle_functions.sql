-- ─────────────────────────────────────────────────────────────────────────────
-- HUMAN OS — MIGRATION 038: Lifecycle Function Source of Truth
-- Reproduces the current live definitions and execute ACLs for account
-- lifecycle functions. No explicit function-level search_path is configured.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE FUNCTION public.restore_soft_deleted_memory(p_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
    v_payload JSONB;
    v_expiry TIMESTAMPTZ;
    v_user_id UUID;
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

    -- A deleted account must never be resurrected from its recovery archive.
    v_user_id := (v_payload->>'user_id')::uuid;
    IF EXISTS (
        SELECT 1
        FROM account_tombstones
        WHERE user_id = v_user_id
    ) THEN
        RETURN FALSE;
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
$function$;

CREATE FUNCTION public.process_physical_deletion_batch(p_batch_size integer)
RETURNS SETOF uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
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
$function$;

-- SECURITY DEFINER functions must not be callable by PUBLIC, anon, or
-- authenticated. The server-side Human-OS path uses service_role.
REVOKE ALL ON FUNCTION public.restore_soft_deleted_memory(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.process_physical_deletion_batch(integer) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.restore_soft_deleted_memory(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.process_physical_deletion_batch(integer) TO service_role;
