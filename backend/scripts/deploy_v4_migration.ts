import { Client } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL || DATABASE_URL.trim() === '') {
  console.error('[Error] DATABASE_URL is missing.');
  process.exit(1);
}

async function runSingleMigration() {
  console.log('--- Deploying 20260916_memory_bubble_relocation_v4.sql to Production DB ---');
  const client = new Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    const filePath = path.join(__dirname, '../supabase/migrations/20260916_memory_bubble_relocation_v4.sql');
    const sql = fs.readFileSync(filePath, 'utf8');

    await client.query(sql);
    console.log('✓ Successfully deployed move_memory_branch_atomic_v3 (v4 migration fix) to Production DB!');

    await client.query(`
      GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO postgres, anon, authenticated, service_role;
      GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO postgres, anon, authenticated, service_role;
      GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO postgres, anon, authenticated, service_role;
    `);
    console.log('✓ Successfully refreshed schema grants!');
  } catch (err: any) {
    console.error('❌ Migration error:', err.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

runSingleMigration().catch(console.error);
