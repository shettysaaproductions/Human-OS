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
  console.log('--- Applying Migration 053 to Live Production DB ---');
  const client = new Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();

    const sqlPath = path.join(__dirname, '../supabase/migrations/053_p3c_watchtower_timing.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');

    console.log('Executing SQL from 053_p3c_watchtower_timing.sql:');
    console.log(sql);

    await client.query(sql);
    console.log('[PASS] Migration 053 applied successfully.');

    // Reload PostgREST schema cache
    console.log('Reloading PostgREST schema cache...');
    await client.query("NOTIFY pgrst, 'reload schema';");
    console.log('[PASS] PostgREST schema cache reloaded.');

    process.exit(0);
  } catch (err: any) {
    console.error('[Error] Migration 053 execution failed:', err.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

run();
