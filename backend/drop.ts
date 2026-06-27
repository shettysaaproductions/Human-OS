import { supabaseAdmin } from './src/lib/supabase';

async function drop() {
  const { error } = await supabaseAdmin.rpc('run_sql', { sql: 'DROP FUNCTION IF EXISTS search_relevant_memories(uuid, text, integer);' });
  if (error) console.error(error);
  console.log('done');
}
drop();
