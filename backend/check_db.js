const { Client } = require('pg');
require('dotenv').config();

const client = new Client({
  connectionString: process.env.DATABASE_URL
});

async function check() {
  await client.connect();
  
  try {
    const res = await client.query("SELECT to_regclass('public.life_threads');");
    console.log("TABLE_EXISTS:", res.rows[0].to_regclass !== null);
  } catch(e) {
    console.log("TABLE_EXISTS: false", e.message);
  }
  
  try {
    const res = await client.query("SELECT version FROM supabase_migrations.schema_migrations WHERE version = '20240823000035' OR version = '20240823000035' OR version LIKE '%035%';");
    console.log("MIGRATION_APPLIED:", res.rows.length > 0);
  } catch(e) {
    try {
        const res2 = await client.query("SELECT version FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 5;");
        console.log("RECENT MIGRATIONS:", res2.rows.map(r=>r.version).join(', '));
    } catch(e) {}
    console.log("MIGRATION_APPLIED: false", e.message);
  }
  
  await client.end();
}

check();
