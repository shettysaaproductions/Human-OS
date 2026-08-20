
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

async function clearData() {
  console.log('Clearing user data...');
  const tables = ['chat_history', 'memories', 'working_memory', 'nova_thoughts', 'reminders', 'agenda', 'user_presence_history'];
  
  // We can't just TRUNCATE easily over REST API without a Postgres function, 
  // so we'll delete all rows where id is not null (which is all of them).
  for (const table of tables) {
    const { error } = await supabase.from(table).delete().neq('id', '00000000-0000-0000-0000-000000000000');
    if (error) {
      console.error('Error clearing ' + table + ':', error.message);
    } else {
      console.log('Cleared ' + table);
    }
  }
  console.log('Done!');
}

clearData().catch(console.error);
