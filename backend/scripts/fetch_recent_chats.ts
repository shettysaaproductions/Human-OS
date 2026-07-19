import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase credentials in .env');
  process.exit(1);
}

const supabaseAdmin = createClient(supabaseUrl, supabaseKey);

async function fetchChats() {
  console.log('Fetching latest 20 chat messages...');
  
  const { data, error } = await supabaseAdmin
    .from('chat_history')
    .select('role, content, created_at, meta')
    .order('created_at', { ascending: false })
    .limit(20);

  if (error) {
    console.error('Error fetching chats:', error);
    process.exit(1);
  }

  // Reverse so it reads chronologically
  const sorted = data.reverse();

  for (const msg of sorted) {
    console.log(`\n[${new Date(msg.created_at).toLocaleTimeString()}] ${msg.role.toUpperCase()}:`);
    console.log(`Content: ${msg.content.trim()}`);
    if (msg.role === 'assistant' && msg.meta) {
      console.log(`\n--- TELEMETRY META ---`);
      if (msg.meta.situationBrief) {
        console.log(`Situation: ${msg.meta.situationBrief.split('\n').filter((l: string) => l.startsWith('- ')).join(' | ')}`);
      }
      if (msg.meta.subconsciousActions && msg.meta.subconsciousActions.length > 0) {
        console.log(`Actions: ${JSON.stringify(msg.meta.subconsciousActions)}`);
      }
      console.log(`----------------------`);
    }
  }
}

fetchChats();
