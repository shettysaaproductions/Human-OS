-- Migration 068: Reminders Accountability and Recurrence Enhancements
-- Adds accountability tracking and multi-step batch grouping to reminders

ALTER TABLE reminders 
  ADD COLUMN IF NOT EXISTS accountability_status text DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS follow_up_count integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_follow_up_at timestamptz,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS batch_group_id uuid;

CREATE INDEX IF NOT EXISTS idx_reminders_accountability_status 
  ON reminders(user_id, accountability_status);

CREATE INDEX IF NOT EXISTS idx_reminders_batch_group 
  ON reminders(batch_group_id);
