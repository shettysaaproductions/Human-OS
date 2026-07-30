/**
 * fetch_recent_chats.ts
 *
 * Auto Upgrade telemetry script. Pulls the last 20 Nova messages from Supabase
 * and prints them in a readable format for behavioral analysis.
 */

import { supabase } from '../lib/supabase';
import readline from 'readline';

async function promptUser(): Promise<string | null> {
  // If a specific user ID is provided via command line args, use it
  if (process.argv[2]) return process.argv[2];

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise(resolve => {
    rl.question('Enter user ID (or press Enter for most recently active user): ', (answer) => {
      rl.close();
      resolve(answer.trim() || null);
    });
  });
}

async function getTargetUserId(providedId: string | null): Promise<string> {
  if (providedId) return providedId;

  // Find the user who sent the most recent message
  const { data, error } = await supabase
    .from('messages')
    .select('user_id')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (error || !data) {
    throw new Error('Could not find any recent users. Database might be empty or connection failed.');
  }

  return data.user_id;
}

async function fetchTelemetry() {
  try {
    console.log('📡 Connecting to Supabase...');
    
    // 1. Determine which user to analyze
    const inputId = await promptUser();
    const userId = await getTargetUserId(inputId);

    // 2. Get profile info
    const { data: profile } = await supabase
      .from('profiles')
      .select('preferred_name, push_token, timezone_offset')
      .eq('id', userId)
      .maybeSingle();

    const name = profile?.preferred_name || 'Unknown User';
    const pushToken = profile?.push_token;
    
    console.log(`\n=== PUSH TOKEN STATUS ===`);
    console.log(`👤 User: ${name} (${userId.substring(0, 8)}...)`);
    
    if (pushToken) {
      console.log(`📱 Push Token: ${pushToken.substring(0, 40)}...`);
    } else {
      console.log('❌ No Push Token registered! Push notifications will fail.');
    }

    // 3. Fetch recent messages
    console.log('\n=== RECENT MESSAGES ===');
    const { data: messages, error } = await supabase
      .from('messages')
      .select('role, content, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(20);

    if (error) throw error;

    if (!messages || messages.length === 0) {
      console.log('No recent messages found for this user.');
      return;
    }

    // Print chronologically (oldest first)
    messages.reverse().forEach(msg => {
      const time = new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const sender = msg.role === 'user' ? `[${name}]` : '[Nova]';
      const color = msg.role === 'nova' ? '\x1b[35m' : '\x1b[36m'; // Magenta for Nova, Cyan for User
      const reset = '\x1b[0m';
      
      console.log(`${color}${time} ${sender}: ${msg.content}${reset}`);
    });

    console.log('\n✅ Telemetry fetch complete.\n');

  } catch (error) {
    console.error('❌ Failed to fetch telemetry:', error);
  }
}

fetchTelemetry();
