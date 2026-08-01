import { supabaseAdmin } from './src/lib/supabase';

async function run() {
  const { count: c1 } = await supabaseAdmin.from('memories').select('*', { count: 'exact', head: true });
  console.log('total_memories:', c1);

  const { count: c2 } = await supabaseAdmin.from('episodic_memories').select('*', { count: 'exact', head: true });
  console.log('total_episodic:', c2);

  const { count: c3 } = await supabaseAdmin.from('working_memory').select('*', { count: 'exact', head: true });
  console.log('total_working:', c3);
}

run().then(() => process.exit(0)).catch(console.error);
