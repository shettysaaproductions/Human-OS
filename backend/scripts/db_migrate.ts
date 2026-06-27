import { Client } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const DATABASE_URL = process.env.DATABASE_URL;
const NODE_ENV = process.env.NODE_ENV || 'development';
const SAFETY_MODE = process.env.SAFETY_MODE || 'development';

if (!DATABASE_URL || DATABASE_URL.trim() === '') {
  console.error('[Error] DATABASE_URL is missing. Cannot migrate.');
  process.exit(1);
}

const isProduction = NODE_ENV === 'production' || SAFETY_MODE === 'production';

async function migrate() {
  console.log(`--- Starting Database Migrations (Mode: ${isProduction ? 'PRODUCTION' : 'DEVELOPMENT'}) ---`);
  
  const client = new Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();

    const migrationsDir = path.join(__dirname, '../supabase/migrations');
    const files = fs.readdirSync(migrationsDir)
      .filter(file => file.endsWith('.sql'))
      .sort();

    console.log(`Found ${files.length} migration files.`);

    for (const file of files) {
      console.log(`Executing ${file}...`);
      const filePath = path.join(migrationsDir, file);
      const sql = fs.readFileSync(filePath, 'utf8');

      // Execute migration
      try {
        await client.query(sql);
        console.log(`Successfully executed: ${file}`);
      } catch (err: any) {
        // Postgres codes: 42P07 = duplicate_table, 42701 = duplicate_column
        if (err.code === '42P07' || err.code === '42701' || err.message.includes('already exists')) {
          console.warn(`[Info] Skipping existing schema in ${file}: ${err.message}`);
        } else {
          throw err;
        }
      }
    }

    // Automatically apply grants to prevent PGRST205 errors
    console.log('\nApplying automatic security GRANTS...');
    await client.query(`
      GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO postgres, anon, authenticated, service_role;
      GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO postgres, anon, authenticated, service_role;
      GRANT ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public TO postgres, anon, authenticated, service_role;
    `);
    console.log('[PASS] Security GRANTS applied successfully.');

    // Reload PostgREST schema cache
    console.log('\nReloading PostgREST schema cache...');
    await client.query("NOTIFY pgrst, 'reload schema';");
    console.log('[PASS] Schema cache reloaded successfully.');

    console.log('\n--- Migration Pipeline Finished Successfully ---');
    process.exit(0);
  } catch (err: any) {
    console.error('\n[Error] Migration failed:', err.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

migrate();
