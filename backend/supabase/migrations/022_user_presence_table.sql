-- Add presence tracking table
CREATE TABLE IF NOT EXISTS user_presence (
  user_id UUID PRIMARY KEY REFERENCES profiles(id),
  status TEXT CHECK (status IN ('online', 'typing', 'away', 'offline')),
  last_active_at TIMESTAMPTZ,
  last_typing_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE user_presence ENABLE ROW LEVEL SECURITY;

-- Allow users to view and update their own presence
CREATE POLICY "Users can view their own presence" 
ON user_presence FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can update their own presence" 
ON user_presence FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own presence" 
ON user_presence FOR INSERT WITH CHECK (auth.uid() = user_id);
