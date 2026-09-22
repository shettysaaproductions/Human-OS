/**
 * Phase 1 Security Closure — Apply Migration to Live Supabase
 * Applies 20260922_phase1_security_closure.sql
 * Then runs verification to confirm state.
 */
import { Client } from 'pg';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
dotenv.config();

async function main() {
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  console.log('✅ Connected');

  // Check schema for conditional tables before applying
  console.log('\n--- PRE-FLIGHT: checking conditional table schemas ---');
  const conditionalTables = ['nova_cognitive_doubts', 'nova_corrections_log', 'recovery_archive', 'tombstones'];
  for (const t of conditionalTables) {
    const res = await c.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1 AND column_name = 'user_id'
    `, [t]);
    console.log(`  ${t}: has user_id = ${res.rows.length > 0}`);
  }

  // Apply migration
  console.log('\n--- APPLYING migration ---');
  const sqlPath = path.join(__dirname, '../../supabase/migrations/20260922_phase1_security_closure.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');

  try {
    await c.query(sql);
    console.log('✅ Migration applied successfully');
  } catch (e: any) {
    console.error('❌ Migration failed:', e.message);
    // Try to identify which statement failed
    const stmts = sql.split(';').map(s => s.trim()).filter(s => s.length > 10);
    console.log(`Total statements: ${stmts.length}`);
    await c.end();
    process.exit(1);
  }

  // Verification
  console.log('\n--- POST-MIGRATION VERIFICATION ---');

  // 1. Tables without RLS
  const noRls = await c.query(`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND rowsecurity = false
    ORDER BY tablename
  `);
  console.log(`\nTables WITHOUT RLS: ${noRls.rows.length}`);
  if (noRls.rows.length > 0) {
    for (const r of noRls.rows) console.log(`  ❌ ${r.tablename}`);
  } else {
    console.log('  ✅ ALL tables have RLS enabled');
  }

  // 2. Policy counts per table
  const policies = await c.query(`
    SELECT tablename, COUNT(*) as policy_count
    FROM pg_policies WHERE schemaname = 'public'
    GROUP BY tablename ORDER BY tablename
  `);
  const totalPolicies = policies.rows.reduce((sum: number, r: any) => sum + parseInt(r.policy_count), 0);
  console.log(`\nTotal RLS policies: ${totalPolicies}`);

  // 3. Check anon still has access to any user table
  const anonGrants = await c.query(`
    SELECT table_name, privilege_type
    FROM information_schema.role_table_grants
    WHERE table_schema = 'public' AND grantee = 'anon'
    AND table_name NOT IN ('app_settings') -- app_settings allows anon read only via RLS
    ORDER BY table_name
  `);
  console.log(`\nRemaining anon grants (expect 0 on user/system tables): ${anonGrants.rows.length}`);
  for (const r of anonGrants.rows) {
    console.log(`  ⚠️  anon has ${r.privilege_type} on ${r.table_name}`);
  }

  // 4. Spot-check specific tables
  const spotCheck = [
    'conversation_sessions', 'episodic_memories', 'nova_cognitive_doubts',
    'nova_corrections_log', 'recovery_archive', 'tombstones',
    'agent_metrics', 'audit_logs', 'memory_access_log', 'memory_events',
    'nova_guardian_runs', 'nova_scan_checkpoints', 'query_metrics',
    'app_settings', 'llm_providers',
  ];

  console.log('\n--- SPOT-CHECK: newly protected tables ---');
  for (const t of spotCheck) {
    const rlsRes = await c.query(`
      SELECT rowsecurity FROM pg_tables WHERE schemaname='public' AND tablename=$1
    `, [t]);
    const polRes = await c.query(`
      SELECT COUNT(*) as n FROM pg_policies WHERE schemaname='public' AND tablename=$1
    `, [t]);
    const rls = rlsRes.rows[0]?.rowsecurity ?? 'NOT FOUND';
    const pols = polRes.rows[0]?.n ?? 0;
    const icon = rls === true ? '✅' : '❌';
    console.log(`  ${icon} ${t}: rls=${rls} policies=${pols}`);
  }

  // 5. Summary
  const totalTables = await c.query(`SELECT COUNT(*) as n FROM pg_tables WHERE schemaname='public'`);
  const tablesWithRls = await c.query(`SELECT COUNT(*) as n FROM pg_tables WHERE schemaname='public' AND rowsecurity=true`);
  console.log(`\n=== FINAL SUMMARY ===`);
  console.log(`Total public tables:  ${totalTables.rows[0].n}`);
  console.log(`Tables with RLS:      ${tablesWithRls.rows[0].n}`);
  console.log(`Tables without RLS:   ${noRls.rows.length}`);
  console.log(`Total RLS policies:   ${totalPolicies}`);

  await c.end();
  
  if (noRls.rows.length > 0) {
    console.error('\n❌ SECURITY CLOSURE INCOMPLETE — some tables still lack RLS');
    process.exit(1);
  } else {
    console.log('\n✅ PHASE 1 SECURITY CLOSURE COMPLETE');
  }
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
