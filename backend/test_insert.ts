import { supabaseAdmin } from './src/lib/supabase';
async function test() {
  const res = await supabaseAdmin.from('chat_history').insert({
    user_id: '2289911c-f7c4-43c7-9609-1d121c3a0503',
    conversation_id: '7266a37d-7a32-42e8-a798-3ae8d6f87161',
    role: 'assistant',
    content: 'Test from backend',
    status: 'sent'
  });
  console.log('Insert Result:', JSON.stringify(res, null, 2));
}
test();
