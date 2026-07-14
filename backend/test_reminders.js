const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

(async () => {
  const { data: reminders } = await supabase
    .from('reminders')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(5);
  console.log('--- LATEST REMINDERS ---');
  console.dir(reminders, { depth: null });

  const { data: chat } = await supabase
    .from('chat_history')
    .select('role, content, created_at')
    .order('created_at', { ascending: false })
    .limit(5);
  console.log('\n--- LATEST CHAT HISTORY ---');
  console.dir(chat, { depth: null });
})();
