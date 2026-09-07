-- Add claim_token for distributed worker ownership
ALTER TABLE public.background_jobs ADD COLUMN IF NOT EXISTS claim_token UUID;

-- Recreate RPC for strictly ordered user job claiming
CREATE OR REPLACE FUNCTION public.claim_next_background_job_for_user(p_user_id UUID, p_job_type text)
RETURNS SETOF public.background_jobs
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_claimed_id UUID;
    v_claim_token UUID;
BEGIN
    v_claim_token := gen_random_uuid();

    UPDATE public.background_jobs
    SET 
        status = 'running',
        started_at = clock_timestamp(),
        attempts = attempts + 1,
        claim_token = v_claim_token
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

-- Create RPC to securely complete a job and attach output
CREATE OR REPLACE FUNCTION public.mark_background_job_completed(p_job_id UUID, p_claim_token UUID, p_output JSONB)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    -- Update ONLY IF the job is currently running and the claim_token matches.
    -- This guarantees a stale worker cannot overwrite the DB state if it was reclaimed.
    UPDATE public.background_jobs
    SET 
        status = 'completed',
        finished_at = clock_timestamp(),
        payload = jsonb_set(COALESCE(payload, '{}'::jsonb), '{output}', p_output, true)
    WHERE id = p_job_id 
      AND status = 'running'
      AND claim_token = p_claim_token;

    -- If no rows were updated, either the job wasn't running or the claim_token didn't match.
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Failed to complete job. Lease expired or invalid claim token.';
    END IF;
END;
$$;
