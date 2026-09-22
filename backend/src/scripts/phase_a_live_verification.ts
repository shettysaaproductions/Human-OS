/**
 * Phase A — Independent Live Supabase Verification
 * 
 * Checks:
 * 1. RLS status on all user-data tables (anon access test)
 * 2. kg_edges unique index actually deployed (duplicate insert test)
 * 3. Real data metrics (no trust of prior claims)
 * 4. Goal/life_thread/reminders/nova_agenda schema discovery
 * 5. Security-sensitive RPC anon access
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY!;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY || 'no-anon-key');

const PASS = '✅ PASS';
const FAIL = '❌ FAIL';
const WARN = '⚠️  WARN';
const INFO = '   INFO';

const USER_DATA_TABLES = [
  'profiles', 'chat_history', 'memories', 'memory_bubbles',
  'working_memory', 'kg_nodes', 'kg_edges', 'nova_agenda',
  'nova_outreach_log', 'emotional_states', 'reflections',
  'background_jobs', 'failed_jobs', 'processed_jobs',
  'user_moments', 'user_moment_preferences', 'user_routines',
  'reminders', 'life_threads', 'short_term_memories',
  'telemetry_events', 'canonical_entity_corrections',
  'user_presence', 'presence_history', 'audit_log',
];

async function checkRLS(): Promise<number> {
  console.log('\n════════════════════════════════════════════════════');
  console.log('SECTION 1: RLS — ANON ACCESS TEST');
  console.log('════════════════════════════════════════════════════');

  let rlsViolations = 0;

  for (const table of USER_DATA_TABLES) {
    try {
      const { count, error } = await anon
        .from(table)
        .select('*', { count: 'exact', head: true });

      if (error) {
        if (error.code === '42P01') {
          console.log(`${INFO} ${table.padEnd(38)} — TABLE NOT FOUND`);
        } else if (
          error.code === 'PGRST301' ||
          error.code === '42501' ||
          error.message?.toLowerCase().includes('permission') ||
          error.message?.toLowerCase().includes('rls') ||
          error.message?.toLowerCase().includes('policy')
        ) {
          console.log(`${PASS} ${table.padEnd(38)} — Anon blocked`);
        } else {
          console.log(`${WARN} ${table.padEnd(38)} — Anon error (${error.code}): ${error.message?.substring(0, 50)}`);
        }
      } else {
        // No error from anon client.
        // count === null + no rows = PostgREST returned empty for non-existent table (false positive).
        // count >= 0 = table exists and anon can genuinely read it (real violation).
        if (count === null) {
          console.log(`${INFO} ${table.padEnd(38)} — TABLE NOT FOUND (PostgREST null, skip)`);
        } else {
          console.log(`${FAIL} ${table.padEnd(38)} — ANON READ OPEN (count=${count})`);
          rlsViolations++;
        }
      }
    } catch (e: any) {
      console.log(`${WARN} ${table.padEnd(38)} — Exception: ${e.message?.substring(0, 50)}`);
    }
  }

  console.log(`\nTotal RLS violations (anon-readable): ${rlsViolations}`);
  return rlsViolations;
}

async function checkKgEdgesConstraint(): Promise<boolean> {
  console.log('\n════════════════════════════════════════════════════');
  console.log('SECTION 2: kg_edges UNIQUE CONSTRAINT — DUPLICATE INSERT TEST');
  console.log('════════════════════════════════════════════════════');

  const { data: edges, error } = await admin
    .from('kg_edges')
    .select('*')
    .limit(1)
    .maybeSingle();

  if (error) {
    console.log(`${FAIL} Cannot query kg_edges: ${error.message}`);
    return false;
  }

  if (!edges) {
    console.log(`${WARN} No kg_edges rows in production — cannot test constraint`);
    console.log(`${WARN} This means zero data but we CANNOT confirm the constraint is deployed`);
    return false;
  }

  console.log(`${INFO} Test edge: user=${edges.user_id?.substring(0,8)}... rel=${edges.relation_type}`);

  // Attempt to insert an exact duplicate
  const dupPayload: Record<string, any> = {
    user_id: edges.user_id,
    source_node_id: edges.source_node_id,
    target_node_id: edges.target_node_id,
    relation_type: edges.relation_type,
    weight: edges.weight ?? 1.0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const { error: dupErr } = await admin.from('kg_edges').insert(dupPayload);

  if (dupErr) {
    if (dupErr.code === '23505') {
      console.log(`${PASS} UNIQUE CONSTRAINT ENFORCED — duplicate insert rejected with code 23505`);
      console.log(`       Detail: ${dupErr.message?.substring(0, 120)}`);
      return true;
    } else {
      console.log(`${WARN} Insert failed but not with unique violation code 23505`);
      console.log(`       Code: ${dupErr.code} | Message: ${dupErr.message?.substring(0, 80)}`);
      return false;
    }
  } else {
    console.log(`${FAIL} UNIQUE CONSTRAINT NOT ENFORCED — duplicate insert SUCCEEDED`);
    console.log(`       Migration 20260922_kg_edges_canonical_unique_index.sql may not be applied`);
    // Cleanup: delete one of the duplicates
    await admin
      .from('kg_edges')
      .delete()
      .eq('user_id', edges.user_id)
      .eq('source_node_id', edges.source_node_id)
      .eq('target_node_id', edges.target_node_id)
      .eq('relation_type', edges.relation_type)
      .neq('id', edges.id)
      .limit(1);
    return false;
  }
}

async function checkDataMetrics() {
  console.log('\n════════════════════════════════════════════════════');
  console.log('SECTION 3: REAL DATA METRICS');
  console.log('════════════════════════════════════════════════════');

  type TableCheck = { label: string; table: string; eq?: [string, any]; is?: [string, null] };
  const checks: TableCheck[] = [
    { label: 'Active memory_bubbles', table: 'memory_bubbles', eq: ['is_archived', false] },
    { label: 'Active memories', table: 'memories', eq: ['is_archived', false] },
    { label: 'Active kg_nodes', table: 'kg_nodes', eq: ['is_archived', false] },
    { label: 'Total kg_edges', table: 'kg_edges' },
    { label: 'Active life_threads', table: 'life_threads', eq: ['state', 'active'] },
    { label: 'All life_threads', table: 'life_threads' },
    { label: 'All reminders', table: 'reminders' },
    { label: 'Pending reminders', table: 'reminders', eq: ['status', 'pending'] },
    { label: 'All nova_agenda', table: 'nova_agenda' },
    { label: 'Pending nova_agenda', table: 'nova_agenda', eq: ['status', 'pending'] },
    { label: 'working_memory entries', table: 'working_memory' },
    { label: 'Total chat_history', table: 'chat_history' },
    { label: 'nova_outreach_log total', table: 'nova_outreach_log' },
  ];

  for (const c of checks) {
    let q = admin.from(c.table).select('*', { count: 'exact', head: true });
    if (c.eq) q = (q as any).eq(c.eq[0], c.eq[1]);
    const { count, error } = await q;
    if (error?.code === '42P01') {
      console.log(`${INFO} ${c.label.padEnd(38)}: TABLE NOT FOUND`);
    } else if (error) {
      console.log(`${WARN} ${c.label.padEnd(38)}: ${error.message?.substring(0, 50)}`);
    } else {
      console.log(`${INFO} ${c.label.padEnd(38)}: ${count}`);
    }
  }

  // Critical: memories without bubble_id (unowned = bad)
  const { count: unowned, error: uErr } = await admin
    .from('memories')
    .select('*', { count: 'exact', head: true })
    .eq('is_archived', false)
    .is('bubble_id', null);

  if (!uErr) {
    const s = unowned === 0 ? PASS : FAIL;
    console.log(`${s} Memories without bubble_id (unowned): ${unowned}`);
  }

  // kg_nodes without bubble_id reference
  const { count: unmappedNodes, error: unErr } = await admin
    .from('kg_nodes')
    .select('*', { count: 'exact', head: true })
    .eq('is_archived', false)
    .is('bubble_id', null);

  if (!unErr) {
    const s = unmappedNodes === 0 ? PASS : WARN;
    console.log(`${s} kg_nodes without bubble_id:           ${unmappedNodes}`);
  }
}

async function discoverGoalLifecycle() {
  console.log('\n════════════════════════════════════════════════════');
  console.log('SECTION 4: GOAL/COMMITMENT/REMINDER ARCHITECTURE');
  console.log('════════════════════════════════════════════════════');

  const goalTables = ['life_threads', 'reminders', 'nova_agenda'];
  for (const t of goalTables) {
    const { data, error } = await admin.from(t).select('*').limit(1).maybeSingle();
    if (error?.code === '42P01') {
      console.log(`${INFO} ${t}: NOT FOUND`);
      continue;
    }
    if (error) {
      console.log(`${WARN} ${t}: ${error.message}`);
      continue;
    }
    if (!data) {
      console.log(`${INFO} ${t}: EMPTY TABLE`);
      continue;
    }
    const cols = Object.keys(data);
    console.log(`${INFO} ${t} columns: [${cols.join(', ')}]`);
  }

  // Check if GoalProcessEngine's expected columns exist in reminders
  const { data: reminderRow } = await admin.from('reminders').select('*').limit(1).maybeSingle();
  if (reminderRow) {
    const hasLifecycle = 'lifecycle_state' in reminderRow;
    const hasProcessId = 'process_id' in reminderRow;
    const hasGoalDesc = 'goal_description' in reminderRow;
    console.log(`${INFO} reminders.lifecycle_state exists: ${hasLifecycle}`);
    console.log(`${INFO} reminders.process_id exists: ${hasProcessId}`);
    console.log(`${INFO} reminders.goal_description exists: ${hasGoalDesc}`);
    if (!hasLifecycle || !hasProcessId) {
      console.log(`${WARN} GoalProcessEngine columns missing from reminders — GoalProcessEngine likely DEAD`);
    }
  }
}

async function checkRPCSecurity() {
  console.log('\n════════════════════════════════════════════════════');
  console.log('SECTION 5: RPC ANON ACCESS (SECURITY)');
  console.log('════════════════════════════════════════════════════');

  const rpcs = [
    { name: 'canonical_merge_entities', args: { p_user_id: '00000000-0000-0000-0000-000000000000', p_winner_id: '00000000-0000-0000-0000-000000000001', p_loser_id: '00000000-0000-0000-0000-000000000002' } },
    { name: 'rebuild_kg_projection', args: { p_user_id: '00000000-0000-0000-0000-000000000000' } },
  ];

  for (const rpc of rpcs) {
    const { error } = await anon.rpc(rpc.name, rpc.args);
    if (error) {
      const blocked = error.code === '42501' || error.message?.toLowerCase().includes('permission') ||
        error.message?.toLowerCase().includes('rls') || error.code === 'PGRST301' ||
        error.message?.toLowerCase().includes('not found');
      console.log(`${blocked ? PASS : FAIL} ${rpc.name} — anon ${blocked ? 'BLOCKED' : 'ALLOWED'}: ${error.message?.substring(0, 60)}`);
    } else {
      console.log(`${FAIL} ${rpc.name} — anon call SUCCEEDED (security issue)`);
    }
  }
}

async function main() {
  console.log('════════════════════════════════════════════════════');
  console.log('PHASE A — INDEPENDENT LIVE SUPABASE VERIFICATION');
  console.log(`Timestamp: ${new Date().toISOString()}`);
  console.log(`SUPABASE_URL: ${SUPABASE_URL}`);
  console.log('════════════════════════════════════════════════════');

  const rlsViolations = await checkRLS();
  const constraintOk = await checkKgEdgesConstraint();
  await checkDataMetrics();
  await discoverGoalLifecycle();
  await checkRPCSecurity();

  console.log('\n════════════════════════════════════════════════════');
  console.log('PHASE A EXECUTIVE SUMMARY');
  console.log('════════════════════════════════════════════════════');
  console.log(`RLS violations (anon reads open): ${rlsViolations === 0 ? PASS + ' 0' : FAIL + ' ' + rlsViolations}`);
  console.log(`kg_edges unique constraint live:  ${constraintOk ? PASS : FAIL + ' NOT ENFORCED'}`);
  console.log('════════════════════════════════════════════════════');
}

main().catch(e => {
  console.error('Fatal error:', e.message);
  process.exit(1);
});
