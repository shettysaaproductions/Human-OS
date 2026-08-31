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
  console.log('--- Applying Migration 054 to Live Production DB ---');
  const client = new Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();

    const sqlPath = path.join(__dirname, '../supabase/migrations/054_p3d_lifethread_cultivation.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');

    console.log('Executing SQL from 054_p3d_lifethread_cultivation.sql:');
    console.log(sql);

    await client.query(sql);
    console.log('[PASS] Migration 054 applied successfully.');

    // Reload PostgREST schema cache
    console.log('Reloading PostgREST schema cache...');
    await client.query("NOTIFY pgrst, 'reload schema';");
    console.log('[PASS] PostgREST schema cache reloaded.');

    // Schema verification
    console.log('Verifying columns on public.life_threads...');
    const res = await client.query(`
      SELECT column_name, data_type, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'life_threads'
      ORDER BY ordinal_position;
    `);

    const colNames = res.rows.map((r: any) => r.column_name);
    console.log('Current life_threads columns:', colNames.join(', '));

    const requiredCols = [
      'cultivation_stage',
      'category',
      'blockers',
      'milestones',
      'next_useful_step',
      'last_cultivated_at',
      'next_relevant_time'
    ];

    const missing = requiredCols.filter(c => !colNames.includes(c));
    if (missing.length > 0) {
      throw new Error(`Missing columns after migration: ${missing.join(', ')}`);
    }

    console.log('[PASS] Production schema verified with all required Phase 3D columns.');
    process.exit(0);
  } catch (err: any) {
    console.error('[Error] Migration 054 execution failed:', err.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

run();
