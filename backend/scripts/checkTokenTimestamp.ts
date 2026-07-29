import { supabaseAdmin } from '../src/lib/supabase';
async function run() {
  const { data } = await supabaseAdmin.from('profiles').select('push_token, updated_at').eq('id', '2289911c-f7c4-43c7-9609-1d121c3a0503').single();
  console.log('Current token:', data?.push_token);
  console.log('Last updated:', data?.updated_at);
  process.exit(0);
}
run();
