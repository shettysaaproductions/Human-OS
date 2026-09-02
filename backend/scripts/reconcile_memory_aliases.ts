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
    .select('id, key, value, lifecycle_state, is_archived, created_at, source_authority, source_message, memory_type, importance, confidence, emotional_weight')
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
        // P0-3: Use authoritative lifecycle transition via RPC, not raw UPDATE
        const { error: quarantineErr } = await supabase.rpc('atomic_quarantine_memory', {
          p_user_id: userId,
          p_memory_id: mem.id,
          p_reason: 'Reconciliation script: Quarantined malformed command key'
        });
        if (quarantineErr) {
          console.error(`  [!] Failed to quarantine via RPC: ${quarantineErr.message}`);
        }
      }
    } else if (res.action === 'PERSIST' && res.canonicalKey && res.canonicalKey !== mem.key) {
      console.log(`[FIX NEEDED] ID: ${mem.id}`);
      console.log(`  Key: '${mem.key}' -> CANONICAL: '${res.canonicalKey}'`);
      console.log(`  Value: '${mem.value}'\n`);
      fixCount++;

      if (isApply) {
        // P0-4: Use single atomic canonicalization RPC.
        // This replaces the multi-step check -> upsert -> archive pattern with
        // one transaction that locks the alias, checks/creates canonical CURRENT,
        // and archives the alias -- guaranteeing exactly one CURRENT canonical
        // representation, preserving history, zero physical deletes.
        const { data: rpcResult, error: rpcErr } = await supabase.rpc('atomic_canonicalize_memory', {
          p_user_id: userId,
          p_alias_memory_id: mem.id,
          p_canonical_key: res.canonicalKey,
          p_reason: 'Reconciliation script: Canonical alias migration'
        });

        if (rpcErr) {
          console.error(`  [!] Atomic canonicalization failed: ${rpcErr.message}`);
        } else if (rpcResult && rpcResult.success) {
          console.log(`  [OK] ${rpcResult.action === 'created_canonical' ? 'Created canonical' : 'Archived alias'}. Canonical ID: ${rpcResult.canonical_id}`);
        } else {
          console.error(`  [!] RPC returned failure: ${JSON.stringify(rpcResult)}`);
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
