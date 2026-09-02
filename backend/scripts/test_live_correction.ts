import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import crypto from 'crypto';
import fetch from 'node-fetch';

dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const API_URL = 'http://localhost:3000/api/chat'; // Assuming local dev server is running
const ADMIN_EMAIL = 'admin@recrutos.com';

async function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runLiveTest() {
  console.log('--- STARTING LIVE CORRECTION TEST ---');
  
  const userId = '80547977-5bdd-4252-a1a1-7e06902d5c8d';
  console.log(`User ID: ${userId}`);

  // Fetch initial unrelated memory count to verify protection
  const { count: initialUnrelatedCount } = await supabase
    .from('memories')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .neq('key', 'favourite_beverage');

  const msg1Id = crypto.randomUUID();
  const msg2Id = crypto.randomUUID();

  console.log(`\n[STEP 1] Sending initial concept: "Remember this: my favourite beverage is chai."`);
  const req1 = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-dev-user-id': userId },
    body: JSON.stringify({
      user_id: userId,
      message: 'Remember this: my favourite beverage is chai.',
      client_message_id: msg1Id,
      timezone: 'Asia/Kolkata',
      device_info: { deviceName: 'LiveTestScript' }
    })
  });
  const res1 = await req1.json();
  console.log(`Reply: ${res1.reply}`);

  console.log('Waiting 3 seconds for workers...');
  await delay(3000);

  // Check state after initial injection
  let { data: afterMem1 } = await supabase
    .from('memories')
    .select('*')
    .eq('user_id', userId)
    .eq('key', 'favourite_beverage');
  console.log(`Memories after Step 1:`, afterMem1);

  console.log(`\n[STEP 2] Sending correction: "Ek correction hai mera favourite beverage coffee hai."`);
  const req2 = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-dev-user-id': userId },
    body: JSON.stringify({
      user_id: userId,
      message: 'Ek correction hai mera favourite beverage coffee hai.',
      client_message_id: msg2Id,
      timezone: 'Asia/Kolkata',
      device_info: { deviceName: 'LiveTestScript' }
    })
  });
  const res2 = await req2.json();
  console.log(`Reply: ${res2.reply}`);

  console.log('Waiting 5 seconds for workers to process correction...');
  await delay(5000);

  // Fetch final state
  const { data: finalMemories } = await supabase
    .from('memories')
    .select('*')
    .eq('user_id', userId)
    .eq('key', 'favourite_beverage');

  console.log('\n--- VERIFICATION RESULTS ---');
  if (!finalMemories || finalMemories.length === 0) {
    console.error('FAIL: No memories found for favourite_beverage');
    return;
  }

  const currentMemories = finalMemories.filter(m => m.lifecycle_state === 'CURRENT');
  const supersededMemories = finalMemories.filter(m => m.lifecycle_state === 'SUPERSEDED');

  console.log(`Total memories for key: ${finalMemories.length}`);
  console.log(`CURRENT: ${currentMemories.length}, SUPERSEDED: ${supersededMemories.length}`);

  if (currentMemories.length !== 1) {
    console.log(`FAIL: Expected exactly 1 CURRENT memory, found ${currentMemories.length}`);
  } else {
    const current = currentMemories[0];
    console.log(`CANONICAL_KEY = ${current.key}`);
    console.log(`NEW VALUE = ${current.value}`);
    console.log(`AUTHORITY = ${current.source_authority}`);
    console.log(`SOURCE_MESSAGE_ID = ${current.source_message_id}`);
    console.log(`SOURCE_REFERENCES = ${JSON.stringify(current.source_references)}`);
  }

  if (supersededMemories.length === 1) {
    console.log(`OLD VALUE SUPERSEDED = ${supersededMemories[0].value}`);
  } else {
    console.log(`FAIL: Expected 1 SUPERSEDED memory, found ${supersededMemories.length}`);
  }

  const { count: finalUnrelatedCount } = await supabase
    .from('memories')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .neq('key', 'favourite_beverage');

  console.log(`UNRELATED_MUTATIONS = ${finalUnrelatedCount! - initialUnrelatedCount!} expected 0`);

  // Watchtower check
  const { data: watchtowerLogs } = await supabase
    .from('watchtower_signals')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(5);

  console.log(`\nRecent Watchtower Signals:`, watchtowerLogs?.map(w => w.signal_type) || 'None');
}

runLiveTest().catch(console.error);
