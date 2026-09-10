import { supabaseAdmin } from '../src/lib/supabase';

async function main() {
  const { data: followups } = await supabaseAdmin
    .from('nova_followups')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(5);

  console.log('--- RECENT NOVA_FOLLOWUPS ---');
  console.log(JSON.stringify(followups, null, 2));

  const { data: agendas } = await supabaseAdmin
    .from('nova_agenda_items')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(5);

  console.log('--- RECENT NOVA_AGENDA_ITEMS ---');
  console.log(JSON.stringify(agendas, null, 2));
}

main().catch(console.error);
