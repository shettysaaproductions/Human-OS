/**
 * INDEPENDENT LIVE SUPABASE SECURITY AUDIT
 * 
 * Queries the actual live Supabase DB (via direct pg connection with service_role)
 * to produce a complete, truthful table-by-table access model inventory.
 * 
 * Output: JSON with every public table's RLS status, policy count, and a
 * classification recommendation.
 */
import { Client } from 'pg';
import * as dotenv from 'dotenv';
dotenv.config();

async function main() {
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  console.log('✅ Connected to live Supabase');

  // 1. Get all public tables and their RLS status
  const { rows: allTables } = await c.query<{
    tablename: string; rowsecurity: boolean;
  }>(`
    SELECT tablename, rowsecurity
    FROM pg_tables
    WHERE schemaname = 'public'
    ORDER BY tablename
  `);

  interface PolicyRow {
    tablename: string;
    policyname: string;
    cmd: string;
    roles: string;
    qual: string;
    with_check: string;
  }

  // 2. Get all RLS policies grouped by table
  const { rows: allPolicies } = await c.query<PolicyRow>(`
    SELECT tablename, policyname, cmd, array_to_string(roles, ',') as roles, 
           qual, with_check
    FROM pg_policies
    WHERE schemaname = 'public'
    ORDER BY tablename, policyname
  `);

  // 3. Get grants per table
  const { rows: allGrants } = await c.query<{
    table_name: string; grantee: string; privilege_type: string;
  }>(`
    SELECT table_name, grantee, privilege_type
    FROM information_schema.role_table_grants
    WHERE table_schema = 'public'
      AND grantee IN ('anon', 'authenticated', 'service_role', 'PUBLIC')
    ORDER BY table_name, grantee, privilege_type
  `);

  // 4. Check row counts per table (to understand which tables have data)
  const rowCountResults: Record<string, number> = {};
  for (const t of allTables.slice(0, 50)) {
    try {
      const res = await c.query(`SELECT COUNT(*) as n FROM public."${t.tablename}"`);
      rowCountResults[t.tablename] = parseInt(res.rows[0].n);
    } catch { rowCountResults[t.tablename] = -1; }
  }

  await c.end();

  // Build per-table report
  const policyMap: Record<string, PolicyRow[]> = {};
  for (const p of allPolicies) {
    if (!policyMap[p.tablename]) policyMap[p.tablename] = [];
    policyMap[p.tablename].push(p);
  }
  const grantMap: Record<string, string[]> = {};
  for (const g of allGrants) {
    if (!grantMap[g.table_name]) grantMap[g.table_name] = [];
    grantMap[g.table_name].push(`${g.grantee}:${g.privilege_type}`);
  }

  // Classify tables
  const SYSTEM_TABLES = new Set([
    'background_jobs','failed_jobs','processed_jobs','agent_metrics','query_metrics',
    'telemetry_events','audit_logs','nova_scan_checkpoints','memory_compaction_runs',
    'nova_guardian_runs','nova_guardian_anomalies','nova_guardian_repairs',
    'memory_access_log','memory_events',
  ]);
  const CONFIG_TABLES = new Set(['app_settings','llm_providers']);
  const USER_OWNED_TABLES = new Set([
    'profiles','chat_history','memories','memory_bubbles','working_memory',
    'kg_nodes','kg_edges','nova_agenda','nova_outreach_log','emotional_states',
    'reflections','episodic_memories','user_feedback','user_moments',
    'user_moment_preferences','user_routines','nova_cognitive_doubts',
    'nova_corrections_log','recovery_archive','tombstones','conversation_sessions',
    'short_term_memories','life_threads','reminders','user_presence',
    'nova_voice_sessions','scheduled_routines','nova_subconscious_queue',
  ]);

  const report: any[] = [];
  let tablesNoRLS = 0;
  let tablesProtected = 0;
  let systemLocked = 0;
  let anonAccessible = 0;

  for (const t of allTables) {
    const policies: PolicyRow[] = policyMap[t.tablename] || [];
    const grants = grantMap[t.tablename] || [];
    const hasAnonRead = grants.some(g => g.startsWith('anon:SELECT') || g.startsWith('PUBLIC:SELECT'));
    const hasAnonWrite = grants.some(g => g.startsWith('anon:INSERT') || g.startsWith('anon:UPDATE') || g.startsWith('anon:DELETE'));
    
    let classification = 'UNKNOWN';
    if (SYSTEM_TABLES.has(t.tablename)) classification = 'SYSTEM_ONLY';
    else if (CONFIG_TABLES.has(t.tablename)) classification = 'CONFIG';
    else if (USER_OWNED_TABLES.has(t.tablename)) classification = 'USER_OWNED';

    const vulnerable = !t.rowsecurity && (hasAnonRead || hasAnonWrite || classification === 'USER_OWNED');
    if (!t.rowsecurity) tablesNoRLS++;
    if (t.rowsecurity && policies.length > 0) tablesProtected++;
    if (t.rowsecurity && classification === 'SYSTEM_ONLY') systemLocked++;
    if (hasAnonRead) anonAccessible++;

    report.push({
      table: t.tablename,
      rls_enabled: t.rowsecurity,
      policy_count: policies.length,
      policies: policies.map((p: PolicyRow) => `${p.cmd}:${p.roles}:${p.policyname}`),
      anon_read: hasAnonRead,
      anon_write: hasAnonWrite,
      grants: grants,
      classification,
      row_count: rowCountResults[t.tablename] ?? 'unchecked',
      action_required: vulnerable ? 'NEEDS_PROTECTION' : (t.rowsecurity ? 'OK' : 'REVIEW'),
    });
  }

  // Summary
  console.log('\n=== LIVE SUPABASE SECURITY AUDIT ===');
  console.log(`Total public tables: ${allTables.length}`);
  console.log(`Tables WITHOUT RLS:  ${tablesNoRLS} ⚠️`);
  console.log(`Tables WITH RLS + policies: ${tablesProtected} ✅`);
  console.log(`Tables with anon READ access: ${anonAccessible} ⚠️`);

  console.log('\n--- TABLES NEEDING PROTECTION ---');
  for (const r of report.filter(r => r.action_required === 'NEEDS_PROTECTION')) {
    console.log(`  ❌ ${r.table} [${r.classification}] rls=${r.rls_enabled} anon_r=${r.anon_read} policies=${r.policy_count}`);
  }

  console.log('\n--- TABLES NEEDING REVIEW (no RLS, not yet classified as vulnerable) ---');
  for (const r of report.filter(r => r.action_required === 'REVIEW')) {
    console.log(`  ⚠️  ${r.table} [${r.classification}] rls=${r.rls_enabled} anon_r=${r.anon_read} policies=${r.policy_count}`);
  }

  console.log('\n--- PROTECTED TABLES ---');
  for (const r of report.filter(r => r.action_required === 'OK')) {
    console.log(`  ✅ ${r.table} [${r.classification}] policies=${r.policy_count}`);
  }

  console.log('\n--- FULL POLICY DETAILS (protected tables) ---');
  for (const r of report.filter(r => r.rls_enabled && r.policies.length > 0)) {
    console.log(`  ${r.table}: ${r.policies.join(' | ')}`);
  }

  // Write machine-readable report
  const fs = require('fs');
  fs.writeFileSync('/tmp/security_audit.json', JSON.stringify(report, null, 2));
  console.log('\n✅ Full report written to /tmp/security_audit.json');
}

main().catch(e => { console.error('AUDIT FAILED:', e.message); process.exit(1); });
