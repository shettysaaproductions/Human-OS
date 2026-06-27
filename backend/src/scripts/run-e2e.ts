import { supabaseAdmin } from '../lib/supabase';
import { memoryQueue } from '../services/QueueService';
import { startWorkers } from '../workers/queueWorker';
import { logger } from '../lib/logger';
import crypto from 'crypto';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function runTest() {
  logger.info('Starting E2E Test...');
  
  // 1. Get a test user
  let user: { id: string } | null = null;
  const { data: profiles, error } = await supabaseAdmin.from('profiles').select('id').limit(1);
  
  if (error || !profiles || profiles.length === 0) {
    logger.info('No profiles found, creating a dummy user for testing...');
    const dummyId = crypto.randomUUID();
    // We bypass auth for tests and just inject a profile
    await supabaseAdmin.from('profiles').insert({ id: dummyId, preferred_name: 'TestUser', companion_personality: 'friendly' });
    user = { id: dummyId };
  } else {
    user = profiles[0];
  }
  
  const userId = user.id;
  const message = 'My son Shreshth is 5 months old and my wife Sakshi loves coffee.';
  const conversationId = crypto.randomUUID();

  logger.info(`Running test for user ${userId} with message: "${message}"`);

  // Start background queue workers in this process
  startWorkers();

  // 2. Simulate Chat Endpoint (POST /chat)
  const startTime = Date.now();
  
  // Save user message
  const { data: userMsgRecord } = await supabaseAdmin
    .from('chat_history')
    .insert({ user_id: userId, conversation_id: conversationId, role: 'user', content: message })
    .select('id')
    .single();
    
  const userMessageId = userMsgRecord?.id || 'msg_' + Date.now();
  
  // Enqueue jobs
  const payload = { userId, messageId: userMessageId, message };
  
  logger.info('Enqueueing extraction jobs...');
  await Promise.all([
    memoryQueue.add('extract_semantic', payload),
    memoryQueue.add('extract_working_memory', payload),
    memoryQueue.add('extract_episodic', payload),
    memoryQueue.add('extract_kg', payload),
    memoryQueue.add('extract_emotional', payload)
  ]);

  const latency = Date.now() - startTime;
  logger.info(`Chat endpoint latency: ${latency}ms`);

  // 3. Wait for Queue to process
  logger.info('Waiting 10 seconds for agents to process jobs...');
  await sleep(10000);

  // 4. Verify Diagnostics
  const { count: pendingCount } = await supabaseAdmin.from('background_jobs').select('*', { count: 'exact', head: true }).eq('status', 'pending');
  const { count: processedCount } = await supabaseAdmin.from('processed_jobs').select('*', { count: 'exact', head: true }).eq('message_id', userMessageId);
  const { count: failedCount } = await supabaseAdmin.from('failed_jobs').select('*', { count: 'exact', head: true });
  
  const { data: kgNodes } = await supabaseAdmin.from('kg_nodes').select('name').eq('user_id', userId);
  const { data: semantic } = await supabaseAdmin.from('memories').select('key, value').eq('user_id', userId);
  
  logger.info('--- TEST RESULTS ---');
  logger.info(`Processed Jobs for this message: ${processedCount} (Expected: 5)`);
  logger.info(`Pending Jobs overall: ${pendingCount}`);
  logger.info(`Failed Jobs overall: ${failedCount}`);
  logger.info(`KG Nodes Extracted: ${kgNodes?.map(n => n.name).join(', ')}`);
  logger.info(`Semantic Memories Extracted: ${semantic?.map(m => m.key).join(', ')}`);
  
  process.exit(0);
}

runTest();
