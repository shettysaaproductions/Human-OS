-- Nova Autonomous Consciousness Engine (NACE) — Database Migration
-- Creates the core tables that power Nova's autonomous outreach and temporal awareness.

-- 1. nova_agenda: Nova's private calendar.
-- Populated during conversations when the user mentions future events.
-- The consciousness engine polls this table to decide when to follow up.
CREATE TABLE IF NOT EXISTS nova_agenda (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  event_description TEXT NOT NULL,
  expected_time TIMESTAMPTZ,
  follow_up_question TEXT,
  follow_up_after TIMESTAMPTZ,
  source_message TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'fired', 'expired', 'cancelled')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_nova_agenda_user_status ON nova_agenda(user_id, status);
CREATE INDEX IF NOT EXISTS idx_nova_agenda_followup ON nova_agenda(follow_up_after) WHERE status = 'pending';

-- 2. nova_outreach_log: Anti-spam ledger.
-- Every autonomous message Nova sends gets logged here.
-- The consciousness engine queries this to enforce rate limits.
CREATE TABLE IF NOT EXISTS nova_outreach_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  outreach_type TEXT NOT NULL CHECK (outreach_type IN ('agenda_followup', 'engagement_checkin', 'mood_checkin', 'life_curiosity')),
  message TEXT NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_outreach_user_time ON nova_outreach_log(user_id, created_at DESC);

-- 3. user_routines: Tracks learned habits (e.g., fasting on Mondays, sleeps at 2am on weekends)
CREATE TABLE IF NOT EXISTS user_routines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  routine_type TEXT NOT NULL, -- e.g., 'sleep', 'diet', 'activity'
  description TEXT NOT NULL,  -- e.g., 'Fasts every Monday', 'Stays out late on Fridays'
  confidence INTEGER DEFAULT 50,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_user_routines_user ON user_routines(user_id);

-- 4. Add recurrence_count column to reminders if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'reminders' AND column_name = 'recurrence_count'
  ) THEN
    ALTER TABLE reminders ADD COLUMN recurrence_count INTEGER DEFAULT 0;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'reminders' AND column_name = 'recurrence_limit'
  ) THEN
    ALTER TABLE reminders ADD COLUMN recurrence_limit INTEGER;
  END IF;
END $$;
