import { getSupabaseAdmin } from '../src/lib/supabase';
import { randomUUID } from 'crypto';

async function testRPC() {
  const supabase = getSupabaseAdmin();
  console.log('Testing RPC...');
  const { data, error } = await supabase.rpc('search_relevant_memories', {
    p_user_id: randomUUID(),
    p_query: 'test',
    p_limit: 3
  });
  
  if (error) {
    console.error('RPC Error:', error);
  } else {
    console.log('RPC Success!', data);
  }
}

testRPC().catch(console.error);
