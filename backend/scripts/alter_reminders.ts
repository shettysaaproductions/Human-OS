import { Client } from 'pg';
import dotenv from 'dotenv';
dotenv.config();

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  console.log('Connected to DB');

  try {
    await client.query(`
      ALTER TABLE reminders
      ADD COLUMN IF NOT EXISTS recurrence_unit VARCHAR(50),
      ADD COLUMN IF NOT EXISTS recurrence_count INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS recurrence_limit INTEGER;
    `);
    console.log('Successfully altered reminders table');
  } catch (err) {
    console.error('Error altering table', err);
  } finally {
    await client.end();
  }
}

main();
