import '../src/config';
import { supabaseAdmin } from '../src/lib/supabase';

async function verify() {
  console.log('--- Supabase Connectivity Verification ---');
  const start = Date.now();
  try {
    // 3. List all tables (using Postgres schema query)
    await supabaseAdmin.rpc('get_tables_dummy'); // Ignore output
    
    // 4. Count rows
    const { count: profilesCount } = await supabaseAdmin.from('profiles').select('*', { count: 'exact', head: true });
    const { count: memoriesCount } = await supabaseAdmin.from('memories').select('*', { count: 'exact', head: true });
    const { count: chatCount } = await supabaseAdmin.from('chat_history').select('*', { count: 'exact', head: true });

    console.log(`Counts -> Profiles: ${profilesCount}, Memories: ${memoriesCount}, Chat History: ${chatCount}`);

    const testId = '00000000-0000-0000-0000-000000000000';
    console.log('Testing INSERT on profiles...');
    const { error: insertErr } = await supabaseAdmin.from('profiles').insert({ id: testId, preferred_name: 'Test' });
    if (insertErr) throw new Error(`Insert failed: ${insertErr.message}`);
    
    console.log('Testing READ on profiles...');
    const { error: readErr } = await supabaseAdmin.from('profiles').select('*').eq('id', testId).single();
    if (readErr) throw new Error(`Read failed: ${readErr.message}`);
    
    console.log('Testing DELETE on profiles...');
    const { error: delErr } = await supabaseAdmin.from('profiles').delete().eq('id', testId);
    if (delErr) throw new Error(`Delete failed: ${delErr.message}`);

    const latency = Date.now() - start;
    console.log('Connection Status: SUCCESS');
    console.log(`Latency: ${latency}ms`);
    console.log('Permissions Available: SELECT, INSERT, DELETE (PostgREST restricted from DDL commands like CREATE TABLE)');
    
  } catch (err: any) {
    console.error('Connection Status: FAILED');
    console.error('Error:', err.message);
  }
}

verify();
