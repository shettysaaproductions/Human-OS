import { getSupabaseAdmin } from '../src/lib/supabase';

async function testTable() {
  const supabase = getSupabaseAdmin();
  console.log('Testing memories table...');
  const { data, error } = await supabase.from('memories').select('*').limit(1);
  
  if (error) {
    console.error('Table Error:', error);
  } else {
    console.log('Table Success!', data);
  }
}

testTable().catch(console.error);
