// @ts-nocheck
import express from 'express';
import { chatRouter } from '../src/routes/chat';
import { supabaseAdmin } from '../src/lib/supabase';
import { v4 as uuidv4 } from 'uuid';

const app = express();
app.use(express.json());

const TEST_USER_ID = '00000000-0000-0000-0000-000000000050'; // deterministic UUID
app.use((req: any, res, next) => {
  req.user = { id: TEST_USER_ID, email: 'burst_test@test.com' };
  next();
});

app.use('/chat', chatRouter);

async function runBurstTest() {
  console.log('--- STARTING 50 MESSAGE BURST TEST ---');
  
  // 1. Cleanup old test data
  console.log('Cleaning up old test data for user...', TEST_USER_ID);
  await supabaseAdmin.from('background_jobs').delete().eq('payload->>userId', TEST_USER_ID);
  await supabaseAdmin.from('chat_history').delete().eq('user_id', TEST_USER_ID);

  const server = app.listen(0, async () => {
    const port = server.address().port;
    const url = `http://localhost:${port}/chat`;
    
    const messages = Array.from({ length: 50 }, (_, i) => `Message ${i + 1}`);
    console.log(`Firing 50 concurrent HTTP requests to ${url}...`);
    
    const startTime = Date.now();
    const promises = messages.map(msg => 
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg })
      })
    );

    const responses = await Promise.allSettled(promises);
    console.log(`All requests completed in ${Date.now() - startTime}ms`);

    // Verify chat_history
    const { data: chatHistory, error: chatErr } = await supabaseAdmin
      .from('chat_history')
      .select('id, content, created_at')
      .eq('user_id', TEST_USER_ID)
      .eq('role', 'user')
      .order('created_at', { ascending: true });

    console.log(`\nVerified chat_history rows: ${chatHistory?.length} (Expected 50)`);

    // Verify background_jobs
    const { data: jobs, error: jobErr } = await supabaseAdmin
      .from('background_jobs')
      .select('id, status, job_sequence, attempts')
      .eq('payload->>userId', TEST_USER_ID)
      .order('job_sequence', { ascending: true });

    console.log(`Verified background_jobs rows: ${jobs?.length} (Expected 50)`);
    
    const completedJobs = jobs?.filter(j => j.status === 'completed') || [];
    console.log(`Completed jobs: ${completedJobs.length} (Expected 50)`);

    let isSequential = true;
    for (let i = 1; i < (jobs?.length || 0); i++) {
      if (jobs![i].job_sequence <= jobs![i - 1].job_sequence) {
        isSequential = false;
        break;
      }
    }
    console.log(`Jobs processed sequentially: ${isSequential}`);

    // Test crash recovery logic simulation
    console.log('\n--- TESTING CRASH RECOVERY LOGIC ---');
    // Insert a stuck job manually that started 65 seconds ago
    const stuckJobId = uuidv4();
    await supabaseAdmin.from('background_jobs').insert({
      id: stuckJobId,
      job_type: 'process_semantic_turn',
      status: 'running',
      started_at: new Date(Date.now() - 65000).toISOString(),
      payload: { userId: TEST_USER_ID, turnId: 'stuck-turn', primaryMessage: 'Stuck' }
    });

    // Call the RPC directly to see if it claims the stuck job
    const { data: claimedJob, error: rpcErr } = await supabaseAdmin.rpc('claim_next_background_job_for_user', {
      p_user_id: TEST_USER_ID,
      p_job_type: 'process_semantic_turn'
    });

    console.log('Claimed stuck job:', claimedJob?.[0]?.id === stuckJobId ? 'YES (Success)' : 'NO (Failed)');

    console.log('\n--- CLEANUP ---');
    await supabaseAdmin.from('background_jobs').delete().eq('payload->>userId', TEST_USER_ID);
    await supabaseAdmin.from('chat_history').delete().eq('user_id', TEST_USER_ID);

    server.close();
    process.exit(0);
  });
}

runBurstTest().catch(err => { console.error(err); process.exit(1); });
