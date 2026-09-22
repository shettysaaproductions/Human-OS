import { Client } from 'pg';
import * as dotenv from 'dotenv';
dotenv.config();

async function main() {
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  
  const tables = ['canonical_entity_corrections', 'presence_history', 'audit_log'];
  
  // Check what they are
  const r = await c.query(
    `SELECT table_name, table_type FROM information_schema.tables 
     WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
    [tables]
  );
  console.log('Catalog entries:', r.rows);
  
  // Check pg_tables for RLS status
  const rls = await c.query(
    `SELECT tablename, rowsecurity FROM pg_tables 
     WHERE schemaname = 'public' AND tablename = ANY($1::text[])`,
    [tables]
  );
  console.log('pg_tables RLS status:', rls.rows);
  
  // Apply RLS to each
  for (const table of tables) {
    const exists = r.rows.find((row: any) => row.table_name === table);
    if (!exists) {
      console.log(`SKIP ${table} — not in information_schema (may be view or unlogged)`);
      // Try enabling anyway
    }
    try {
      await c.query(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`);
      console.log(`✅ ${table} — RLS enabled`);
    } catch (e: any) {
      console.log(`⚠️  ${table} — ${e.message.substring(0, 80)}`);
    }
    
    // Create user-ownership policy for user-data tables
    if (table !== 'audit_log') {
      try {
        await c.query(`DROP POLICY IF EXISTS "${table}_owner_all" ON public.${table}`);
        await c.query(`CREATE POLICY "${table}_owner_all" ON public.${table} FOR ALL USING (auth.uid() = user_id)`);
        console.log(`✅ ${table} — policy created`);
      } catch (e: any) {
        console.log(`⚠️  ${table} — policy: ${e.message.substring(0, 80)}`);
      }
    }
    
    // Revoke anon
    try {
      await c.query(`REVOKE ALL ON public.${table} FROM anon`);
      console.log(`✅ ${table} — anon revoked`);
    } catch (e: any) {
      console.log(`⚠️  ${table} — revoke: ${e.message.substring(0, 60)}`);
    }
  }
  
  await c.end();
  console.log('Done');
}

main().catch(e => { console.error(e.message); process.exit(1); });
