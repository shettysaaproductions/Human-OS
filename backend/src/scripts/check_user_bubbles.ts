import { supabaseAdmin } from '../lib/supabase';

async function main() {
  const userId = '62f9190b-1e1d-48d5-9667-12cd0bc3114b';
  const { data, error } = await supabaseAdmin
    .from('memory_bubbles')
    .select('id, label, slug, bubble_type, domain_key, is_archived')
    .eq('user_id', userId)
    .eq('is_archived', false);

  if (error) {
    console.error('Error querying bubbles:', error);
  } else {
    console.log('Active Bubbles:', JSON.stringify(data, null, 2));
  }
}

main().then(() => setTimeout(() => process.exit(0), 500)).catch(e => { console.error(e); process.exit(1); });
