import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'path';
import { MemorySemanticResolver } from '../src/lib/MemorySemanticResolver';
import { memoryRepository } from '../src/services/memoryRepository';

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
        // P0-3: Use authoritative state-transition path via MemoryRepository.
        // Never perform raw "UPDATE old CURRENT -> INSERT new CURRENT" as separate
        // application-level operations. The repository routes through the atomic
        // lifecycle (upsert) and the old alias is archived via the safe RPC,
        // preserving history, never creating two CURRENT rows, and staying
        // concurrent-safe (the unique index + repository retry handle races).

        // First, check if a CURRENT row with the canonical key already exists
        const { data: existingCanonical } = await supabase
          .from('memories')
          .select('id')
          .eq('user_id', userId)
          .eq('key', res.canonicalKey)
          .eq('is_archived', false)
          .maybeSingle();

        if (existingCanonical) {
          // Canonical key already exists - archive the alias row only
          console.log(`  [INFO] Canonical key '${res.canonicalKey}' already exists (ID: ${existingCanonical.id}). Archiving alias.`);

          const { error: archiveErr } = await supabase.rpc('atomic_archive_memory', {
            p_user_id: userId,
            p_memory_id: mem.id,
            p_reason: 'Reconciliation script: Duplicate alias of canonical key'
          });
          if (archiveErr) {
            console.error(`  [!] Failed to archive alias via RPC: ${archiveErr.message}`);
          }
        } else {
          // No canonical CURRENT exists - commit the canonical row through the
          // authoritative MemoryRepository (fresh authoritative insert, no raw
          // replacement), then safely archive the old alias row.
          try {
            await memoryRepository.upsertMemory(userId, {
              type: (mem.memory_type || 'semantic') as any,
              key: res.canonicalKey,
              value: mem.value,
              importance: mem.importance || 50,
              confidence: mem.confidence || 0.8,
              emotional_weight: mem.emotional_weight || 0,
              source_authority: mem.source_authority || 'needs_review',
              shouldPersist: true
            } as any, mem.source_message || 'Reconciliation canonicalization');
            console.log(`  [OK] Canonical row committed via MemoryRepository.`);

            const { error: archiveErr } = await supabase.rpc('atomic_archive_memory', {
              p_user_id: userId,
              p_memory_id: mem.id,
              p_reason: 'Reconciliation script: Canonical alias migration'
            });
            if (archiveErr) {
              console.error(`  [!] Failed to archive old alias via RPC: ${archiveErr.message}`);
            }
          } catch (err: any) {
            console.error(`  [!] Failed canonical migration through MemoryRepository: ${err?.message}`);
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
