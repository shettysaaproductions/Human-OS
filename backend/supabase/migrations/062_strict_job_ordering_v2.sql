-- Add a monotonic sequence to background_jobs to guarantee chronological ordering
ALTER TABLE public.background_jobs ADD COLUMN IF NOT EXISTS job_sequence BIGSERIAL;

-- Recreate RPC for inline queue draining by chat.ts
-- Finds the next available pending (or crashed) job FOR A SPECIFIC USER.
-- Orders strictly by job_sequence to guarantee causal processing order.
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
        started_at = now(),
        attempts = attempts + 1
    WHERE id = (
        SELECT candidate_job.id 
        FROM public.background_jobs candidate_job
        WHERE candidate_job.job_type = p_job_type
          AND (candidate_job.payload->>'userId' = p_user_id::text OR candidate_job.payload->>'user_id' = p_user_id::text)
          -- Job must be either pending, OR a crashed running job (>60s old)
          AND (
              candidate_job.status = 'pending' 
              OR (candidate_job.status = 'running' AND candidate_job.started_at <= now() - interval '60 seconds')
          )
          -- Ensure NO OTHER job for this user is currently actively running
          AND NOT EXISTS (
              SELECT 1 
              FROM public.background_jobs active_job
              WHERE (active_job.payload->>'userId' = p_user_id::text OR active_job.payload->>'user_id' = p_user_id::text)
                AND active_job.id != candidate_job.id
                AND active_job.status = 'running'
                AND active_job.started_at > now() - interval '60 seconds'
          )
        ORDER BY candidate_job.job_sequence ASC
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
