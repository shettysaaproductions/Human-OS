import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function run() {
  const { data } = await supabase
    .from('chat_history')
    .select('role, content, created_at, meta')
    .order('created_at', { ascending: false })
    .limit(40);
    
  if (data) {
    const reversed = data.reverse();
    for (const d of reversed) {
      console.log(`[${new Date(d.created_at).toLocaleTimeString()}] ${d.role.toUpperCase()}: ${d.content}`);
      if (d.meta) {
        console.log(`META: ${JSON.stringify(d.meta)}`);
      }
    }
  }
}

run();
