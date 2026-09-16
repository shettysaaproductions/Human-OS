import 'dotenv/config';
import { supabaseAdmin } from '../lib/supabase';

async function checkProductionDatabase() {
  console.log('====================================================');
  console.log('🔍 PRODUCTION SUPABASE DATABASE MIGRATION VERIFICATION');
  console.log('====================================================\n');

  // 1. Check memory_bubbles table
  console.log('[1] Checking `memory_bubbles` table...');
  const { data: bubbles, error: bubbleError } = await supabaseAdmin
    .from('memory_bubbles')
    .select('id, label, slug, bubble_type, domain_key, parent_bubble_id')
    .limit(5);

  if (bubbleError) {
    console.error('❌ Table `memory_bubbles` missing or inaccessible:', bubbleError.message);
  } else {
    console.log(`✓ Table \`memory_bubbles\` EXISTS (${bubbles?.length || 0} sample rows retrieved)`);
  }

  // 2. Check memory_bubble_moves table
  console.log('\n[2] Checking `memory_bubble_moves` table...');
  const { data: moves, error: movesError } = await supabaseAdmin
    .from('memory_bubble_moves')
    .select('id, bubble_id, entity_name, source_domain, target_domain')
    .limit(5);

  if (movesError) {
    console.error('❌ Table `memory_bubble_moves` missing or inaccessible:', movesError.message);
  } else {
    console.log(`✓ Table \`memory_bubble_moves\` EXISTS (${moves?.length || 0} sample rows retrieved)`);
  }

  // 3. Check memory_events table
  console.log('\n[3] Checking `memory_events` table...');
  const { data: events, error: eventsError } = await supabaseAdmin
    .from('memory_events')
    .select('id, memory_id, action')
    .limit(5);

  if (eventsError) {
    console.error('❌ Table `memory_events` missing or inaccessible:', eventsError.message);
  } else {
    console.log(`✓ Table \`memory_events\` EXISTS (${events?.length || 0} sample rows retrieved)`);
  }

  // 4. Check column `bubble_id` on `memories` table
  console.log('\n[4] Checking `bubble_id` column on `memories` table...');
  const { data: memSample, error: memError } = await supabaseAdmin
    .from('memories')
    .select('id, key, bubble_id')
    .limit(5);

  if (memError) {
    console.error('❌ Column `bubble_id` on `memories` error:', memError.message);
  } else {
    console.log(`✓ Column \`bubble_id\` on \`memories\` EXISTS (${memSample?.length || 0} sample rows checked)`);
  }

  // 5. Check column `bubble_id` on `reminders` table
  console.log('\n[5] Checking `bubble_id` column on `reminders` table...');
  const { data: remSample, error: remError } = await supabaseAdmin
    .from('reminders')
    .select('id, text, bubble_id')
    .limit(5);

  if (remError) {
    console.error('❌ Column `bubble_id` on `reminders` error:', remError.message);
  } else {
    console.log(`✓ Column \`bubble_id\` on \`reminders\` EXISTS (${remSample?.length || 0} sample rows checked)`);
  }

  // 6. Test move_memory_branch_atomic_v3 RPC existence via dry call
  console.log('\n[6] Testing RPC function `move_memory_branch_atomic_v3`...');
  try {
    const { data: rpcRes, error: rpcError } = await supabaseAdmin.rpc('move_memory_branch_atomic_v3', {
      p_user_id: '00000000-0000-0000-0000-000000000000',
      p_memory_ids: [],
      p_reminder_ids: [],
      p_entity_name: '',
      p_source_domain: 'family',
      p_target_domain: 'work',
      p_old_relation: null,
      p_new_relation: null,
    });
    if (rpcError) {
      if (rpcError.message.includes('INVALID_BRANCH_MOVE_INPUT')) {
        console.log('✓ RPC `move_memory_branch_atomic_v3` EXISTS and active! (Input validation guard caught test call correctly)');
      } else {
        console.error('❌ RPC `move_memory_branch_atomic_v3` error:', rpcError.message);
      }
    } else {
      console.log('✓ RPC `move_memory_branch_atomic_v3` returned:', rpcRes);
    }
  } catch (err: any) {
    console.error('❌ RPC test failed:', err.message);
  }

  console.log('\n====================================================');
}

checkProductionDatabase().catch(console.error);
