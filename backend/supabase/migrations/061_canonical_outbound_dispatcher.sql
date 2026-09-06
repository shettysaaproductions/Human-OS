-- Migration 061: Canonical Outbound Dispatcher (Phase 8)

-- 1. Create the `outbound_intents` table for durable intent tracking
CREATE TABLE IF NOT EXISTS public.outbound_intents (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    source_engine text NOT NULL,
    intent_type text NOT NULL,
    logical_key text NOT NULL,
    idempotency_key text NOT NULL,
    context jsonb DEFAULT '{}'::jsonb NOT NULL,
    generation_strategy text NOT NULL,
    proposed_message text,
    status text NOT NULL CHECK (status IN (
      'CREATED', 'GATED', 'DISPATCHING', 'PERSISTED', 
      'NOTIFICATION_ATTEMPTED', 'NOTIFICATION_SKIPPED',
      'DELIVERED', 'DELIVERED_PARTIAL', 
      'SUPPRESSED', 'FAILED_TRANSIENT', 'FAILED_TERMINAL', 'EXPIRED'
    )),
    chat_message_id uuid REFERENCES public.chat_history(id) ON DELETE SET NULL,
    outreach_id uuid REFERENCES public.nova_outreach_log(id) ON DELETE SET NULL,
    failure_reason text,
    created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT check_generation_proposed CHECK (generation_strategy != 'none' OR proposed_message IS NOT NULL)
);

-- 2. Unique constraint for absolute database idempotency
CREATE UNIQUE INDEX IF NOT EXISTS outbound_intents_user_idempotency_key_idx ON public.outbound_intents (user_id, idempotency_key);

-- 3. Indexes for dispatcher queries
CREATE INDEX IF NOT EXISTS outbound_intents_status_idx ON public.outbound_intents (status);
CREATE INDEX IF NOT EXISTS outbound_intents_user_id_idx ON public.outbound_intents (user_id);
CREATE INDEX IF NOT EXISTS outbound_intents_logical_key_idx ON public.outbound_intents (user_id, logical_key);

-- 4. Enable RLS and grant permissions
ALTER TABLE public.outbound_intents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can insert their own outbound intents"
    ON public.outbound_intents FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view their own outbound intents"
    ON public.outbound_intents FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can update their own outbound intents"
    ON public.outbound_intents FOR UPDATE
    USING (auth.uid() = user_id);

CREATE POLICY "Service role has full access to outbound_intents"
    ON public.outbound_intents FOR ALL
    USING (true)
    WITH CHECK (true);

-- Also add an updated_at trigger
CREATE TRIGGER handle_updated_at_outbound_intents
    BEFORE UPDATE ON public.outbound_intents
    FOR EACH ROW
    EXECUTE PROCEDURE moddatetime (updated_at);

-- 5. RPC for atomic persistence of intent + chat message
CREATE OR REPLACE FUNCTION rpc_commit_outbound_intent(
    p_intent_id uuid,
    p_chat_history_payload jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_chat_id uuid;
    v_intent_status text;
    v_user_id uuid;
BEGIN
    -- Ensure the intent exists and lock the row
    SELECT status, user_id INTO v_intent_status, v_user_id
    FROM outbound_intents 
    WHERE id = p_intent_id 
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Intent % not found', p_intent_id;
    END IF;

    -- If already persisted, return the existing chat_message_id (idempotency safety)
    IF v_intent_status IN ('PERSISTED', 'NOTIFICATION_ATTEMPTED', 'NOTIFICATION_SKIPPED', 'DELIVERED', 'DELIVERED_PARTIAL') THEN
        SELECT chat_message_id INTO v_chat_id 
        FROM outbound_intents 
        WHERE id = p_intent_id;
        
        IF v_chat_id IS NOT NULL THEN
            RETURN v_chat_id;
        END IF;
    END IF;

    -- 1. Insert into chat_history
    INSERT INTO chat_history (
        user_id,
        conversation_id,
        role,
        content,
        meta,
        source_type,
        outreach_log_id,
        reply_to_id
    ) VALUES (
        (p_chat_history_payload->>'user_id')::uuid,
        (p_chat_history_payload->>'conversation_id')::uuid,
        p_chat_history_payload->>'role',
        p_chat_history_payload->>'content',
        p_chat_history_payload->'meta',
        p_chat_history_payload->>'source_type',
        (p_chat_history_payload->>'outreach_log_id')::uuid,
        (p_chat_history_payload->>'reply_to_id')::uuid
    ) RETURNING id INTO v_chat_id;

    -- 2. Update outbound_intents atomically
    UPDATE outbound_intents
    SET 
        chat_message_id = v_chat_id,
        status = 'PERSISTED',
        updated_at = now()
    WHERE id = p_intent_id;

    RETURN v_chat_id;
END;
$$;

-- 6. Add to supabase realtime publication
ALTER PUBLICATION supabase_realtime ADD TABLE outbound_intents;
