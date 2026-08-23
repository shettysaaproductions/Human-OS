const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

async function run() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL
  });
  await client.connect();
  
  const sqlPath = path.join(__dirname, '../supabase/migrations/035_life_threads.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  
  console.log('Running migration...');
  try {
    await client.query(sql);
    console.log('Migration completed successfully.');
  } catch (err) {
    console.error('Migration failed:', err);
  } finally {
    await client.end();
  }
}

run();
