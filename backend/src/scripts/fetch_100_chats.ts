/**
 * fetch_100_chats.ts
 * Fetches the last 100 messages from ALL roles for deep behavioral analysis.
 * Also detects key patterns: internet requests, vision requests, confusion signals.
 */

import { supabaseAdmin as supabase } from '../lib/supabase';

async function fetchDeepTelemetry() {
  try {
    console.log('📡 Connecting to Supabase...\n');

    // 1. Get most recent active user
    const { data: lastMsg } = await supabase
      .from('chat_history')
      .select('user_id')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!lastMsg) {
      console.log('❌ No messages found.');
      return;
    }
    const userId = lastMsg.user_id;

    const { data: profile } = await supabase
      .from('profiles')
      .select('preferred_name, push_token')
      .eq('id', userId)
      .maybeSingle();

    console.log(`=== USER ===`);
    console.log(`👤 Name: ${profile?.preferred_name || 'Unknown'} (${userId.substring(0, 8)}...)`);
    console.log(`📱 Push Token: ${profile?.push_token ? profile.push_token.substring(0, 40) + '...' : '❌ MISSING — Push notifications WILL fail'}\n`);

    // 2. Fetch 100 messages
    const { data: messages, error } = await supabase
      .from('chat_history')
      .select('role, content, created_at, conversation_id')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) throw error;
    if (!messages || messages.length === 0) {
      console.log('No messages found.');
      return;
    }

    // Print chronologically
    const sorted = [...messages].reverse();
    console.log(`=== LAST ${sorted.length} MESSAGES ===\n`);

    // Pattern trackers
    let internetRequests: string[] = [];
    let visionRequests: string[] = [];
    let confusionSignals: string[] = [];
    let maxNovaStreak = 0;
    let currentStreak = 0;

    sorted.forEach((msg) => {
      const time = new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const isNova = msg.role === 'assistant';
      const sender = isNova ? '[Nova]' : '[User]';
      const color = isNova ? '\x1b[35m' : '\x1b[36m';
      const reset = '\x1b[0m';
      const short = msg.content.length > 120 ? msg.content.substring(0, 120) + '...' : msg.content;
      console.log(`${color}${time} ${sender}: ${short}${reset}`);

      // Track Nova streaks (consecutive Nova messages with no user reply)
      if (isNova) {
        currentStreak++;
        maxNovaStreak = Math.max(maxNovaStreak, currentStreak);
      } else {
        currentStreak = 0;
      }

      // Detect internet/search requests
      const lower = msg.content.toLowerCase();
      if (!isNova && (lower.includes('search') || lower.includes('google') || lower.includes('internet') || 
          lower.includes('news') || lower.includes('weather') || lower.includes('look up') || 
          lower.includes('find out') || lower.includes('latest') || lower.includes('current') ||
          lower.includes('what is') || lower.includes('tell me about'))) {
        internetRequests.push(`  [${time}] User: ${msg.content.substring(0, 80)}`);
      }

      // Detect vision requests
      if (!isNova && (lower.includes('look') || lower.includes('see') || lower.includes('camera') || 
          lower.includes('photo') || lower.includes('picture') || lower.includes('selfie') ||
          lower.includes('check this') || lower.includes('dekh'))) {
        visionRequests.push(`  [${time}] User: ${msg.content.substring(0, 80)}`);
      }

      // Nova confusion/failure signals
      if (isNova && (lower.includes("i don't know") || lower.includes("i can't") || 
          lower.includes("sorry") || lower.includes("i'm not sure") || lower.includes("as an ai") ||
          lower.includes("mujhe nahi pata") || lower.includes("samajh nahi") ||
          lower.includes("access nahi") || lower.includes("pata nahi"))) {
        confusionSignals.push(`  [${time}] Nova: ${msg.content.substring(0, 80)}`);
      }
    });

    // 3. Analysis Summary
    console.log('\n\n=== BEHAVIORAL ANALYSIS ===');
    console.log(`📊 Total messages analyzed: ${sorted.length}`);
    console.log(`🔥 Max consecutive Nova messages without user reply: ${maxNovaStreak}`);
    
    if (internetRequests.length > 0) {
      console.log(`\n🌐 INTERNET/SEARCH REQUESTS DETECTED (${internetRequests.length}):`);
      internetRequests.forEach(r => console.log(r));
    } else {
      console.log('\n🌐 No clear internet search requests detected in this window.');
    }

    if (visionRequests.length > 0) {
      console.log(`\n👁️ VISION/CAMERA REQUESTS DETECTED (${visionRequests.length}):`);
      visionRequests.forEach(r => console.log(r));
    } else {
      console.log('\n👁️ No vision requests detected in this window.');
    }

    if (confusionSignals.length > 0) {
      console.log(`\n⚠️ NOVA CONFUSION/FAILURE SIGNALS (${confusionSignals.length}):`);
      confusionSignals.forEach(r => console.log(r));
    } else {
      console.log('\n✅ No confusion signals detected in this window.');
    }

    // 4. Working memory check
    const { data: wm } = await supabase
      .from('working_memory')
      .select('key, value, expires_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(10);

    if (wm && wm.length > 0) {
      console.log(`\n=== WORKING MEMORY (last 10 keys) ===`);
      wm.forEach(w => {
        const expired = w.expires_at && new Date(w.expires_at) < new Date() ? ' [EXPIRED]' : '';
        console.log(`  ${w.key}: ${String(w.value).substring(0, 80)}${expired}`);
      });
    }

    console.log('\n✅ Deep telemetry fetch complete.\n');
  } catch (err) {
    console.error('❌ Error:', err);
  }
}

fetchDeepTelemetry();
