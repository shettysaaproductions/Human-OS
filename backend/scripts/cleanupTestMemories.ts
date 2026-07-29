/**
 * Memory Cleanup & Re-Seeding Script
 * 
 * One-time script to:
 * 1. Delete all test_memory_* entries from the memories table
 * 2. Seed real user facts based on chat history analysis
 * 3. Clear expired working_memory entries
 * 
 * Usage: npx ts-node backend/scripts/cleanupTestMemories.ts
 */

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

// Real user facts extracted from chat history analysis (last 100 messages)
const REAL_MEMORIES = [
  { key: 'marital_status', value: 'Married', memory_type: 'core' },
  { key: 'child', value: 'Has a son who is approximately 5 months old', memory_type: 'core' },
  { key: 'work_schedule', value: 'Office hours approximately 9 AM to 8:30 PM, logs out at 8:30 PM', memory_type: 'core' },
  { key: 'commute', value: 'Commutes via metro', memory_type: 'core' },
  { key: 'location', value: 'Lives in Dahisar area, Mumbai', memory_type: 'core' },
  { key: 'profession', value: 'Software professional, works in an office', memory_type: 'core' },
  { key: 'side_project', value: 'Building HumanOS/Nova - an AI companion app', memory_type: 'core' },
  { key: 'social_life', value: 'Has friends he sometimes meets after work for smoking/hanging out', memory_type: 'episodic' },
  { key: 'language_preference', value: 'Speaks casual Hinglish (mix of Hindi and English), uses Roman script', memory_type: 'core' },
  { key: 'personality_note', value: 'Wants Nova to be like Jarvis - proactive, remembering everything, making meaningful impact on daily life', memory_type: 'core' },
  { key: 'preferred_pronoun', value: 'Prefers casual "Tu/Tum" - hates formal "Aap"', memory_type: 'core' },
  { key: 'work_commute_mode', value: 'Metro from Dahisar to office', memory_type: 'core' },
];

async function main() {
  // Step 1: Find the user ID (we know there's one active user)
  const { data: users, error: userError } = await supabaseAdmin
    .from('chat_history')
    .select('user_id')
    .limit(1)
    .maybeSingle();

  if (userError || !users) {
    console.error('Could not find user:', userError);
    process.exit(1);
  }

  const userId = users.user_id;
  console.log(`Found user: ${userId}`);

  // Step 2: Delete test memories
  console.log('\n--- Deleting test_memory_* entries ---');
  const { data: testMemories, error: fetchError } = await supabaseAdmin
    .from('memories')
    .select('id, key')
    .eq('user_id', userId)
    .like('key', 'test_memory_%');

  if (fetchError) {
    console.error('Error fetching test memories:', fetchError);
  } else if (testMemories && testMemories.length > 0) {
    const ids = testMemories.map(m => m.id);
    const { error: deleteError } = await supabaseAdmin
      .from('memories')
      .delete()
      .in('id', ids);

    if (deleteError) {
      console.error('Error deleting test memories:', deleteError);
    } else {
      console.log(`✅ Deleted ${testMemories.length} test memories`);
    }
  } else {
    console.log('No test memories found to delete.');
  }

  // Step 3: Seed real memories
  console.log('\n--- Seeding real user memories ---');
  for (const mem of REAL_MEMORIES) {
    const { error: upsertError } = await supabaseAdmin
      .from('memories')
      .upsert({
        user_id: userId,
        key: mem.key,
        value: mem.value,
        memory_type: mem.memory_type,
        is_archived: false,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'user_id,key'
      });

    if (upsertError) {
      console.error(`Error seeding memory "${mem.key}":`, upsertError.message);
    } else {
      console.log(`✅ Seeded: ${mem.key} = "${mem.value}"`);
    }
  }

  // Step 4: Clean up expired working memory
  console.log('\n--- Cleaning expired working memory ---');
  const { data: expiredWm, error: wmError } = await supabaseAdmin
    .from('working_memory')
    .delete()
    .eq('user_id', userId)
    .lt('expires_at', new Date().toISOString())
    .select('id');

  if (wmError) {
    console.error('Error cleaning working memory:', wmError);
  } else {
    console.log(`✅ Cleaned ${expiredWm?.length || 0} expired working memory entries`);
  }

  // Step 5: Verify
  console.log('\n--- Verification ---');
  const { data: finalMemories } = await supabaseAdmin
    .from('memories')
    .select('key, value, memory_type')
    .eq('user_id', userId)
    .eq('is_archived', false)
    .order('key');

  console.log(`Total active memories: ${finalMemories?.length || 0}`);
  for (const m of (finalMemories || [])) {
    console.log(`  [${m.memory_type}] ${m.key}: ${m.value}`);
  }

  console.log('\n✅ Memory cleanup and re-seeding complete!');
}

main().catch(console.error);
