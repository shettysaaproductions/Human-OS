import { Client } from 'pg';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const dbUrl = process.env.DATABASE_URL;

if (!dbUrl) {
  console.error('Missing DATABASE_URL in .env');
  process.exit(1);
}

const client = new Client({
  connectionString: dbUrl,
  ssl: {
    rejectUnauthorized: false
  }
});

async function runMigration() {
  console.log('Connecting to database...');
  await client.connect();
  console.log('Connected. Running migration for nova_thoughts table...');

  try {
    const ddl = `
      CREATE TABLE IF NOT EXISTS nova_thoughts (
        id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        chat_message_id UUID REFERENCES chat_history(id) ON DELETE CASCADE,
        user_id UUID NOT NULL,
        thoughts JSONB NOT NULL DEFAULT '[]',
        created_at TIMESTAMPTZ DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS idx_nova_thoughts_msg ON nova_thoughts(chat_message_id);
      CREATE INDEX IF NOT EXISTS idx_nova_thoughts_user_time ON nova_thoughts(user_id, created_at DESC);
    `;

    await client.query(ddl);
    console.log('Migration successful! nova_thoughts table created.');
  } catch (error) {
    console.error('Error running migration:', error);
  } finally {
    await client.end();
  }
}

runMigration();
