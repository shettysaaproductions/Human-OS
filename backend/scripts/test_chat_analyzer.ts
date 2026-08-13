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

async function analyzeTestChat() {
  console.log('Fetching chat history to find the most recent session...');
  
  // Fetch a large enough chunk to definitely find the last "hi"
  const { data, error } = await supabaseAdmin
    .from('chat_history')
    .select('role, content, created_at, meta')
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) {
    console.error('Error fetching chats:', error);
    process.exit(1);
  }

  if (!data || data.length === 0) {
    console.log('No chat history found.');
    return;
  }

  // Find the index of the most recent user message containing "hi" or "hey" or "hello"
  let startIndex = data.length - 1; // Default to oldest if not found
  for (let i = 0; i < data.length; i++) {
    const msg = data[i];
    if (msg.role === 'user') {
      const lowerContent = msg.content.trim().toLowerCase();
      // Match exact "hi" or "hey" or "hello" as standalone words, or starting words
      if (/^(hi|hey|hello)\b/i.test(lowerContent)) {
        startIndex = i;
        break; // Found the most recent "hi" (since array is ordered DESC)
      }
    }
  }

  // Slice from the "hi" to the present (index 0)
  const sessionChats = data.slice(0, startIndex + 1);

  // Reverse to chronological order (oldest to newest)
  const chronologicalChats = sessionChats.reverse();

  console.log(`\n=================================================================`);
  console.log(`🔍 TEST CHAT ANALYSIS — FOUND ${chronologicalChats.length} MESSAGES IN RECENT SESSION`);
  console.log(`=================================================================\n`);

  for (const msg of chronologicalChats) {
    const time = new Date(msg.created_at).toLocaleTimeString();
    console.log(`[${time}] ${msg.role.toUpperCase()}:`);
    
    // Formatting raw text to clearly show newlines and whitespace issues
    const formattedContent = msg.content.replace(/\n/g, '\n  ');
    console.log(`  "${formattedContent}"`);
    
    if (msg.meta) {
      console.log(`\n  --- ⚙️ METADATA & SUBCONSCIOUS ACTIONS ---`);
      if (msg.meta.situationBrief) {
        // Just print a summarized version of the situation brief so it doesn't flood the logs
        const briefHasOffline = msg.meta.situationBrief.includes('OFFLINE');
        const briefHasNotSeen = msg.meta.situationBrief.includes('NOT SEEN');
        console.log(`  Situation Flags: ${briefHasOffline ? '[USER OFFLINE]' : ''} ${briefHasNotSeen ? '[MESSAGE UNREAD]' : ''}`);
      }
      
      if (msg.meta.subconsciousActions && msg.meta.subconsciousActions.length > 0) {
        console.log(`  Actions Emitted:`);
        for (const action of msg.meta.subconsciousActions) {
          console.log(`    - Tool: [${action.tool}] -> ${action.action}`);
          console.log(`      Data: ${JSON.stringify(action.data)}`);
        }
      } else if (msg.role === 'assistant') {
        console.log(`  Actions Emitted: None`);
      }
      console.log(`  ------------------------------------------`);
    }
    console.log(`\n`);
  }
  
  console.log(`=================================================================`);
  console.log(`✅ END OF SESSION LOG`);
  console.log(`=================================================================\n`);
}

analyzeTestChat();
