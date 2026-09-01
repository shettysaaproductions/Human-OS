import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const TARGET_EMAIL = 'admin@recrutos.com';

async function investigate() {
  console.log('=== NORMAL MEMORY PROMOTION INVESTIGATION ===\n');

  // 1. Identify User
  const { data: users, error: userErr } = await supabase.auth.admin.listUsers();
  if (userErr) {
    console.error('Failed to list users:', userErr);
    return;
  }

  const user = users.users.find((u) => u.email === TARGET_EMAIL);
  if (!user) {
    console.error(`User ${TARGET_EMAIL} not found.`);
    return;
  }

  const userId = user.id;
  console.log(`User ID: ${userId}\n`);

  // 2. Fetch Working Memory Candidates
  const { data: workingMemory } = await supabase
    .from('working_memory')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'CANDIDATE');

  console.log(`candidate rows: ${workingMemory?.length || 0}`);

  // 3. Fetch Claims
  const { data: claims } = await supabase
    .from('candidate_synthesis_claims')
    .select('*')
    .eq('user_id', userId);

  console.log(`candidate_synthesis_claims rows: ${claims?.length || 0}`);

  // 4. Determine Worker Execution Evidence
  // If claims exist, or if candidate status has changed (but we only fetched 'CANDIDATE' above),
  // let's fetch all working_memory to see if any are processed.
  const { data: allWM } = await supabase
    .from('working_memory')
    .select('*')
    .eq('user_id', userId);
  
  const processedWM = allWM?.filter(w => w.status !== 'CANDIDATE' && w.status !== 'ACTIVE') || [];
  
  let workerEvidence = (claims && claims.length > 0) || processedWM.length > 0 ? 'YES' : 'NO';
  console.log(`worker execution evidence: ${workerEvidence}`);

  // 5. Promoted / Rejected / Stuck Rows
  // Promoted implies working_memory is marked something like 'PROMOTED' or it became a durable memory.
  // The 'status' field in working_memory might be 'PROMOTED', 'REJECTED', 'SYNTHESIZED' etc.
  const promotedCount = allWM?.filter(w => w.status === 'PROMOTED' || w.status === 'SYNTHESIZED').length || 0;
  const rejectedCount = allWM?.filter(w => w.status === 'REJECTED' || w.status === 'INVALID').length || 0;
  const stuckCount = workingMemory?.length || 0;

  console.log(`promoted rows: ${promotedCount}`);
  console.log(`rejected rows: ${rejectedCount}`);
  console.log(`stuck rows: ${stuckCount}`);

  // 6. Fetch worker errors (if we can from the DB)
  // Check the `system_logs` or `task_logs` table if it exists, or just check the last updated_at of claims.
  let latestError = 'None detected in DB directly (check server logs)';
  // Attempt to check if claims have an 'error' column
  if (claims && claims.length > 0) {
    const errorClaims = claims.filter(c => c.status === 'error' || c.error_message);
    if (errorClaims.length > 0) {
      latestError = errorClaims[0].error_message || 'Error status in claim';
    }
  }
  console.log(`latest worker errors: ${latestError}`);
  
  // 7. Exact reason
  let reason = 'N/A';
  if (stuckCount > 0 && claims?.length === 0) {
    reason = 'The candidate synthesis worker is not picking up the candidates to create claims.';
  } else if (claims && claims.length > 0) {
    reason = 'Worker created claims but did not finish promotion (synthesis failure or validation failure).';
  } else if (allWM?.length === 0) {
     reason = 'No working memory items exist to promote.';
  }

  console.log(`exact reason if promotion has not occurred: ${reason}\n`);

  // 8. FINAL STATUS
  let finalStatus = 'UNKNOWN';
  if (stuckCount > 0) {
     finalStatus = 'FAIL';
  } else if (promotedCount > 0) {
     finalStatus = 'PASS';
  } else if (allWM?.length === 0) {
     finalStatus = 'UNKNOWN'; // No candidates to test
  }

  console.log(`FINAL STATUS = NORMAL_MEMORY_PROMOTION = ${finalStatus}`);
}

investigate();
