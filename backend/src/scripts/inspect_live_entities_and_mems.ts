import { supabaseAdmin } from '../lib/supabase';

async function main() {
  const userId = '62f9190b-1e1d-48d5-9667-12cd0bc3114b';
  const { data: bubbles } = await supabaseAdmin
    .from('memory_bubbles')
    .select('id, label, slug, bubble_type, domain_key, relation_type, metadata, parent_bubble_id')
    .eq('user_id', userId)
    .eq('is_archived', false)
    .order('created_at', { ascending: true });

  console.log(`TOTAL ACTIVE BUBBLES: ${bubbles?.length}`);
  for (let i = 0; i < (bubbles || []).length; i++) {
    const b = bubbles![i];
    const { data: mems } = await supabaseAdmin
      .from('memories')
      .select('key, value')
      .eq('bubble_id', b.id)
      .eq('is_archived', false);
    const memKeys = (mems || []).map(m => `${m.key}=${m.value.slice(0, 25)}`).join(', ');
    console.log(`[${i+1}] ID: ${b.id} | Label: "${b.label}" | Slug: "${b.slug}" | Rel: "${b.relation_type}" | Domain: "${b.domain_key}" | Type: "${b.bubble_type}" | Mems(${mems?.length}): [${memKeys}]`);
  }
}

main().catch(console.error);
