import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

  // Find the OLDEST user message containing "hi" / "hey" / "hello" by scanning
  // from the END (oldest) toward the front (newest). Scanning from the front (newest)
  // wrongly truncates a session that has a mid-session "hi" — real content between
  // the oldest and the most-recent "hi" gets dropped (see 2026-08-14 test chat).
  let startIndex = data.length - 1; // Default to newest if nothing found
  for (let i = data.length - 1; i >= 0; i--) {
    const msg = data[i];
    if (msg.role === 'user') {
      const lowerContent = msg.content.trim().toLowerCase();
      // Match exact "hi" / "hey" / "hello" as standalone words, or starting words
      if (/^(hi|hey|hello)\b/i.test(lowerContent)) {
        startIndex = i;
        break; // Found the OLDEST "hi" (since we scan from the end)
      }
    }
  }

  // Slice from the OLDEST "hi" to the present (index 0)
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
        
        let behaviorPatternMatch = msg.meta.situationBrief.match(/BEHAVIOR PATTERN: (.*?)(?=\n|$)/);
        let behaviorPattern = behaviorPatternMatch ? behaviorPatternMatch[1] : null;

        console.log(`  Situation Flags: ${briefHasOffline ? '[USER OFFLINE]' : ''} ${briefHasNotSeen ? '[MESSAGE UNREAD]' : ''}`);
        if (behaviorPattern) {
          console.log(`  📊 Behavior Pattern: ${behaviorPattern}`);
        }
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
