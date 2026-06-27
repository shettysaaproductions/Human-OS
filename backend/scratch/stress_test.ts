import '../src/config';
import { supabaseAdmin } from '../src/lib/supabase';
import { memoryRepository } from '../src/services/memoryRepository';
import { qt } from '../src/lib/queryTracker';
import crypto from 'crypto';

async function runStressTest() {
  console.log('Starting stress test (1000 simulated DB interactions for chat)...');
  
  // Create a mock user
  const userId = crypto.randomUUID();
  const convId = crypto.randomUUID();
  
  // Create user profile
  await supabaseAdmin.from('profiles').insert({
    id: userId,
    preferred_name: 'Stress Tester',
    companion_personality: 'Helpful',
    email: 'stress@test.local'
  });

  // Seed 50 memories for this user to ensure searchMemories has data to rank
  const mockMemories = Array.from({ length: 50 }).map((_, i) => ({
    user_id: userId,
    key: `test_memory_${i}`,
    value: `This is a test memory regarding something important ${i}`,
    importance: Math.floor(Math.random() * 100),
    confidence: 0.9,
    memory_type: 'core'
  }));
  await supabaseAdmin.from('memories').insert(mockMemories);

  let totalLatency = 0;
  const start = Date.now();

  for (let i = 0; i < 1000; i++) {
    const iterStart = Date.now();
    
    // 1. Simulate saving user message
    await qt.track('save_user_message', 'chat_history', () =>
      supabaseAdmin.from('chat_history').insert({
        user_id: userId,
        conversation_id: convId,
        role: 'user',
        content: `Simulated message ${i}`
      })
    );

    // 2. Simulate fetching recent chat history
    await qt.track('get_chat_history', 'chat_history', () =>
      supabaseAdmin.from('chat_history')
        .select('role, content')
        .eq('user_id', userId)
        .eq('conversation_id', convId)
        .order('created_at', { ascending: false })
        .limit(20)
    );

    // 3. Simulate memory retrieval (THE CORE RPC TEST)
    const keywords = ['test', 'memory', 'important'];
    await memoryRepository.searchMemories(userId, keywords);

    // 4. Simulate saving AI response
    await qt.track('save_ai_response', 'chat_history', () =>
      supabaseAdmin.from('chat_history').insert({
        user_id: userId,
        conversation_id: convId,
        role: 'assistant',
        content: `Simulated AI response ${i}`
      })
    );

    totalLatency += (Date.now() - iterStart);
    
    if ((i + 1) % 100 === 0) {
      console.log(`Processed ${i + 1}/1000 messages...`);
    }
  }

  // Allow queryTracker to flush
  await qt.flush();

  const totalTime = Date.now() - start;
  const avgLatency = totalLatency / 1000;
  
  // Calculate specific RPC average latency
  const { data: metrics } = await supabaseAdmin
    .from('query_metrics')
    .select('duration_ms')
    .eq('query_name', 'search_memories_rpc')
    .order('created_at', { ascending: false })
    .limit(1000);
    
  const rpcDurations = metrics?.map(m => m.duration_ms) || [];
  const avgRpcLatency = rpcDurations.reduce((a, b) => a + b, 0) / (rpcDurations.length || 1);

  console.log('\n--- STRESS TEST RESULTS ---');
  console.log(`Total Time: ${totalTime}ms`);
  console.log(`Average DB Cycle per Chat: ${avgLatency.toFixed(2)}ms`);
  console.log(`Average RPC Latency (search_memories): ${avgRpcLatency.toFixed(2)}ms`);
  console.log(`Estimated Egress: ${qt.estimatedEgressMb()} MB`);
  console.log(`Estimated Egress Saved: ${qt.estimatedEgressSavedMb()} MB`);
  
  // Cleanup
  await supabaseAdmin.from('memories').delete().eq('user_id', userId);
  await supabaseAdmin.from('chat_history').delete().eq('user_id', userId);
  await supabaseAdmin.from('profiles').delete().eq('id', userId);
  
  process.exit(0);
}

runStressTest().catch(console.error);
