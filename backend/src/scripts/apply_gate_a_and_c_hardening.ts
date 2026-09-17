import { Client } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import dotenv from 'dotenv';

dotenv.config();

async function main() {
  console.log('Connecting to PostgreSQL to apply Gate A & C hardening...');
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log('Connected to PostgreSQL database.');

    const sqlPath = path.join(__dirname, '../../supabase/migrations/20260918_harden_canonical_merge_rpc.sql');
    console.log(`Reading SQL from: ${sqlPath}`);
    const sql = fs.readFileSync(sqlPath, 'utf8');

    console.log('Executing hardening SQL...');
    await client.query(sql);
    console.log('✓ SQL executed successfully.');

    // Reload PostgREST schema cache
    await client.query("NOTIFY pgrst, 'reload schema';");
    console.log('✓ PostgREST schema cache reloaded.');

    // Query pg_proc and check permissions for canonical_merge_entities
    const permQuery = await client.query(`
      SELECT 
        p.proname,
        p.prosecdef AS is_security_definer,
        p.proconfig AS search_path_config,
        pg_get_function_identity_arguments(p.oid) AS args,
        array_to_string(p.proacl, ', ') AS acl
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'canonical_merge_entities';
    `);

    console.log('\nFunction security details:');
    console.log(JSON.stringify(permQuery.rows, null, 2));

    // Test permission evaluation for different roles
    const checkAnon = await client.query(`
      SELECT has_function_privilege('anon', 'public.canonical_merge_entities(uuid,uuid,uuid)', 'EXECUTE') AS anon_can_exec;
    `);
    const checkAuth = await client.query(`
      SELECT has_function_privilege('authenticated', 'public.canonical_merge_entities(uuid,uuid,uuid)', 'EXECUTE') AS auth_can_exec;
    `);
    const checkService = await client.query(`
      SELECT has_function_privilege('service_role', 'public.canonical_merge_entities(uuid,uuid,uuid)', 'EXECUTE') AS service_can_exec;
    `);

    console.log('\nPrivilege Verification Results:');
    console.log('  anon_can_exec:       ', checkAnon.rows[0].anon_can_exec, '(MUST BE FALSE)');
    console.log('  auth_can_exec:       ', checkAuth.rows[0].auth_can_exec, '(MUST BE FALSE)');
    console.log('  service_can_exec:    ', checkService.rows[0].service_can_exec, '(MUST BE TRUE)');

    if (
      checkAnon.rows[0].anon_can_exec === false &&
      checkAuth.rows[0].auth_can_exec === false &&
      checkService.rows[0].service_can_exec === true
    ) {
      console.log('\n✅ GATE A SECURITY HARDENING VERIFIED: ONLY service_role CAN EXECUTE.');
    } else {
      throw new Error('SECURITY_CHECK_FAILED: Permissions do not match required security posture!');
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('Hardening failed:', err);
  process.exit(1);
});
