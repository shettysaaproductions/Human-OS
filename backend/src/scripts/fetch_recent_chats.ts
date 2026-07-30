/**
 * fetch_recent_chats.ts
 *
 * Auto Upgrade telemetry script. Pulls the last 20 Nova messages from Supabase
 * and prints them in a readable format for behavioral analysis.
 * Also prints the user's current push token for debugging notification issues.
 *
 * Usage:
 *   cd backend && npx tsx src/scripts/fetch_recent_chats.ts
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load .env from backend root
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  console.log('\n══════════════════════════════════════════════════════');
  console.log('  Nova Auto Upgrade — Chat Telemetry Pull');
  console.log('══════════════════════════════════════════════════════\n');

  // ── 1. Get all active user IDs (last 7 days) ────────────────────────────────
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data: activeUsers, error: usersErr } = await supabase
    .from('chat_history')
    .select('user_id')
    .eq('role', 'user')
    .gte('created_at', sevenDaysAgo);

  if (usersErr || !activeUsers) {
    console.error('❌ Failed to fetch active users:', usersErr?.message);
    process.exit(1);
  }

  const uniqueUserIds = [...new Set(activeUsers.map(u => u.user_id))];
  console.log(`📊 Active users in last 7 days: ${uniqueUserIds.length}`);

  for (const userId of uniqueUserIds) {
    console.log('\n──────────────────────────────────────────────────────');

    // ── 2. Get profile info ────────────────────────────────────────────────────
    const { data: profile } = await supabase
      .from('profiles')
      .select('preferred_name, push_token, push_token_updated_at, timezone_offset')
      .eq('id', userId)
      .maybeSingle();

    const name = profile?.preferred_name ?? 'Unknown';
    const pushToken = profile?.push_token;
    const tokenUpdated = profile?.push_token_updated_at;

    console.log(`👤 User: ${name} (${userId.substring(0, 8)}...)`);

    if (pushToken) {
      console.log(`📱 Push Token: ${pushToken.substring(0, 40)}...`);
      console.log(`   Last Updated: ${tokenUpdated ? new Date(tokenUpdated).toLocaleString() : 'unknown'}`);
      const isStale = tokenUpdated
        ? (Date.now() - new Date(tokenUpdated).getTime()) > 30 * 24 * 60 * 60 * 1000
        : false;
      if (isStale) {
        console.log('   ⚠️  WARNING: Token not updated in 30+ days — may be stale!');
      } else {
        console.log('   ✅ Token appears fresh');
      }
    } else {
      console.log('📱 Push Token: ❌ MISSING — notifications will NOT work!');
    }

    // ── 3. Get last 20 messages ────────────────────────────────────────────────
    const { data: messages, error: msgErr } = await supabase
      .from('chat_history')
      .select('role, content, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(20);

    if (msgErr || !messages) {
      console.log('❌ Failed to fetch messages:', msgErr?.message);
      continue;
    }

    console.log(`\n💬 Last ${messages.length} messages:\n`);
    const reversed = [...messages].reverse();
    for (const msg of reversed) {
      const role = msg.role === 'user' ? '👤 User' : '🤖 Nova';
      const time = new Date(msg.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
      const content = msg.content.length > 200 ? msg.content.substring(0, 197) + '...' : msg.content;
      console.log(`[${time}] ${role}:`);
      console.log(`  ${content}\n`);
    }

    // ── 4. Behavioral analysis hints ──────────────────────────────────────────
    const novaMessages = reversed.filter(m => m.role === 'assistant');

    console.log('🔍 Quick Behavioral Scan:');

    // Check for echoing
    let echoCount = 0;
    for (let i = 1; i < reversed.length; i++) {
      const prev = reversed[i - 1];
      const curr = reversed[i];
      if (prev.role === 'user' && curr.role === 'assistant') {
        const userWords = prev.content.toLowerCase().split(/\s+/);
        const novaWords = curr.content.toLowerCase().split(/\s+/);
        const sharedWords = userWords.filter((w: string) => w.length > 3 && novaWords.includes(w));
        if (sharedWords.length / userWords.length > 0.5) echoCount++;
      }
    }
    console.log(`  Echoing instances: ${echoCount} ${echoCount > 0 ? '⚠️' : '✅'}`);

    // Check for "Aap" formality
    const aapCount = novaMessages.filter(m => /\baap\b|\baapka\b|\baapko\b/i.test(m.content)).length;
    console.log(`  Formality (Aap) instances: ${aapCount} ${aapCount > 0 ? '🚨 ZERO TOLERANCE VIOLATION' : '✅'}`);

    // Check for question spam
    const questionEndCount = novaMessages.filter(m => m.content.trim().endsWith('?')).length;
    const questionRatio = novaMessages.length > 0 ? (questionEndCount / novaMessages.length) : 0;
    console.log(`  Question endings: ${questionEndCount}/${novaMessages.length} (${Math.round(questionRatio * 100)}%) ${questionRatio > 0.5 ? '⚠️ Too many questions' : '✅'}`);

    // Check for NACE outreach
    const { data: outreachLog } = await supabase
      .from('nova_outreach_log')
      .select('created_at, message, outreach_type')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(5);

    if (outreachLog && outreachLog.length > 0) {
      console.log(`\n📡 Last NACE Outreach (${outreachLog.length} entries):`);
      for (const log of outreachLog) {
        const time = new Date(log.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
        console.log(`  [${time}] (${log.outreach_type}): ${log.message.substring(0, 100)}`);
      }
    } else {
      console.log('\n📡 NACE Outreach: No entries found in log');
    }
  }

  console.log('\n══════════════════════════════════════════════════════');
  console.log('  Telemetry pull complete');
  console.log('══════════════════════════════════════════════════════\n');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
