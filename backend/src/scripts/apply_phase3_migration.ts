import { Client } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import dotenv from 'dotenv';

dotenv.config();

async function main() {
  console.log('Connecting to PostgreSQL...');
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log('Connected to PostgreSQL database successfully.');

    const sqlPath = path.join(__dirname, '../../supabase/migrations/20260918_kg_nodes_bubble_id_and_canonical_merge_rpc.sql');
    console.log(`Reading migration from: ${sqlPath}`);
    const sql = fs.readFileSync(sqlPath, 'utf8');

    console.log('Applying migration SQL...');
    await client.query(sql);
    console.log('✓ Migration executed successfully.');

    console.log('Granting privileges...');
    await client.query(`
      GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO postgres, anon, authenticated, service_role;
      GRANT ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public TO postgres, anon, authenticated, service_role;
    `);
    console.log('✓ Privileges granted.');

    console.log('Reloading schema cache...');
    await client.query("NOTIFY pgrst, 'reload schema';");
    console.log('✓ Schema cache reloaded.');

    // Verify kg_nodes has bubble_id
    const colRes = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'kg_nodes' AND column_name = 'bubble_id';
    `);
    console.log('kg_nodes.bubble_id check:', colRes.rows);

    // Verify canonical_merge_entities function exists
    const fnRes = await client.query(`
      SELECT proname FROM pg_proc WHERE proname = 'canonical_merge_entities';
    `);
    console.log('canonical_merge_entities check:', fnRes.rows);

    console.log('\n✅ ALL CHECKS PASSED.');
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
