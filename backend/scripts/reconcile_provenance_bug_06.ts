import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error("Missing Supabase credentials.");
  process.exit(1);
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

async function runReconciliation() {
  const isDryRun = !process.argv.includes('--execute');
  console.log(`Starting Reconciliation... DRY RUN = ${isDryRun}`);

  const { data: threads, error } = await supabaseAdmin
    .from('life_threads')
    .select('id, user_id, topic, state, provenance')
    .like('provenance', '%[CONCEPT SUPERSEDED:%');

  if (error) {
    console.error("Error fetching threads:", error);
    return;
  }

  if (!threads || threads.length === 0) {
    console.log("No threads found with [CONCEPT SUPERSEDED:] in provenance.");
    return;
  }

  let repairedCount = 0;

  for (const thread of threads) {
    const prov = thread.provenance || '';
    
    // Extract the superseded concept
    const match = prov.match(/\[CONCEPT SUPERSEDED: "([^"]+)" — user correction\. Thread remains active with corrected context\.\]/);
    if (!match) continue;

    const concept = match[1];
    
    // Heuristic: If the thread topic still contains the "superseded" concept,
    // AND it's not explicitly abandoned, it was likely poisoned by a temporal pause bug.
    // True factual corrections would either change the topic or abandon the thread.
    const topicLower = (thread.topic || '').toLowerCase();
    const conceptLower = concept.toLowerCase();

    if (topicLower.includes(conceptLower)) {
      console.log(`\nFound poisoned thread: ${thread.id}`);
      console.log(`  Topic: ${thread.topic}`);
      console.log(`  State: ${thread.state}`);
      console.log(`  Concept: ${concept}`);
      
      const newProv = prov.replace(
        match[0],
        `[CONCEPT PAUSED: "${concept}" — temporal pause. Annotated incorrectly by Bug-06.]`
      ) + `\n[RECONCILIATION: Fixed erroneous concept supersession string on ${new Date().toISOString().slice(0, 10)}]`;

      console.log(`  Original Provenance:\n${prov}\n`);
      console.log(`  Repaired Provenance:\n${newProv}\n`);

      if (!isDryRun) {
        const { error: updErr } = await supabaseAdmin.from('life_threads').update({
          provenance: newProv,
          // We restore the state to waiting if it somehow got stuck active,
          // though typically suppress_life_thread already set it to waiting.
          state: thread.state === 'active' ? 'waiting' : thread.state,
          updated_at: new Date().toISOString()
        }).eq('id', thread.id);

        if (updErr) {
          console.error(`  Failed to update thread ${thread.id}:`, updErr);
        } else {
          console.log(`  Successfully repaired thread ${thread.id}`);
          repairedCount++;
        }
      } else {
        repairedCount++;
      }
    }
  }

  console.log(`\nReconciliation complete. ${repairedCount} threads ${isDryRun ? 'would be ' : ''}repaired.`);
  if (isDryRun) {
    console.log("Run with --execute to apply changes.");
  }
}

runReconciliation().catch(console.error);
