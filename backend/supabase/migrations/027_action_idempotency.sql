-- Migration to add action_idempotency and claim_next_background_job RPC

CREATE TYPE idempotency_status AS ENUM ('pending', 'completed', 'failed');

CREATE TABLE IF NOT EXISTS public.action_idempotency (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    idempotency_key TEXT NOT NULL,
    action_type TEXT NOT NULL,
    status idempotency_status NOT NULL DEFAULT 'pending',
    result JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ,
    UNIQUE(user_id, idempotency_key)
);

-- Enable RLS
ALTER TABLE public.action_idempotency ENABLE ROW LEVEL SECURITY;

-- Allow read/write for the service role (used by backend)
CREATE POLICY "Service role can manage idempotency"
    ON public.action_idempotency
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);


-- RPC for atomic lock-free queue claiming
-- Finds the next available pending job, atomically updates it to 'running', 
-- and returns the row. The lock is released when the transaction ends (which is when the RPC returns).
CREATE OR REPLACE FUNCTION public.claim_next_background_job(p_job_types text[] DEFAULT NULL)
RETURNS SETOF public.background_jobs
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_claimed_id UUID;
BEGIN
    UPDATE public.background_jobs
    SET 
        status = 'running',
        started_at = now()
    WHERE id = (
        SELECT id 
        FROM public.background_jobs
        WHERE status = 'pending'
          AND (p_job_types IS NULL OR job_type = ANY(p_job_types))
          AND (run_after IS NULL OR run_after <= now())
        ORDER BY created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
    )
    RETURNING id INTO v_claimed_id;

    IF v_claimed_id IS NOT NULL THEN
        RETURN QUERY SELECT * FROM public.background_jobs WHERE id = v_claimed_id;
    END IF;
    
    RETURN;
END;
$$;
