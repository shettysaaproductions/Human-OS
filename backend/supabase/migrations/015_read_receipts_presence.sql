-- Add Read Receipts and Online Presence for NACE

-- 1. Add is_read and read_at to chat_history
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'chat_history' AND column_name = 'is_read'
  ) THEN
    ALTER TABLE chat_history ADD COLUMN is_read BOOLEAN DEFAULT false;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'chat_history' AND column_name = 'read_at'
  ) THEN
    ALTER TABLE chat_history ADD COLUMN read_at TIMESTAMPTZ;
  END IF;
END $$;

-- 2. Add is_online to profiles
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'profiles' AND column_name = 'is_online'
  ) THEN
    ALTER TABLE profiles ADD COLUMN is_online BOOLEAN DEFAULT false;
  END IF;
END $$;

-- Note: profiles already has last_active_at, so we just use that along with is_online.

-- Update existing chat history to be read (to prevent Nova from thinking everything in the past is unread)
UPDATE chat_history SET is_read = true WHERE is_read = false AND role = 'assistant';
