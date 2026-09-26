-- 070_nova_loop_actionability_and_verification.sql
-- Add actionability_status to nova_engineering_incidents and outcome to nova_incident_verifications

-- 1. Add actionability_status column to nova_engineering_incidents
ALTER TABLE public.nova_engineering_incidents
  ADD COLUMN IF NOT EXISTS actionability_status TEXT NOT NULL DEFAULT 'UNVERIFIED';

-- 2. Add check constraint for valid actionability states
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_nova_incidents_actionability_status'
  ) THEN
    ALTER TABLE public.nova_engineering_incidents
      ADD CONSTRAINT chk_nova_incidents_actionability_status
      CHECK (actionability_status IN ('UNVERIFIED', 'VERIFIED', 'REJECTED', 'INCONCLUSIVE', 'BLOCKED'));
  END IF;
END $$;

-- 3. Add index on actionability_status
CREATE INDEX IF NOT EXISTS idx_nova_incidents_actionability_status
  ON public.nova_engineering_incidents(actionability_status);

-- 4. Add outcome column to nova_incident_verifications
ALTER TABLE public.nova_incident_verifications
  ADD COLUMN IF NOT EXISTS outcome TEXT;

CREATE INDEX IF NOT EXISTS idx_nova_verifications_outcome
  ON public.nova_incident_verifications(outcome);

-- 5. Notify PostgREST to reload schema cache
NOTIFY pgrst, 'reload schema';
