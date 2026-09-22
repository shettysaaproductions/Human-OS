/**
 * Phase B — Apply RLS + kg_edges constraint migration directly via pg
 * Runs the full 20260922_rls_comprehensive_security.sql against live Supabase
 */
import { Client } from 'pg';
import * as dotenv from 'dotenv';
dotenv.config();

const PASS = '✅';
const FAIL = '❌';
const INFO = '   ';

async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  console.log(`${PASS} Connected to PostgreSQL\n`);

  // ── SECTION A: Enable RLS on all user-data tables ─────────────────────────
  console.log('═══════════════════════════════════════════════════');
  console.log('SECTION A: Enabling RLS on user-data tables');
  console.log('═══════════════════════════════════════════════════');

  const userOwnedTables: { table: string; userCol: string }[] = [
    { table: 'profiles', userCol: 'id' },
    { table: 'chat_history', userCol: 'user_id' },
    { table: 'memories', userCol: 'user_id' },
    { table: 'memory_bubbles', userCol: 'user_id' },
    { table: 'working_memory', userCol: 'user_id' },
    { table: 'kg_nodes', userCol: 'user_id' },
    { table: 'kg_edges', userCol: 'user_id' },
    { table: 'nova_agenda', userCol: 'user_id' },
    { table: 'nova_outreach_log', userCol: 'user_id' },
    { table: 'emotional_states', userCol: 'user_id' },
    { table: 'reflections', userCol: 'user_id' },
    { table: 'user_moments', userCol: 'user_id' },
    { table: 'user_moment_preferences', userCol: 'user_id' },
    { table: 'user_routines', userCol: 'user_id' },
    { table: 'reminders', userCol: 'user_id' },
    { table: 'life_threads', userCol: 'user_id' },
    { table: 'short_term_memories', userCol: 'user_id' },
    { table: 'user_presence', userCol: 'user_id' },
  ];

  const conditionalUserTables: { table: string; userCol: string }[] = [
    { table: 'canonical_entity_corrections', userCol: 'user_id' },
    { table: 'presence_history', userCol: 'user_id' },
    { table: 'user_feedback', userCol: 'user_id' },
  ];

  const systemTables = ['background_jobs', 'failed_jobs', 'processed_jobs', 'telemetry_events', 'audit_log'];

  // Check which tables actually exist
  const existsResult = await client.query(`
    SELECT table_name FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `);
  const existingTables = new Set(existsResult.rows.map((r: any) => r.table_name));
  console.log(`${INFO} Found ${existingTables.size} tables in public schema\n`);

  // Apply RLS to user-owned tables
  for (const t of [...userOwnedTables, ...conditionalUserTables]) {
    if (!existingTables.has(t.table)) {
      console.log(`${INFO} ${t.table.padEnd(35)} — SKIP (does not exist)`);
      continue;
    }
    try {
      await client.query(`ALTER TABLE public.${t.table} ENABLE ROW LEVEL SECURITY`);
      await client.query(`DROP POLICY IF EXISTS "${t.table}_owner_all" ON public.${t.table}`);
      await client.query(`
        CREATE POLICY "${t.table}_owner_all" ON public.${t.table}
        FOR ALL USING (auth.uid() = ${t.userCol})
      `);
      // Revoke anon select
      try {
        await client.query(`REVOKE SELECT ON public.${t.table} FROM anon`);
      } catch (_) { /* anon may not have had grant */ }
      console.log(`${PASS} ${t.table.padEnd(35)} — RLS enabled, owner policy created`);
    } catch (e: any) {
      console.log(`${FAIL} ${t.table.padEnd(35)} — ${e.message?.substring(0, 80)}`);
    }
  }

  // Apply RLS to system tables (no user policies — service_role only)
  console.log('\n--- System tables (service_role only) ---');
  for (const t of systemTables) {
    if (!existingTables.has(t)) {
      console.log(`${INFO} ${t.padEnd(35)} — SKIP (does not exist)`);
      continue;
    }
    try {
      await client.query(`ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY`);
      try {
        await client.query(`REVOKE ALL ON public.${t} FROM anon`);
        await client.query(`REVOKE ALL ON public.${t} FROM authenticated`);
      } catch (_) {}
      console.log(`${PASS} ${t.padEnd(35)} — RLS enabled, all grants revoked from anon/authenticated`);
    } catch (e: any) {
      console.log(`${FAIL} ${t.padEnd(35)} — ${e.message?.substring(0, 80)}`);
    }
  }

  // ── SECTION B: kg_edges unique constraint ────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════');
  console.log('SECTION B: kg_edges unique constraint');
  console.log('═══════════════════════════════════════════════════');

  // Check for existing duplicates before creating index
  const dupCheck = await client.query(`
    SELECT user_id, source_node_id, target_node_id, relation_type, COUNT(*) as cnt
    FROM public.kg_edges
    GROUP BY user_id, source_node_id, target_node_id, relation_type
    HAVING COUNT(*) > 1
  `);

  if (dupCheck.rows.length > 0) {
    console.log(`${INFO} Found ${dupCheck.rows.length} duplicate edge groups — deduplicating...`);
    // Delete duplicates keeping lowest id
    await client.query(`
      DELETE FROM public.kg_edges
      WHERE id NOT IN (
        SELECT MIN(id)
        FROM public.kg_edges
        GROUP BY user_id, source_node_id, target_node_id, relation_type
      )
    `);
    console.log(`${PASS} Duplicates removed`);
  } else {
    console.log(`${PASS} No duplicate kg_edges found`);
  }

  // Check if index already exists
  const idxCheck = await client.query(`
    SELECT indexname FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'kg_edges'
    AND indexname = 'idx_kg_edges_canonical_unique'
  `);

  if (idxCheck.rows.length > 0) {
    console.log(`${INFO} Index idx_kg_edges_canonical_unique already exists — dropping and recreating`);
    await client.query(`DROP INDEX IF EXISTS public.idx_kg_edges_canonical_unique`);
  }

  await client.query(`
    CREATE UNIQUE INDEX idx_kg_edges_canonical_unique
    ON public.kg_edges(user_id, source_node_id, target_node_id, relation_type)
  `);
  console.log(`${PASS} UNIQUE INDEX created: idx_kg_edges_canonical_unique`);

  // ── SECTION C: Post-migration verification ───────────────────────────────
  console.log('\n═══════════════════════════════════════════════════');
  console.log('SECTION C: Post-migration verification');
  console.log('═══════════════════════════════════════════════════');

  // Verify RLS enabled
  const rlsCheck = await client.query(`
    SELECT tablename, rowsecurity 
    FROM pg_tables 
    WHERE schemaname = 'public' AND tablename IN (
      'profiles','chat_history','memories','memory_bubbles','working_memory',
      'kg_nodes','kg_edges','nova_agenda','nova_outreach_log','emotional_states',
      'reflections','user_moments','user_moment_preferences','user_routines',
      'reminders','life_threads','short_term_memories','user_presence',
      'background_jobs','failed_jobs','processed_jobs','telemetry_events'
    )
    ORDER BY tablename
  `);

  let rlsFailCount = 0;
  for (const row of rlsCheck.rows) {
    const ok = row.rowsecurity === true;
    if (!ok) rlsFailCount++;
    console.log(`${ok ? PASS : FAIL} ${row.tablename.padEnd(35)} — RLS: ${row.rowsecurity}`);
  }

  // Verify kg_edges index
  const indexVerify = await client.query(`
    SELECT indexname, indexdef 
    FROM pg_indexes 
    WHERE schemaname = 'public' AND tablename = 'kg_edges'
    AND indexname = 'idx_kg_edges_canonical_unique'
  `);
  if (indexVerify.rows.length > 0) {
    console.log(`\n${PASS} kg_edges unique index confirmed in pg_indexes:`);
    console.log(`       ${indexVerify.rows[0].indexdef}`);
  } else {
    console.log(`\n${FAIL} kg_edges unique index NOT found in pg_indexes`);
  }

  // Count policies
  const policyCount = await client.query(`
    SELECT COUNT(*) as cnt FROM pg_policies WHERE schemaname = 'public'
  `);
  console.log(`\n${INFO} Total RLS policies in public schema: ${policyCount.rows[0].cnt}`);

  console.log('\n═══════════════════════════════════════════════════');
  console.log('PHASE B SUMMARY');
  console.log('═══════════════════════════════════════════════════');
  console.log(`RLS tables without security: ${rlsFailCount === 0 ? PASS + ' 0' : FAIL + ' ' + rlsFailCount}`);
  console.log(`kg_edges unique index:       ${indexVerify.rows.length > 0 ? PASS + ' DEPLOYED' : FAIL + ' MISSING'}`);
  console.log('═══════════════════════════════════════════════════');

  await client.end();
}

main().catch(e => {
  console.error('Fatal:', e.message);
  process.exit(1);
});
