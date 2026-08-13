const { Client } = require('pg');
require('dotenv').config({ path: require('path').join(__dirname, '../../backend/.env') });

async function run() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL
  });
  await client.connect();
  const sql = `
    CREATE TABLE IF NOT EXISTS user_presence_history (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
      status TEXT CHECK (status IN ('online', 'typing', 'away', 'offline')),
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_user_presence_history_user_id_created_at 
    ON user_presence_history(user_id, created_at DESC);

    ALTER TABLE user_presence_history ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS "Users can view their own presence history" ON user_presence_history;
    CREATE POLICY "Users can view their own presence history" 
    ON user_presence_history FOR SELECT USING (auth.uid() = user_id);

    DROP POLICY IF EXISTS "Users can insert their own presence history" ON user_presence_history;
    CREATE POLICY "Users can insert their own presence history" 
    ON user_presence_history FOR INSERT WITH CHECK (auth.uid() = user_id);
  `;
  try {
    await client.query(sql);
    console.log("Migration successful");
  } catch(e) {
    console.error(e);
  } finally {
    await client.end();
  }
}
run();
