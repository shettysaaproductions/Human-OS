-- HUMAN OS — MIGRATION 038: Lifecycle schema and functions
--
-- Establishes the lifecycle objects that exist in production but were previously
-- missing from the repository migration chain. Safe to replay against an existing
-- database: tables use IF NOT EXISTS and functions use CREATE OR REPLACE.

CREATE TABLE IF NOT EXISTS public.account_tombstones (
    user_id uuid PRIMARY KEY,
    deleted_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.recovery_archive (
    id uuid PRIMARY KEY,
    original_payload jsonb NOT NULL,
    deleted_at timestamptz DEFAULT now(),
    expected_expiry timestamptz DEFAULT (now() + interval '7 days')
);

CREATE INDEX IF NOT EXISTS idx_recovery_archive_expiry
    ON public.recovery_archive USING btree (expected_expiry);

CREATE TABLE IF NOT EXISTS public.tombstones (
    id uuid PRIMARY KEY,
    table_name text NOT NULL,
    reason text NOT NULL,
    deleted_at timestamptz DEFAULT now()
);

ALTER TABLE public.account_tombstones ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.enforce_account_tombstone()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    uid UUID;
BEGIN
    EXECUTE pg_catalog.format('SELECT ($1).%I', TG_ARGV[0]) USING NEW INTO uid;

    IF EXISTS (
        SELECT 1
        FROM public.account_tombstones
        WHERE user_id = uid
    ) THEN
        RAISE EXCEPTION 'ACCOUNT_TOMBSTONE_VIOLATION: Cannot write data for deleted user %', uid;
    END IF;

    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.restore_soft_deleted_memory(p_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_payload JSONB;
    v_expiry TIMESTAMPTZ;
    v_user_id UUID;
BEGIN
    SELECT original_payload, expected_expiry INTO v_payload, v_expiry
    FROM public.recovery_archive
    WHERE id = p_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN FALSE;
    END IF;

    IF v_expiry < NOW() THEN
        RETURN FALSE;
    END IF;

    v_user_id := (v_payload->>'user_id')::uuid;
    IF EXISTS (
        SELECT 1
        FROM public.account_tombstones
        WHERE user_id = v_user_id
    ) THEN
        RETURN FALSE;
    END IF;

    INSERT INTO public.chat_history (
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

    INSERT INTO public.audit_logs (action, source_message_id, actor, result)
    VALUES ('RESTORE', p_id, 'system', 'SUCCESS');

    DELETE FROM public.recovery_archive WHERE id = p_id;
    DELETE FROM public.tombstones WHERE id = p_id;

    RETURN TRUE;
END;
$function$;

CREATE OR REPLACE FUNCTION public.process_physical_deletion_batch(p_batch_size integer)
RETURNS SETOF uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_deleted_ids uuid[];
BEGIN
    WITH target_archives AS (
        SELECT id FROM public.recovery_archive
        WHERE expected_expiry < NOW()
        FOR UPDATE SKIP LOCKED
        LIMIT p_batch_size
    ),
    deleted_chat AS (
        DELETE FROM public.chat_history
        WHERE id IN (SELECT id FROM target_archives)
          AND compaction_status = 'soft_deleted'
        RETURNING id
    ),
    deleted_archive AS (
        DELETE FROM public.recovery_archive
        WHERE id IN (SELECT id FROM deleted_chat)
        RETURNING id
    ),
    inserted_audits AS (
        INSERT INTO public.audit_logs (action, source_message_id, actor, result)
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

DO $do$
DECLARE
    r record;
BEGIN
    FOR r IN
        SELECT * FROM (VALUES
            ('action_idempotency','tr_enforce_tombstone_action_idempotency','user_id'),
            ('candidate_synthesis_claims','tr_enforce_tombstone_candidate_synthesis_claims','user_id'),
            ('chat_history','tr_enforce_tombstone_chat_history','user_id'),
            ('conversation_sessions','tr_enforce_tombstone_conversation_sessions','user_id'),
            ('emotional_states','tr_enforce_tombstone_emotional_states','user_id'),
            ('episodic_memories','tr_enforce_tombstone_episodic_memories','user_id'),
            ('kg_edges','tr_enforce_tombstone_kg_edges','user_id'),
            ('kg_nodes','tr_enforce_tombstone_kg_nodes','user_id'),
            ('life_threads','tr_enforce_tombstone_life_threads','user_id'),
            ('memories','tr_enforce_tombstone_memories','user_id'),
            ('memory_access_log','tr_enforce_tombstone_memory_access_log','user_id'),
            ('memory_events','tr_enforce_tombstone_memory_events','user_id'),
            ('nova_actions','tr_enforce_tombstone_nova_actions','user_id'),
            ('nova_agenda','tr_enforce_tombstone_nova_agenda','user_id'),
            ('nova_cognitive_doubts','tr_enforce_tombstone_nova_cognitive_doubts','user_id'),
            ('nova_corrections_log','tr_enforce_tombstone_nova_corrections_log','user_id'),
            ('nova_followups','tr_enforce_tombstone_nova_followups','user_id'),
            ('nova_guardian_anomalies','tr_enforce_tombstone_nova_guardian_anomalies','user_id'),
            ('nova_guardian_repairs','tr_enforce_tombstone_nova_guardian_repairs','user_id'),
            ('nova_guardian_runs','tr_enforce_tombstone_nova_guardian_runs','user_id'),
            ('nova_outreach_log','tr_enforce_tombstone_nova_outreach_log','user_id'),
            ('profiles','tr_enforce_tombstone_profiles','id'),
            ('reflections','tr_enforce_tombstone_reflections','user_id'),
            ('short_term_memories','tr_enforce_tombstone_short_term_memories','user_id'),
            ('user_feedback','tr_enforce_tombstone_user_feedback','user_id'),
            ('user_moment_preferences','tr_enforce_tombstone_user_moment_preferences','user_id'),
            ('user_moments','tr_enforce_tombstone_user_moments','user_id'),
            ('user_presence','tr_enforce_tombstone_user_presence','user_id'),
            ('user_routines','tr_enforce_tombstone_user_routines','user_id'),
            ('watchtower_attention_decisions','tr_enforce_tombstone_watchtower_attention_decisions','user_id'),
            ('watchtower_cognitive_signals','tr_enforce_tombstone_watchtower_cognitive_signals','user_id'),
            ('watchtower_timing_logs','tr_enforce_tombstone_watchtower_timing_logs','user_id'),
            ('working_memory','tr_enforce_tombstone_working_memory','user_id')
        ) AS x(table_name, trigger_name, user_column)
    LOOP
        IF to_regclass('public.' || r.table_name) IS NOT NULL
           AND NOT EXISTS (
               SELECT 1
               FROM pg_trigger t
               JOIN pg_class c ON c.oid = t.tgrelid
               JOIN pg_namespace n ON n.oid = c.relnamespace
               WHERE n.nspname = 'public'
                 AND c.relname = r.table_name
                 AND t.tgname = r.trigger_name
           )
        THEN
            EXECUTE pg_catalog.format(
                'CREATE TRIGGER %I BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.enforce_account_tombstone(%L)',
                r.trigger_name, r.table_name, r.user_column
            );
        END IF;
    END LOOP;
END;
$do$;

REVOKE ALL ON FUNCTION public.restore_soft_deleted_memory(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.process_physical_deletion_batch(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.restore_soft_deleted_memory(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.process_physical_deletion_batch(integer) TO service_role;
