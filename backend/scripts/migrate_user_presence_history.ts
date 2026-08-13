import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { logger } from '../src/lib/logger';

dotenv.config({ path: path.join(__dirname, '../.env') });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  logger.error('Missing Supabase credentials in .env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function run() {
  logger.info('Starting user_presence_history migration...');

  const { error } = await supabase.rpc('exec_sql', {
    sql_string: `
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
    `
  });

  if (error) {
    if (error.message.includes('function exec_sql does not exist')) {
      logger.warn('exec_sql RPC not available. Please run this SQL manually in the Supabase Dashboard SQL Editor:');
      console.log(`
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
      `);
    } else {
      logger.error('Migration failed:', error);
      process.exit(1);
    }
  } else {
    logger.info('Migration completed successfully!');
  }
}

run();
