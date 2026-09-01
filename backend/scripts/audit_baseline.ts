import { supabaseAdmin } from '../src/lib/supabase';
import { AccountLifecycleService } from '../src/services/AccountLifecycleService';
import { logger } from '../src/lib/logger';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const TARGET_EMAIL = 'admin@recrutos.com';

async function runAudit() {
  logger.info(`Starting Post-Onboarding Baseline Audit for ${TARGET_EMAIL}`);

  // 1. Identify Account
  const { data: users, error: userErr } = await supabaseAdmin.auth.admin.listUsers();
  if (userErr) throw userErr;

  const authUsers = users.users.filter(u => u.email === TARGET_EMAIL);
  if (authUsers.length === 0) {
    logger.error('Target user not found.');
    process.exit(1);
  }

  const targetUser = authUsers[0];
  const userId = targetUser.id;
  logger.info(`Resolved Target User: ${userId}`);

  const { data: profile } = await supabaseAdmin.from('profiles').select('*').eq('id', userId).single();
  const { data: presence } = await supabaseAdmin.from('user_presence').select('*').eq('user_id', userId).single();

  console.log('--- USER INFO ---');
  console.log(`USER_ID: ${userId}`);
  console.log(`EMAIL: ${targetUser.email}`);
  console.log(`PROFILE_ID: ${profile?.id}`);
  console.log(`ONBOARDING_COMPLETED: ${profile?.onboarding_completed}`);
  console.log(`CREATED_AT: ${targetUser.created_at}`);
  console.log(`LAST_SIGN_IN: ${targetUser.last_sign_in_at}`);
  console.log(`AUTH_USERS_FOR_EMAIL: ${authUsers.length}`);
  console.log(`PROFILE_TIMEZONE: ${profile?.timezone}`);
  console.log(`PRESENCE_TIMEZONE: ${presence?.timezone}`);
  console.log(`PRESENCE_LAST_UPDATED: ${presence?.updated_at}`);

  // 2. Post-Onboarding Baseline Counts
  const counts: Record<string, number> = {};
  for (const mapping of AccountLifecycleService.USER_OWNED_TABLES) {
    const { count } = await supabaseAdmin.from(mapping.table).select('*', { count: 'exact', head: true }).eq(mapping.userColumn, userId);
    counts[mapping.table] = count || 0;
  }
  
  console.log('\n--- COUNTS ---');
  for (const [table, count] of Object.entries(counts)) {
    console.log(`${table}: ${count}`);
  }

  // 3. Onboarding Data
  console.log('\n--- MEMORIES ---');
  const { data: memories } = await supabaseAdmin.from('memories').select('*').eq('user_id', userId);
  const { data: workingMemory } = await supabaseAdmin.from('working_memory').select('*').eq('user_id', userId);
  
  console.log('memories:', JSON.stringify(memories, null, 2));
  console.log('working_memory:', JSON.stringify(workingMemory, null, 2));

  // Chat Baseline
  console.log('\n--- CHAT ---');
  const { data: chatHistory } = await supabaseAdmin.from('chat_history').select('*').eq('user_id', userId);
  console.log('chat_history:', JSON.stringify(chatHistory, null, 2));
}

runAudit().catch(err => {
  logger.error('Audit script failed', err);
  process.exit(1);
});
