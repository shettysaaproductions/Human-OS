import { Client } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import dotenv from 'dotenv';

dotenv.config();

const DATABASE_URL = process.env.DATABASE_URL;
const NODE_ENV = process.env.NODE_ENV || 'development';
const SAFETY_MODE = process.env.SAFETY_MODE || 'development';

if (!DATABASE_URL || DATABASE_URL.trim() === '') {
  console.error('[Error] DATABASE_URL is missing. Cannot reset database.');
  process.exit(1);
}

const isProduction = NODE_ENV === 'production' || SAFETY_MODE === 'production';
const hasForceFlag = process.argv.includes('--confirm-production');

function askQuestion(query: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  return new Promise(resolve => rl.question(query, ans => {
    rl.close();
    resolve(ans);
  }));
}

async function performReset(client: Client) {
  // 1. Drop all tables
  const dropSqlPath = path.join(__dirname, '../supabase/drop_all_tables.sql');
  if (fs.existsSync(dropSqlPath)) {
    console.log('Executing drop_all_tables.sql...');
    const dropSql = fs.readFileSync(dropSqlPath, 'utf8');
    await client.query(dropSql);
    console.log('[PASS] Dropped all tables.');
  } else {
    console.log('[Warning] drop_all_tables.sql not found. Skipping drop.');
  }

  // 2. Re-run migrations
  const migrationsDir = path.join(__dirname, '../supabase/migrations');
  const files = fs.readdirSync(migrationsDir)
    .filter(file => file.endsWith('.sql'))
    .sort();

  console.log(`Re-executing migrations...`);
  for (const file of files) {
    console.log(`Executing ${file}...`);
    const filePath = path.join(migrationsDir, file);
    const sql = fs.readFileSync(filePath, 'utf8');
    await client.query(sql);
    console.log(`Migration ${file} executed.`);
  }

  // 3. Apply Grants
  console.log('\nApplying automatic security GRANTS...');
  await client.query(`
    GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO postgres, anon, authenticated, service_role;
    GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO postgres, anon, authenticated, service_role;
    GRANT ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public TO postgres, anon, authenticated, service_role;
  `);
  console.log('[PASS] Security GRANTS applied successfully.');

  // 4. Reload cache
  console.log('Reloading PostgREST schema cache...');
  await client.query("NOTIFY pgrst, 'reload schema';");
  console.log('[PASS] PostgREST schema cache reloaded.');

  console.log('\n--- Database Reset and Recreated Successfully ---');
}

async function resetDb() {
  console.log(`--- Starting Database Reset ---`);
  
  if (isProduction) {
    console.warn('\n!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
    console.warn('WARNING: YOU ARE RUNNING RESET ON A PRODUCTION DATABASE!');
    console.warn('THIS WILL DROP ALL TABLES AND ERASE ALL DATA!');
    console.warn('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!\n');

    if (!hasForceFlag) {
      const answer = await askQuestion("Type 'FORCE RESET' to confirm dropping the production database: ");
      if (answer !== 'FORCE RESET') {
        console.error('[ABORTED] Reset cancelled. Safe exit.');
        process.exit(1);
      }
    } else {
      console.log('Production flag --confirm-production detected. Bypassing prompt.');
    }
  }

  const client = new Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    await performReset(client);
    process.exit(0);
  } catch (err: any) {
    console.error('\n[Error] Database reset failed:', err.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

resetDb();
