import { Client } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import dotenv from 'dotenv';

dotenv.config();

async function main() {
  console.log('Connecting to PostgreSQL database...');
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log('✓ Connected to PostgreSQL database.');

    const sqlPath = path.join(__dirname, '../../supabase/migrations/070_nova_loop_actionability_and_verification.sql');
    console.log(`Reading migration from: ${sqlPath}`);
    const sql = fs.readFileSync(sqlPath, 'utf8');

    console.log('Executing migration 070 SQL...');
    await client.query(sql);
    console.log('✓ Migration 070 executed successfully.');

    // Verify columns exist
    const incColRes = await client.query(`
      SELECT column_name, data_type, column_default 
      FROM information_schema.columns 
      WHERE table_name = 'nova_engineering_incidents' AND column_name = 'actionability_status';
    `);
    console.log('nova_engineering_incidents.actionability_status check:', incColRes.rows);

    const verifColRes = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'nova_incident_verifications' AND column_name = 'outcome';
    `);
    console.log('nova_incident_verifications.outcome check:', verifColRes.rows);

    // Verify historical rows still exist and are untouched
    const countRes = await client.query(`SELECT count(*) FROM nova_engineering_incidents;`);
    console.log('Total incidents after migration:', countRes.rows[0].count);

    const ckptRes = await client.query(`SELECT * FROM nova_loop_checkpoints;`);
    console.log('Checkpoints after migration:', ckptRes.rows);

  } catch (err: any) {
    console.error('Migration failed:', err.message);
    process.exit(1);
  } finally {
    await client.end().catch(() => {});
  }
}

main();
