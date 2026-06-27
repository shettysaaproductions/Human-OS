const { Client } = require('pg');
require('dotenv').config();

const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

client.connect()
  .then(() => client.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'"))
  .then(r => {
    console.log('Tables:', r.rows.map(row => row.table_name));
  })
  .catch(console.error)
  .finally(() => client.end());
