-- RPC for inline queue draining by chat.ts
-- Finds the next available pending job FOR A SPECIFIC USER, atomically updates it to 'running'.
-- Enforces that a pending job is ONLY claimed if NO OTHER job for the SAME user is currently 'running'
-- (with a 60-second crash-recovery timeout).
CREATE OR REPLACE FUNCTION public.claim_next_background_job_for_user(p_user_id UUID, p_job_type text)
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
        SELECT pending_job.id 
        FROM public.background_jobs pending_job
        WHERE pending_job.status = 'pending'
          AND pending_job.job_type = p_job_type
          AND (pending_job.payload->>'userId' = p_user_id::text OR pending_job.payload->>'user_id' = p_user_id::text)
          AND NOT EXISTS (
              SELECT 1 
              FROM public.background_jobs active_job
              WHERE (active_job.payload->>'userId' = p_user_id::text OR active_job.payload->>'user_id' = p_user_id::text)
                AND active_job.id != pending_job.id
                AND active_job.status = 'running'
                AND active_job.started_at > now() - interval '60 seconds'
          )
        ORDER BY pending_job.created_at ASC
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
