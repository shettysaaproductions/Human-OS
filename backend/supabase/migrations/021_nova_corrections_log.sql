-- Nova Real-Time Corrections Log
-- Tracks every time a user corrects Nova's behavior through reply-to-message corrections
-- Used for founder review and as audit trail for auto-generated patches

CREATE TABLE IF NOT EXISTS nova_corrections_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  original_nova_message TEXT NOT NULL,
  user_correction TEXT NOT NULL,
  detected_flaw_type TEXT,
  generated_patch TEXT,
  patch_applied BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Index for querying corrections by user
CREATE INDEX IF NOT EXISTS idx_corrections_user_id ON nova_corrections_log(user_id);
CREATE INDEX IF NOT EXISTS idx_corrections_created_at ON nova_corrections_log(created_at DESC);

-- Nova Auto-Upgrade Scan Checkpoints
-- Tracks the last message scanned so subsequent upgrades only analyze NEW messages
CREATE TABLE IF NOT EXISTS nova_scan_checkpoints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_type TEXT NOT NULL DEFAULT 'auto_upgrade',
  last_scanned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  messages_scanned INTEGER DEFAULT 0,
  flaws_found INTEGER DEFAULT 0,
  patches_applied INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);
