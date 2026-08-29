import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error("Missing Supabase credentials.");
  process.exit(1);
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

async function runTrace() {
  console.log(`\n============================================================`);
  console.log(`FORENSIC TRACE FOR RECENT CLOUD KITCHEN THREADS`);
  console.log(`============================================================\n`);

  const { data: recentThreads, error: threadErr } = await supabaseAdmin
    .from('life_threads')
    .select('*')
    .ilike('topic', '%cloud kitchen%')
    .order('created_at', { ascending: false })
    .limit(5);

  if (threadErr || !recentThreads || recentThreads.length === 0) {
    console.error("Failed to find any recent cloud kitchen threads:", threadErr);
    return;
  }

  console.log(`Found ${recentThreads.length} recent threads for 'cloud kitchen':`);
  recentThreads.forEach(t => console.log(`  ID: ${t.id} | User: ${t.user_id} | State: ${t.state} | Created: ${t.created_at}`));

  const thread = recentThreads[0];
  const threadId = thread.id;

  const userId = thread.user_id;
  console.log(`User ID: ${userId}`);
  console.log(`Thread Topic: ${thread.topic}`);
  console.log(`Thread State: ${thread.state}`);
  console.log(`Thread Provenance:\n${thread.provenance}\n`);

  // 2. Check for duplicate threads
  const { data: allThreads } = await supabaseAdmin
    .from('life_threads')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  console.log(`Total Threads for User: ${allThreads?.length}`);
  const duplicates = allThreads?.filter(t => t.id !== threadId && t.topic.toLowerCase().includes('cloud kitchen'));
  console.log(`Duplicate "cloud kitchen" threads: ${duplicates?.length}\n`);
  if (duplicates?.length) {
    duplicates.forEach(d => {
      console.log(`  Duplicate ID: ${d.id}`);
      console.log(`  State: ${d.state}`);
      console.log(`  Provenance:\n${d.provenance}\n`);
    });
  }

  // 3. Get recent chat history to identify the "Ab cloud kitchen next month start karne wala hu" message
  const { data: chatHistory } = await supabaseAdmin
    .from('chat_history')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(10);

  const resumeMsg = chatHistory?.find(c => c.role === 'user' && c.content.toLowerCase().includes('next month'));
  if (!resumeMsg) {
    console.log("Could not find the resume message in recent chat history.");
    console.log("Recent messages:");
    chatHistory?.forEach(c => console.log(`  [${c.role}] ${c.content}`));
    return;
  }

  console.log(`Resume Message ID: ${resumeMsg.id}`);
  console.log(`Resume Message Content: ${resumeMsg.content}`);
  console.log(`Resume Message Created At: ${resumeMsg.created_at}\n`);

  // 4. Trace Background Jobs
  // Look for jobs around the time of the resume message
  const startTime = new Date(new Date(resumeMsg.created_at).getTime() - 10000).toISOString();
  
  const { data: processedJobs } = await supabaseAdmin
    .from('processed_jobs')
    .select('*')
    .eq('user_id', userId)
    .gte('created_at', startTime)
    .order('created_at', { ascending: true });

  console.log(`Processed Jobs after resume message:`);
  processedJobs?.forEach(j => {
    console.log(`  [${j.created_at}] Type: ${j.job_type} | ID: ${j.job_id} | Status: ${j.status}`);
    if (j.job_type === 'extract_life_threads') {
      console.log(`    Payload: ${JSON.stringify(j.payload)}`);
      if (j.result) console.log(`    Result: ${JSON.stringify(j.result)}`);
      if (j.error) console.log(`    Error: ${j.error}`);
    }
  });

  const { data: pendingJobs } = await supabaseAdmin
    .from('background_jobs')
    .select('*')
    .eq('user_id', userId)
    .gte('created_at', startTime)
    .order('created_at', { ascending: true });

  console.log(`\nPending Jobs after resume message:`);
  pendingJobs?.forEach(j => {
    console.log(`  [${j.created_at}] Type: ${j.job_type} | ID: ${j.id}`);
    console.log(`    Payload: ${JSON.stringify(j.payload)}`);
  });

  // 5. Check Working Memory / Context at the time
  const { data: mems } = await supabaseAdmin
    .from('memories')
    .select('*')
    .eq('user_id', userId)
    .gte('created_at', startTime);
  
  console.log(`\nMemories extracted after resume message: ${mems?.length}`);
  mems?.forEach(m => {
    console.log(`  [${m.created_at}] ${m.key}: ${m.value}`);
  });

}

runTrace().catch(console.error);
