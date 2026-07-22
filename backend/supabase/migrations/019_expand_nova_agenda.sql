-- Migration to expand nova_agenda for Persistent Task Engine

-- 1. Add new columns for persistence and retry logic
ALTER TABLE public.nova_agenda
ADD COLUMN IF NOT EXISTS retry_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS max_retries INTEGER DEFAULT 5,
ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS is_recurring BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS recurrence_pattern TEXT,
ADD COLUMN IF NOT EXISTS urgency TEXT DEFAULT 'medium';

-- 2. Update existing rows so next_retry_at matches follow_up_after
UPDATE public.nova_agenda
SET next_retry_at = follow_up_after
WHERE next_retry_at IS NULL;

-- 3. Drop existing constraint and add a new one supporting the new statuses
ALTER TABLE public.nova_agenda DROP CONSTRAINT IF EXISTS nova_agenda_status_check;
ALTER TABLE public.nova_agenda ADD CONSTRAINT nova_agenda_status_check CHECK (status IN ('active', 'completed', 'cancelled', 'snoozed', 'pending', 'fired', 'expired'));

-- 4. Migrate 'pending' to 'active' for consistency with our new system
UPDATE public.nova_agenda
SET status = 'active'
WHERE status = 'pending';
