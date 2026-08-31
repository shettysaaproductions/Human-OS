import { Client } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '../.env') });

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL || DATABASE_URL.trim() === '') {
  console.error('[Error] DATABASE_URL is missing. Cannot migrate.');
  process.exit(1);
}

async function run() {
  console.log('--- Applying Migrations 041 & 042 to Live Production DB ---');
  const client = new Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();

    const sql41 = fs.readFileSync(path.join(__dirname, '../supabase/migrations/041_p1_lifethread_schema.sql'), 'utf8');
    console.log('Applying 041_p1_lifethread_schema.sql...');
    await client.query(sql41);

    const sql42 = fs.readFileSync(path.join(__dirname, '../supabase/migrations/042_p1_lifethread_unique_index.sql'), 'utf8');
    console.log('Applying 042_p1_lifethread_unique_index.sql...');
    await client.query(sql42);

    console.log('Reloading PostgREST schema cache...');
    await client.query("NOTIFY pgrst, 'reload schema';");

    console.log('[PASS] Migrations 041 & 042 applied and schema cache reloaded.');
    process.exit(0);
  } catch (err: any) {
    console.error('[Error] Migration execution failed:', err.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

run();
