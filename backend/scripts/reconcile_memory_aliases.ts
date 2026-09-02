import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'path';
import { MemorySemanticResolver } from '../src/lib/MemorySemanticResolver';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing Supabase credentials in .env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function runReconciliation() {
  const args = process.argv.slice(2);
  const isApply = args.includes('--apply');
  const userId = args.find(arg => arg.startsWith('--user='))?.split('=')[1];

  if (!userId) {
    console.error('ERROR: You must specify a user scope via --user=<uuid>');
    console.log('Usage: npx tsx scripts/reconcile_memory_aliases.ts --user=<uuid> [--apply]');
    process.exit(1);
  }

  console.log(`\n============================================================`);
  console.log(`[RECONCILIATION] Starting Memory Semantic Aliases Reconciliation`);
  console.log(`[MODE] ${isApply ? 'APPLY (Mutating)' : 'DRY-RUN (Read-only)'}`);
  console.log(`[USER] ${userId}`);
  console.log(`============================================================\n`);

  // Fetch active CURRENT memories for user
  const { data: memories, error } = await supabase
    .from('memories')
    .select('id, key, value, lifecycle_state, is_archived, created_at')
    .eq('user_id', userId)
    .eq('is_archived', false);

  if (error) {
    console.error('Failed to fetch memories:', error.message);
    process.exit(1);
  }

  const activeMemories = memories.filter(m => !m.lifecycle_state || m.lifecycle_state === 'CURRENT');
  
  console.log(`Found ${activeMemories.length} active CURRENT memories.\n`);

  let fixCount = 0;
  let quarantineCount = 0;

  for (const mem of activeMemories) {
    const res = MemorySemanticResolver.resolveProposedKey(mem.key);
    
    if (res.action === 'QUARANTINE') {
      console.log(`[QUARANTINE] ID: ${mem.id}`);
      console.log(`  Key: '${mem.key}' -> MALFORMED COMMAND KEY`);
      console.log(`  Value: '${mem.value}'`);
      console.log(`  Reason: ${res.reason}\n`);
      quarantineCount++;
      
      if (isApply) {
        await supabase
          .from('memories')
          .update({
            is_archived: true,
            lifecycle_state: 'INVALIDATED',
            supersession_reason: 'Reconciliation script: Quarantined malformed command key'
          })
          .eq('id', mem.id);
      }
    } else if (res.action === 'PERSIST' && res.canonicalKey && res.canonicalKey !== mem.key) {
      console.log(`[FIX NEEDED] ID: ${mem.id}`);
      console.log(`  Key: '${mem.key}' -> CANONICAL: '${res.canonicalKey}'`);
      console.log(`  Value: '${mem.value}'\n`);
      fixCount++;

      if (isApply) {
        // We will supersede the old one and create a new CURRENT one
        
        // 1. Mark superseded
        await supabase
          .from('memories')
          .update({
            is_archived: true,
            lifecycle_state: 'SUPERSEDED',
            supersession_reason: 'Reconciliation script: Canonical alias migration'
          })
          .eq('id', mem.id);
          
        // 2. Insert new canonical memory
        // First get the full original row to clone it exactly except the key
        const { data: fullRow } = await supabase.from('memories').select('*').eq('id', mem.id).single();
        if (fullRow) {
           const newPayload = {
             ...fullRow,
             id: undefined, // let DB generate
             key: res.canonicalKey,
             is_archived: false,
             lifecycle_state: 'CURRENT',
           };
           // We ignore unique constraints here by using upsert or checking manually, 
           // but since we just superseded the old one, it's safe if it doesn't conflict.
           // Actually, if there is ALREADY a canonical row, this will throw constraint violation.
           // In a full script we'd merge them, but for this basic reconciliation:
           const insertRes = await supabase.from('memories').insert(newPayload);
           
           if (insertRes.error) {
              console.error(`  [!] Failed to insert canonical row (Constraint Violation?): ${insertRes.error.message}`);
              // Rollback supersede
              await supabase.from('memories').update({ is_archived: false, lifecycle_state: 'CURRENT' }).eq('id', mem.id);
           }
        }
      }
    }
  }

  console.log(`\n============================================================`);
  console.log(`[SUMMARY]`);
  console.log(`  Total Active Memories: ${activeMemories.length}`);
  console.log(`  Keys Needing Canonical Fix: ${fixCount}`);
  console.log(`  Keys Needing Quarantine: ${quarantineCount}`);
  if (!isApply) {
    console.log(`\nTo apply these changes, run with --apply`);
  } else {
    console.log(`\nChanges APPLIED.`);
  }
  console.log(`============================================================\n`);
}

runReconciliation().catch(console.error);
