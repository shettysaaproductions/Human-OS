/**
 * reconcile_lifethreads.ts — Safe Duplicate Reconciliation for LifeThreads
 *
 * PHASE 1 / AMENDMENT 2:
 * Scans all active/waiting/blocked life_threads, identifies duplicate canonical groups,
 * selects the canonical row, merges provenance/actions, and transitions duplicate
 * rows to 'superseded' (never hard-deletes).
 *
 * Usage:
 *   Dry-run (report only):
 *     npx tsx scripts/reconcile_lifethreads.ts --dry-run
 *   Apply reconciliation:
 *     npx tsx scripts/reconcile_lifethreads.ts --apply
 */

import { supabaseAdmin } from '../src/lib/supabase';
import { canonicalizeLifeThreadKey } from '../src/lib/lifeThreadKeySchema';

const isApply = process.argv.includes('--apply');

interface DuplicateGroup {
  userId: string;
  canonicalKey: string;
  threads: any[];
  canonicalThread: any;
  duplicateThreads: any[];
  reason: string;
}

async function reconcileLifeThreads() {
  console.log('================================================================');
  console.log(`🧬 LIFETHREAD CANONICAL RECONCILIATION (${isApply ? 'APPLY MODE' : 'DRY-RUN MODE'})`);
  console.log('Time:', new Date().toISOString());
  console.log('================================================================\n');

  // 1. Fetch all threads
  const { data: allThreads, error: fetchErr } = await supabaseAdmin
    .from('life_threads')
    .select('*')
    .order('created_at', { ascending: true });

  if (fetchErr) {
    console.error('❌ Failed to fetch life_threads:', fetchErr.message);
    process.exit(1);
  }

  console.log(`Found ${allThreads?.length || 0} total life_threads in database.`);

  // 2. Group active/waiting/blocked threads by (user_id, canonical_key)
  const activeGroups = new Map<string, any[]>();
  const unbackfilledThreads: any[] = [];

  for (const thread of (allThreads || [])) {
    const meta = canonicalizeLifeThreadKey(thread.topic, thread.provenance);
    const canonicalKey = thread.canonical_key || meta.canonicalKey;

    if (!thread.canonical_key) {
      unbackfilledThreads.push({ id: thread.id, canonicalKey, topic: thread.topic });
    }

    if (['active', 'waiting', 'blocked'].includes(thread.state)) {
      const groupKey = `${thread.user_id}::${canonicalKey}`;
      if (!activeGroups.has(groupKey)) {
        activeGroups.set(groupKey, []);
      }
      activeGroups.get(groupKey)!.push({ ...thread, computedCanonicalKey: canonicalKey });
    }
  }

  // 3. Identify Duplicate Groups
  const duplicateGroups: DuplicateGroup[] = [];

  for (const [groupKey, threads] of activeGroups.entries()) {
    if (threads.length > 1) {
      const [userId, canonicalKey] = groupKey.split('::');

      // Rank candidate threads to find the canonical winner
      // 1. State priority: 'active' (3) > 'waiting' (2) > 'blocked' (1)
      // 2. Priority rank: 'high' (3) > 'medium' (2) > 'low' (1)
      // 3. Recency: newest last_relevant_at / updated_at
      const stateRank = (s: string) => s === 'active' ? 3 : s === 'waiting' ? 2 : 1;
      const priorityRank = (p: string) => p === 'high' ? 3 : p === 'medium' ? 2 : 1;

      threads.sort((a, b) => {
        const sr = stateRank(b.state) - stateRank(a.state);
        if (sr !== 0) return sr;

        const pr = priorityRank(b.priority) - priorityRank(a.priority);
        if (pr !== 0) return pr;

        const timeB = new Date(b.last_relevant_at || b.updated_at || b.created_at).getTime();
        const timeA = new Date(a.last_relevant_at || a.updated_at || a.created_at).getTime();
        return timeB - timeA;
      });

      const canonicalThread = threads[0];
      const duplicateThreads = threads.slice(1);

      duplicateGroups.push({
        userId,
        canonicalKey,
        threads,
        canonicalThread,
        duplicateThreads,
        reason: `Selected thread ${canonicalThread.id} as canonical (state: ${canonicalThread.state}, priority: ${canonicalThread.priority}, last_relevant: ${canonicalThread.last_relevant_at})`
      });
    }
  }

  // 4. Report Findings
  console.log(`\n📊 AUDIT RESULTS:`);
  console.log(`- Total threads needing canonical_key backfill: ${unbackfilledThreads.length}`);
  console.log(`- Conflicting active/waiting/blocked duplicate groups found: ${duplicateGroups.length}\n`);

  if (duplicateGroups.length > 0) {
    console.log('════════════════════════════════════════════════════════════════');
    console.log('⚠️ CONFLICTING DUPLICATE GROUPS FOUND:');
    console.log('════════════════════════════════════════════════════════════════');

    for (let i = 0; i < duplicateGroups.length; i++) {
      const g = duplicateGroups[i];
      console.log(`\n[Group ${i + 1}] User: ${g.userId} | Canonical Key: "${g.canonicalKey}" (${g.threads.length} threads)`);
      console.log(`  👑 CANONICAL WINNER: [${g.canonicalThread.id}] "${g.canonicalThread.topic}" (state: ${g.canonicalThread.state}, priority: ${g.canonicalThread.priority})`);
      console.log(`     Reason: ${g.reason}`);
      console.log(`  📦 MERGE / SUPERSEDE CANDIDATES:`);
      for (const dup of g.duplicateThreads) {
        console.log(`     - [${dup.id}] "${dup.topic}" (state: ${dup.state}) -> Will be marked 'superseded' & provenance merged`);
      }
    }
  } else {
    console.log('✅ No conflicting duplicate active/waiting/blocked groups found in database.');
  }

  // 5. Apply if requested
  if (isApply) {
    console.log('\n🚀 APPLYING RECONCILIATION & BACKFILL...');

    // A. Backfill canonical_key for all rows
    console.log('  -> Backfilling canonical_key for all threads...');
    for (const thread of (allThreads || [])) {
      const meta = canonicalizeLifeThreadKey(thread.topic, thread.provenance);
      await supabaseAdmin
        .from('life_threads')
        .update({
          canonical_key: meta.canonicalKey,
          version: thread.version || 1,
          updated_at: new Date().toISOString()
        })
        .eq('id', thread.id);
    }
    console.log('  -> Backfill complete.');

    // B. Reconcile duplicate groups
    if (duplicateGroups.length > 0) {
      console.log(`  -> Reconciling ${duplicateGroups.length} duplicate groups...`);
      for (const g of duplicateGroups) {
        const winner = g.canonicalThread;
        let mergedProvenance = winner.provenance ?? '';

        for (const dup of g.duplicateThreads) {
          // Append merged provenance
          const mergeNote = `\n[MERGED DUPLICATE THREAD: id=${dup.id}, topic="${dup.topic}", original_state=${dup.state} — ${new Date().toISOString().slice(0, 10)}]`;
          mergedProvenance += mergeNote;
          if (dup.provenance) {
            mergedProvenance += `\n[DUPLICATE PROVENANCE]: ${dup.provenance}`;
          }

          // Reassign associated nova_actions to canonical thread
          await supabaseAdmin
            .from('nova_actions')
            .update({ source_thread_id: winner.id })
            .eq('source_thread_id', dup.id);

          // Mark duplicate row as superseded (Preserves historical record!)
          await supabaseAdmin
            .from('life_threads')
            .update({
              state: 'superseded',
              provenance: (dup.provenance ?? '') + `\n[SUPERSEDED: Merged into canonical thread ${winner.id} — ${new Date().toISOString().slice(0, 10)}]`,
              updated_at: new Date().toISOString()
            })
            .eq('id', dup.id);
        }

        // Update winner with merged provenance
        await supabaseAdmin
          .from('life_threads')
          .update({
            provenance: mergedProvenance,
            canonical_key: g.canonicalKey,
            updated_at: new Date().toISOString()
          })
          .eq('id', winner.id);
      }
      console.log('  -> Duplicate group reconciliation complete.');
    }

    console.log('\n🎉 RECONCILIATION & BACKFILL COMPLETED SUCCESSFULLY!');
    console.log('You may now safely apply migration 042 (partial unique index).');
  } else {
    console.log('\n💡 Dry-run complete. To execute the reconciliation, run with --apply:');
    console.log('   npx tsx scripts/reconcile_lifethreads.ts --apply\n');
  }
}

if (require.main === module) {
  reconcileLifeThreads();
}
