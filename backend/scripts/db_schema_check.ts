/**
 * Diagnostic: check prod schema for the new presence/read-receipt columns and
 * reload the PostgREST schema cache if the columns exist but REST can't see them.
 * Run: npx ts-node scripts/db_schema_check.ts
 */
import { Pool } from 'pg';
import { config } from '../src/config';
import { supabaseAdmin } from '../src/lib/supabase';

async function main() {
  console.log('=== PROD DB SCHEMA CHECK ===');
  const pool = new Pool({ connectionString: config.database.databaseUrl, ssl: { rejectUnauthorized: false } });

  // 1. Direct SQL checks
  const tablesCheck = await pool.query(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name IN ('user_presence','chat_history','profiles')
    ORDER BY table_name`);
  console.log('Tables found in DB:', tablesCheck.rows.map((r) => r.table_name).join(', ') || 'NONE');

  const colsCheck = await pool.query(`
    SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema = 'public'
      AND ((table_name = 'chat_history' AND column_name IN ('is_read','read_at'))
        OR (table_name = 'profiles' AND column_name = 'country')
        OR (table_name = 'memories' AND column_name IN ('key','value'))
        OR (table_name = 'reminders' AND column_name IN ('title','text','trigger_at')))
    ORDER BY table_name, column_name`);
  console.log('Columns in DB:');
  colsCheck.rows.forEach((r) => console.log(`  ${r.table_name}.${r.column_name}`));

  // 2. REST-side checks (what PostgREST/schema cache sees)
  const restCheck: any[] = [];
  try {
    const { data, error } = await supabaseAdmin.from('user_presence').select('user_id').limit(1);
    restCheck.push(['user_presence', error ? `❌ ${error.message}` : '✅ ok']);
  } catch (e: any) { restCheck.push(['user_presence', `❌ ${e.message}`]); }
  try {
    const { error } = await supabaseAdmin.from('chat_history').select('is_read, read_at').limit(1);
    restCheck.push(['chat_history.is_read/read_at', error ? `❌ ${error.message}` : '✅ ok']);
  } catch (e: any) { restCheck.push(['chat_history.is_read/read_at', `❌ ${e.message}`]); }
  try {
    const { error } = await supabaseAdmin.from('profiles').select('country').limit(1);
    restCheck.push(['profiles.country', error ? `❌ ${error.message}` : '✅ ok']);
  } catch (e: any) { restCheck.push(['profiles.country', `❌ ${e.message}`]); }
  try {
    const { data, error } = await supabaseAdmin.from('memories').select('key, value').limit(1);
    restCheck.push(['memories.key/value', error ? `❌ ${error.message}` : '✅ ok']);
  } catch (e: any) { restCheck.push(['memories.key/value', `❌ ${e.message}`]); }
  try {
    const { data, error } = await supabaseAdmin.from('reminders').select('title').limit(1);
    restCheck.push(['reminders.title', error ? `❌ ${error.message}` : '✅ ok']);
  } catch (e: any) { restCheck.push(['reminders.title', `❌ ${e.message}`]); }

  console.log('\nREST (PostgREST schema cache) view:');
  restCheck.forEach(([name, result]) => console.log(`  ${name}: ${result}`));

  const anyRESTFail = restCheck.some(([, r]) => String(r).startsWith('❌'));

  // 3. If columns exist in DB but REST fails → reload the schema cache
  if (anyRESTFail) {
    console.log('\n⚠️ REST fails but direct SQL has the columns → reloading PostgREST schema cache...');
    await pool.query(`NOTIFY pgrst, 'reload schema'`);
    console.log('  NOTIFY sent. Waiting 3s...');
    await new Promise((r) => setTimeout(r, 3000));

    // Re-check REST
    const { error: e1 } = await supabaseAdmin.from('user_presence').select('user_id').limit(1);
    const { error: e2 } = await supabaseAdmin.from('chat_history').select('is_read, read_at').limit(1);
    const { error: e3 } = await supabaseAdmin.from('profiles').select('country').limit(1);
    const { error: e4 } = await supabaseAdmin.from('memories').select('key, value').limit(1);
    console.log('  After reload →',
      ['user_presence', 'chat_history.is_read', 'profiles.country', 'memories.key/value']
        .map((n, i) => `${n}: ${[e1, e2, e3, e4][i] ? '❌' : '✅'}`).join(' | '));
  } else {
    console.log('\n✅ REST sees all columns — no reload needed.');
  }

  await pool.end();
}

main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
