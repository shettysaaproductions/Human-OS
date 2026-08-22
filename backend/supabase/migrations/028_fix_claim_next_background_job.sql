-- RPC for atomic lock-free queue claiming
-- Finds the next available pending job, atomically updates it to 'running', 
-- and returns the row. Fixes starvation by removing non-existent run_after.
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
