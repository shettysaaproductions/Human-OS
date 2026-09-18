import { supabaseAdmin } from '../lib/supabase';

async function main() {
  const userId = '62f9190b-1e1d-48d5-9667-12cd0bc3114b';
  const { data, error } = await supabaseAdmin
    .from('memories')
    .select('id, key, value, is_archived, lifecycle_state, updated_at')
    .eq('user_id', userId)
    .in('key', ['son_name', 'son_nickname', 'preferred_name', 'user_name']);

  if (error) {
    console.error('Query error:', error);
  } else {
    console.log('Memories found:', JSON.stringify(data, null, 2));
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
