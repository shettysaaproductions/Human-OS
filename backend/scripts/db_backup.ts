import { Client } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL || DATABASE_URL.trim() === '') {
  console.error('[Error] DATABASE_URL is missing. Cannot backup database.');
  process.exit(1);
}

async function backup() {
  console.log('--- Starting Portable Database Backup ---');
  
  const client = new Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();

    // 1. Get all tables in public schema
    const tablesRes = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE';
    `);
    const tables = tablesRes.rows.map(row => row.table_name);
    console.log(`Found ${tables.length} tables in public schema.`);

    const backupData: Record<string, any[]> = {};

    // 2. Fetch data from each table
    for (const table of tables) {
      console.log(`Backing up table: ${table}...`);
      const dataRes = await client.query(`SELECT * FROM public."${table}";`);
      backupData[table] = dataRes.rows;
    }

    // 3. Save JSON payload
    const backupsDir = path.join(__dirname, '../backups');
    if (!fs.existsSync(backupsDir)) {
      fs.mkdirSync(backupsDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `backup_${timestamp}.json`;
    const filepath = path.join(backupsDir, filename);

    fs.writeFileSync(filepath, JSON.stringify(backupData, null, 2), 'utf8');
    console.log(`\n[SUCCESS] Backup saved successfully to: ${filepath}`);
    process.exit(0);
  } catch (err: any) {
    console.error('\n[Error] Backup failed:', err.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

backup();
