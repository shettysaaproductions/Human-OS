import { supabaseAdmin } from '../lib/supabase';
import { chatCompletionBackground } from '../lib/nvidia';
import { logger } from '../lib/logger';

// ── BUG-04: Jaccard similarity helper ─────────────────────────────────────────
// Used as a CHEAP CANDIDATE FILTER only. LLM makes final merge/create decision.
const STOP_WORDS = new Set(['a','an','the','is','in','on','at','to','for','of','and','or','with','ka','ki','ke','hai','mera','meri']);

function tokenize(text: string): Set<string> {
  return new Set(
    text.toLowerCase().split(/\s+/).filter(w => w.length > 2 && !STOP_WORDS.has(w))
  );
}

function jaccardSimilarity(a: string, b: string): number {
  const sa = tokenize(a);
  const sb = tokenize(b);
  if (sa.size === 0 && sb.size === 0) return 1;
  const intersection = new Set([...sa].filter(x => sb.has(x)));
  const union = new Set([...sa, ...sb]);
  return intersection.size / union.size;
}

// ── BUG-NEGATION-RESUME FIX: Explicit resume detection ──────────────────────
// Runs BEFORE the action branch so it applies to both action=update and action=create.
// Covers common Hindi/English temporal resume phrases.
const EXPLICIT_RESUME_RE = /\b(ab|phir\s*se|dobara|wapas|resume|restart|shuru\s*kar)\b.*\b(start|shuru|karenge|karna|karunga|karni|karenge|plan|continue)\b|\b(next\s+month|agli\s+baar|next\s+week|jald\s*hi|soon)\b.*\b(start|shuru|karenge|karna|karunga)\b/i;

/**
 * Returns true if the user message explicitly signals they are restarting/resuming a paused goal.
 * This is intentionally broad — false positives are cheaper than missed resumes.
 */
function detectExplicitResume(msg: string): boolean {
  return EXPLICIT_RESUME_RE.test(msg);
}

/**
 * FIX 2: Find the best WAITING thread candidate for an explicit resume.
 * Deliberately does NOT use JACCARD_CANDIDATE_THRESHOLD — a paused thread
 * should be reachable even when the message is verbose (low Jaccard score).
 * Algorithm: any token from the thread topic appears in the user message.
 */
function findBestWaitingCandidate(waitingThreads: any[], userMsg: string): any | null {
  const msgTokens = tokenize(userMsg);
  let bestThread: any = null;
  let bestScore = 0;
  for (const t of waitingThreads) {
    const topicTokens = tokenize(t.topic ?? '');
    const overlap = new Set([...topicTokens].filter(x => msgTokens.has(x)));
    if (overlap.size > 0) {
      const score = overlap.size / Math.max(topicTokens.size, 1);
      if (score > bestScore) {
        bestScore = score;
        bestThread = t;
      }
    }
  }
  return bestThread;
}

// Minimum Jaccard score to include a thread as a merge CANDIDATE in the LLM prompt
const JACCARD_CANDIDATE_THRESHOLD = 0.25;
// Soft thread count threshold: at this count, strongly suggest update/complete over create
const SOFT_THREAD_LIMIT = 5;

interface ActionUpdate {
  operation: 'create' | 'update' | 'complete' | 'cancel' | 'ignore';
  action_id?: string; // If updating existing
  logical_key?: string; // e.g. 'call_client_tomorrow'
  title?: string;
  description?: string;
  state?: 'suggested' | 'pending_confirmation' | 'scheduled' | 'in_progress' | 'completed' | 'cancelled' | 'blocked';
  priority?: 'low' | 'medium' | 'high';
  execution_class?: 'SAFE_AUTOMATIC' | 'USER_VISIBLE_REVERSIBLE' | 'CONFIRMATION_REQUIRED';
  due_at?: string | null;
  dependency_keys?: string[];
  provenance?: string;
}

interface LifeThreadUpdate {
  action: 'create' | 'update' | 'complete' | 'abandon' | 'ignore';
  thread_id?: string;
  topic?: string;
  state?: 'active' | 'waiting' | 'blocked' | 'completed' | 'abandoned';
  priority?: 'low' | 'medium' | 'high';
  provenance?: string;
  reason?: string;
  actions?: ActionUpdate[];
}

export class LifeThreadAgent {
  // Amendment 4: UUID regex for payload validation
  private static readonly UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  async processJob(job: any): Promise<void> {
    const { user_id, turn_context, message_id } = job.payload || {};

    // ── Amendment 4: Classify failure modes at entry ──────────────────────────
    if (!user_id) {
      const err = new Error('LifeThreadAgent[MALFORMED_PAYLOAD]: user_id is missing from job payload');
      (err as any).isPermanent = true;
      throw err;
    }
    if (!LifeThreadAgent.UUID_RE.test(user_id)) {
      const err = new Error(`LifeThreadAgent[INVALID_USER_ID]: "${user_id}" is not a valid UUID — job aborted`);
      (err as any).isPermanent = true;
      throw err;
    }
    if (!turn_context) {
      const err = new Error('LifeThreadAgent[MALFORMED_PAYLOAD]: turn_context is missing from job payload');
      (err as any).isPermanent = true;
      throw err;
    }

    // 1. Fetch active threads
    const { data: activeThreads, error: fetchErr } = await supabaseAdmin
      .from('life_threads')
      .select('*')
      .eq('user_id', user_id)
      .in('state', ['active', 'waiting', 'blocked']);

    if (fetchErr) {
      // Amendment 4: DB/query failures must produce readable error strings
      throw new Error(`LifeThreadAgent[DB_FETCH_FAILURE]: ${fetchErr.message ?? JSON.stringify(fetchErr)}`);
    }

    // 1b. Fetch active actions
    const { data: activeActions } = await supabaseAdmin
      .from('nova_actions')
      .select('*')
      .eq('user_id', user_id)
      .in('state', ['suggested', 'pending_confirmation', 'scheduled', 'in_progress', 'blocked']);

    // 2. Fetch last 8 messages for context
    const { data: recentMessages } = await supabaseAdmin
      .from('chat_history')
      .select('role, content')
      .eq('user_id', user_id)
      .order('created_at', { ascending: false })
      .limit(8);
      
    const recentChat = (recentMessages || []).reverse();
    if (recentChat.length === 0) return;

    // ── BUG-06: Concept-level correction propagation (Amendment 3) ────────────
    // When the user negates a concept ("fashion ka shop nahi"), mark that concept
    // as superseded in matching thread provenance WITHOUT killing the thread.
    const negatedConcepts: string[] = turn_context?.negativeCorrectionConcepts || [];
    if (negatedConcepts.length > 0 && activeThreads && activeThreads.length > 0) {
      await this.updateThreadProvenanceForCorrection(user_id, activeThreads, negatedConcepts);
    }

    // 3. Prompt LLM to analyze (with BUG-04 dedup context injected)
    const threads = activeThreads || [];
    const prompt = this.buildPrompt(threads, activeActions || [], recentChat);
    let responseText: string;
    try {
      responseText = await chatCompletionBackground([
        { role: 'user', content: prompt }
      ], { temperature: 0.1 });
    } catch (llmErr: any) {
      // Amendment 4: classify LLM/extraction failures separately
      throw new Error(`LifeThreadAgent[EXTRACTION_FAILURE]: LLM call failed — ${llmErr?.message ?? String(llmErr)}`);
    }

    // 4. Parse the action
    let result: LifeThreadUpdate;
    try {
      const jsonMatch = responseText.match(/```json\n([\s\S]*?)\n```/) || responseText.match(/\{[\s\S]*\}/);
      const jsonStr = jsonMatch ? jsonMatch[0].replace(/```json|```/g, '') : responseText;
      result = JSON.parse(jsonStr) as LifeThreadUpdate;
    } catch (e: any) {
      // Amendment 4: classify parse failures
      throw new Error(`LifeThreadAgent[APPLICATION_EXCEPTION]: JSON parse failed — ${e?.message ?? String(e)} | raw: ${responseText?.slice(0, 200)}`);
    }

    // 5. Apply the action deterministically
    await this.applyUpdate(user_id, result, threads, activeActions || [], message_id, recentChat);
  }

  /**
   * Amendment 3: Deterministic thread suppression.
   * Called synchronously from chat.ts after a negation is detected.
   * Transitions the matching thread to `waiting` state and adds a provenance note.
   * Does NOT call the LLM — purely deterministic.
   */
  async processSuppressJob(job: any): Promise<void> {
    const { user_id, negated_concept, reason, is_current } = job.payload || {};
    if (!user_id || !LifeThreadAgent.UUID_RE.test(user_id)) {
      const err = new Error(`LifeThreadAgent[SUPPRESS][INVALID_USER_ID]: "${user_id}"`);
      (err as any).isPermanent = true;
      throw err;
    }
    if (!negated_concept) {
      const err = new Error('LifeThreadAgent[SUPPRESS][MALFORMED_PAYLOAD]: negated_concept missing');
      (err as any).isPermanent = true;
      throw err;
    }

    // is_current=true  → user temporarily paused → set state 'waiting'
    // is_current=false → user permanently dropped → set state 'abandoned'
    // Default to 'waiting' for safety (less destructive) if flag is absent.
    const targetState = is_current === false ? 'abandoned' : 'waiting';

    const conceptLower = negated_concept.toLowerCase();

    const { data: threads, error: fetchErr } = await supabaseAdmin
      .from('life_threads')
      .select('id, topic, state, provenance')
      .eq('user_id', user_id)
      .in('state', ['active', 'waiting', 'blocked']);

    if (fetchErr) {
      throw new Error(`LifeThreadAgent[SUPPRESS][DB_FETCH_FAILURE]: ${fetchErr.message ?? JSON.stringify(fetchErr)}`);
    }

    const matched = (threads || []).filter(t => {
      const topicLower = (t.topic ?? '').toLowerCase();
      const provLower = (t.provenance ?? '').toLowerCase();
      return topicLower.includes(conceptLower) || provLower.includes(conceptLower);
    });

    for (const thread of matched) {
      if (thread.state === targetState) continue; // already in desired state
      const pauseLabel = is_current === false ? 'ABANDONED' : 'PAUSED';
      const transitionNote = `\n[STATE TRANSITION: ${thread.state} -> ${targetState}]`;
      const note = `\n[${pauseLabel} by user: "${reason || negated_concept}" — ${new Date().toISOString().slice(0, 10)}]${transitionNote}`;

      // ── FIX 7: Concurrency guard — only transition from the current observed state ──
      // Prevents a stale suppress from clobbering a thread that was already resumed/updated.
      const { error: updErr, count } = await (supabaseAdmin
        .from('life_threads')
        .update({
          state: targetState,
          provenance: (thread.provenance ?? '') + note,
          last_relevant_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', thread.id)
        .eq('user_id', user_id)
        .eq('state', thread.state) as any).select('id');

      if (updErr) {
        throw new Error(`LifeThreadAgent[SUPPRESS][DB_UPDATE_FAILURE]: ${updErr.message ?? JSON.stringify(updErr)}`);
      }
      if (count === 0) {
        logger.warn(`LifeThreadAgent[SUPPRESS][STALE_STATE]: Thread ${thread.id} was no longer in state "${thread.state}" when suppress write was attempted. Skipped.`, { userId: user_id, negated_concept, targetState });
      } else {
        logger.info(`LifeThreadAgent[SUPPRESS]: Thread "${thread.topic}" transitioned to ${targetState}`, { userId: user_id, threadId: thread.id, negated_concept, targetState });
      }
    }
  }

  /**
   * BUG-06 / Amendment 3: Mark concepts as superseded within active threads.
   * NEVER sets the thread to abandoned. The thread stays active;
   * only the incorrect concept is annotated as superseded.
   */
  private async updateThreadProvenanceForCorrection(
    userId: string,
    activeThreads: any[],
    negatedConcepts: string[]
  ): Promise<void> {
    for (const thread of activeThreads) {
      const topicLower = (thread.topic ?? '').toLowerCase();
      const provLower = (thread.provenance ?? '').toLowerCase();
      const matchedConcept = negatedConcepts.find(c =>
        topicLower.includes(c) || provLower.includes(c)
      );
      if (matchedConcept && !provLower.includes('[concept superseded]')) {
        const updatedProvenance = `${thread.provenance ?? ''}\n[CONCEPT SUPERSEDED: "${matchedConcept}" — user correction. Thread remains active with corrected context.]`;
        await supabaseAdmin
          .from('life_threads')
          .update({
            provenance: updatedProvenance,
            last_relevant_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', thread.id)
          .eq('user_id', userId);
        logger.info(`LifeThreadAgent: Concept superseded in thread ${thread.id}`, { userId, matchedConcept });
      }
    }
  }

  private buildPrompt(activeThreads: any[], activeActions: any[], recentChat: any[]): string {
    // BUG-04: Pre-filter candidate similar threads using Jaccard similarity
    const lastUserMsg = [...recentChat].reverse().find(m => m.role === 'user')?.content ?? '';
    const similarCandidates = activeThreads
      .map(t => ({ thread: t, score: jaccardSimilarity(t.topic ?? '', lastUserMsg) }))
      .filter(x => x.score >= JACCARD_CANDIDATE_THRESHOLD)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);

    const aboveLimit = activeThreads.length >= SOFT_THREAD_LIMIT;
    const softLimitNote = aboveLimit
      ? `\n⚠️ THREAD LIMIT WARNING: You already have ${activeThreads.length} active threads (soft limit: ${SOFT_THREAD_LIMIT}). Strongly prefer "update" or "complete" over "create" unless this is clearly a brand-new, unrelated goal.`
      : '';

    const candidateNote = similarCandidates.length > 0
      ? `\nSIMILAR THREADS DETECTED (Jaccard filter — these may be the same real-world goal):\n${similarCandidates.map(x => `  ID=${x.thread.id} topic="${x.thread.topic}" state=${x.thread.state} score=${x.score.toFixed(2)}`).join('\n')}\n⚠️ DEDUPLICATION RULE: If the current conversation clearly relates to the same real-world objective as any candidate above, emit "update" for that thread instead of "create". When uncertain, CREATE (preserve information — do not destroy a unique goal).`
      : '';

    // Amendment 3: Inject PAUSED threads so the LLM knows to resume rather than create duplicates
    const pausedThreads = activeThreads.filter(t => t.state === 'waiting');
    const pausedNote = pausedThreads.length > 0
      ? `\n⏸️ PAUSED THREADS (user previously put these goals on hold):
${pausedThreads.map(t => `  ID=${t.id} topic="${t.topic}" state=waiting`).join('\n')}

RULES FOR PAUSED THREADS:
1. Do NOT create a new duplicate thread for a goal that already exists above as "waiting".
2. RESUME: If the user explicitly says they are restarting, resuming, or scheduling a paused goal
   (e.g. "ab start karunga", "next month shuru karunga", "resume karte hain", "ab dobara shuru", "starting next month"),
   you MUST emit:
     action = "update"
     thread_id = <exact UUID from the paused thread above>
     state = "active"   ← THIS IS MANDATORY. Do not omit. Do not return "waiting".
   This un-pauses the thread. The goal is resuming, NOT being created fresh.
3. UNRELATED: If the latest conversation has nothing to do with a paused thread, emit "ignore" for it.

❌ INVALIDATED / SUPERSEDED CONCEPTS:
If a thread's provenance contains [CONCEPT SUPERSEDED: ...], it means that specific concept was factually corrected (e.g. "it's not a cloud kitchen, it's a fashion shop").
A temporal PAUSE (e.g. "putting it on hold", "abhi start nahi kar raha") is NOT a supersession.
Do NOT treat paused threads as unrelated just because they have historical pause notes in their provenance. Only a true factual invalidation prevents the old concept from being considered current.`
      : '';

    return `You are Nova's cognitive Action & Goal processor.
Your task is to identify if the user's latest messages created a new goal/thread, updated an existing one, completed one, or abandoned one.
AND you must decompose goals into explicitly trackable ACTIONS.

A "Life Thread" tracks unresolved plans, goals, commitments, or waiting states.
An "Action" is a concrete step required to advance or complete a Life Thread.
${softLimitNote}
${candidateNote}
${pausedNote}

All Threads (active, waiting, blocked):
${JSON.stringify(activeThreads.map(t => ({ id: t.id, topic: t.topic, state: t.state, provenance: (t.provenance ?? '').substring(0, 120) })), null, 2)}

Existing Active Actions:
${JSON.stringify(activeActions.map(a => ({ id: a.id, thread_id: a.source_thread_id, logical_key: a.logical_key, title: a.title, state: a.state, execution_class: a.execution_class })), null, 2)}

Recent Conversation:
${JSON.stringify(recentChat, null, 2)}

Based on the latest messages, decide the appropriate thread action:
- "create": user stated a brand-new goal/plan that does NOT overlap with any existing thread.
- "update": user added information to an existing thread, OR user explicitly resumed a PAUSED (waiting) thread. When resuming, set state="active".
- "complete": user indicated an existing thread is finished.
- "abandon": user explicitly dropped this goal (NOT just corrected a concept within it).
- "ignore": no meaningful thread activity.

IMPORTANT: A factual correction ("fashion ka shop nahi, tailor ka shop hai") does NOT mean abandon.
Only set abandon when the user clearly says they are giving up the underlying objective.

Also, extract ACTIONS related to the thread:
- If a goal has multiple steps, decompose them into 'create' operations with unique 'logical_key's.
- If the user finished a step ("I finalized the location"), 'complete' that action using its logical_key or action_id.
- If the user wants to cancel a step, 'cancel' it.

Execution Classes for Actions:
- SAFE_AUTOMATIC: Nova updates state internally.
- USER_VISIBLE_REVERSIBLE: Nova creates a calendar reminder or task via UI.
- CONFIRMATION_REQUIRED: Sending messages/emails, purchases, destructive actions.

Respond ONLY with a JSON object in this exact schema:
{
  "action": "create" | "update" | "complete" | "abandon" | "ignore",
  "thread_id": "UUID of existing thread if updating/completing/abandoning/resuming",
  "topic": "Short descriptive topic (if creating)",
  "state": "active | waiting | blocked | completed | abandoned",
  "priority": "low | medium | high",
  "provenance": "Brief explanation of what changed",
  "reason": "Why you chose this action",
  "actions": [
    {
      "operation": "create" | "update" | "complete" | "cancel" | "ignore",
      "action_id": "UUID if updating existing",
      "logical_key": "snake_case_stable_id (e.g. 'finalize_location')",
      "title": "Short title",
      "description": "Details",
      "state": "suggested | pending_confirmation | scheduled | in_progress | completed | cancelled | blocked",
      "execution_class": "SAFE_AUTOMATIC | USER_VISIBLE_REVERSIBLE | CONFIRMATION_REQUIRED",
      "priority": "low | medium | high",
      "due_at": "ISO date or null",
      "dependency_keys": ["other_logical_key"],
      "provenance": "Reason for action"
    }
  ]
}`;
  }

  private async applyUpdate(userId: string, update: LifeThreadUpdate, activeThreads: any[], activeActions: any[], sourceMessageId?: string, recentChat: any[] = []): Promise<void> {
    let resolvedThreadId = update.thread_id;

    if (update.action === 'ignore') {
      // Nothing to do
    } else {
      // ── FIX 1: Compute explicit-resume BEFORE branching on action ───────────
      // This ensures the resume redirect runs even when LLM returns action=create.
      const reversedChat = [...recentChat].reverse();
      const lastUserMsg = reversedChat.find((m: any) => m.role === 'user')?.content || '';
      const isExplicitResume = detectExplicitResume(lastUserMsg);

      // ── FIX 2: For action=create, intercept when an explicit resume matches a waiting thread ──
      // This catches the case where the LLM emits "create" because the Jaccard filter
      // suppressed the waiting thread from the deduplication hint block.
      if (update.action === 'create' && isExplicitResume) {
        const waitingThreads = activeThreads.filter(t => t.state === 'waiting');
        const resumeCandidate = findBestWaitingCandidate(waitingThreads, lastUserMsg);
        if (resumeCandidate) {
          logger.info(`LifeThreadAgent[RESUME_REDIRECT]: LLM returned "create" but explicit resume detected. Redirecting to update thread "${resumeCandidate.topic}" (${resumeCandidate.id})`, { userId });
          // Mutate the payload to redirect to resume
          update = {
            ...update,
            action: 'update',
            thread_id: resumeCandidate.id,
            state: 'active',
          };
        }
      }

      if (update.action === 'create' && update.topic) {
        // ── FIX 3: Last-chance safety — even without explicit resume, prevent duplicate
        // creation if a WAITING thread has substantial token overlap with the new topic.
        const waitingThreads = activeThreads.filter(t => t.state === 'waiting');
        const duplicateCandidate = findBestWaitingCandidate(waitingThreads, update.topic);
        if (duplicateCandidate) {
          logger.warn(`LifeThreadAgent[DEDUP_GUARD]: Blocking create for "${update.topic}" — waiting thread "${duplicateCandidate.topic}" (${duplicateCandidate.id}) already exists for same concept. LLM should have returned update.`, { userId });
          // Do not insert. The existing waiting thread remains; this turn simply does not duplicate it.
        } else {
          const { data: newThread } = await supabaseAdmin.from('life_threads').insert({
            user_id: userId,
            topic: update.topic,
            state: update.state || 'active',
            priority: update.priority || 'medium',
            provenance: update.provenance,
            last_relevant_at: new Date().toISOString()
          }).select('id').single();
          if (newThread) {
            resolvedThreadId = newThread.id;
            logger.info(`LifeThreadAgent: Created thread "${update.topic}" for user ${userId}`);
          }
        }
      } else if ((update.action === 'update' || update.action === 'complete' || update.action === 'abandon') && update.thread_id) {
        const targetThread = activeThreads.find(t => t.id === update.thread_id);
        if (targetThread) {
          const prevState = targetThread.state as string;

          let nextState = update.action === 'complete' ? 'completed'
                          : update.action === 'abandon' ? 'abandoned'
                          : update.state || targetThread.state;

          // Force active if deterministically resumed (handles LLM omitting state=active on an update)
          if (prevState === 'waiting' && isExplicitResume && update.action === 'update' && (!update.state || update.state === 'waiting')) {
            nextState = 'active';
          }

          // ── FIX 4: Build provenance by APPENDING state-transition note — never overwrite ──
          const today = new Date().toISOString().slice(0, 10);
          let provenanceNote = update.provenance ?? '';
          if (nextState !== prevState) {
            const transitionLabel = nextState === 'active' && prevState === 'waiting'
              ? `[RESUMED by user: "${lastUserMsg.substring(0, 80)}" — ${today}]\n[STATE TRANSITION: waiting -> active]`
              : nextState === 'waiting'
              ? `[PAUSED — ${today}]\n[STATE TRANSITION: ${prevState} -> waiting]`
              : nextState === 'abandoned'
              ? `[ABANDONED — ${today}]\n[STATE TRANSITION: ${prevState} -> abandoned]`
              : `[STATE TRANSITION: ${prevState} -> ${nextState} — ${today}]`;
            provenanceNote = provenanceNote
              ? `${provenanceNote}\n${transitionLabel}`
              : transitionLabel;
          }
          const newProvenance = (targetThread.provenance ?? '') + (provenanceNote ? `\n${provenanceNote}` : '');

          // ── FIX 7: Concurrency guard — conditionally update based on expected prior state ──
          // For resumes, only update if still in waiting. For completions/abandons, only if not already terminal.
          let stateConditionColumn: string | null = null;
          let stateConditionValue: string | null = null;
          if (nextState === 'active' && prevState === 'waiting') {
            // Resume: only proceed if still waiting (guard against stale writes)
            stateConditionColumn = 'state';
            stateConditionValue = 'waiting';
          }

          let updateQuery = supabaseAdmin.from('life_threads')
            .update({
              state: nextState,
              provenance: newProvenance,
              last_relevant_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            })
            .eq('id', update.thread_id)
            .eq('user_id', userId);

          if (stateConditionColumn && stateConditionValue) {
            updateQuery = (updateQuery as any).eq(stateConditionColumn, stateConditionValue);
          }

          const { error: updateErr, count } = await (updateQuery as any).select('id');

          if (updateErr) {
            throw new Error(`LifeThreadAgent[DB_UPDATE_FAILURE]: ${updateErr.message ?? JSON.stringify(updateErr)}`);
          }

          // Stale-state guard: 0 rows means the state already changed between when we read it and now
          if (count === 0 && stateConditionValue) {
            logger.warn(`LifeThreadAgent[STALE_STATE]: Thread ${update.thread_id} was no longer in state "${stateConditionValue}" when resume write was attempted. Write skipped to avoid stale overwrite.`, { userId, nextState });
          } else {
            logger.info(`LifeThreadAgent: Updated thread ${update.thread_id} to ${nextState} for user ${userId}`);
          }

          resolvedThreadId = update.thread_id;

          // If thread completed/abandoned, automatically cancel pending actions
          if (nextState === 'completed' || nextState === 'abandoned') {
            await supabaseAdmin.from('nova_actions')
              .update({ state: nextState === 'completed' ? 'completed' : 'cancelled', updated_at: new Date().toISOString() })
              .eq('source_thread_id', update.thread_id)
              .in('state', ['suggested', 'pending_confirmation', 'scheduled', 'in_progress', 'blocked']);
          }
        }
      }
    }

    if (update.actions && Array.isArray(update.actions)) {
      for (const act of update.actions) {
        if (act.operation === 'ignore') continue;

        if (act.operation === 'create' && act.logical_key) {
          const existing = activeActions.find(a => a.logical_key === act.logical_key);
          if (!existing) {
            await supabaseAdmin.from('nova_actions').insert({
              user_id: userId,
              logical_key: act.logical_key,
              title: act.title || act.logical_key,
              description: act.description,
              state: act.state || 'suggested',
              priority: act.priority || 'medium',
              execution_class: act.execution_class || 'SAFE_AUTOMATIC',
              source_thread_id: resolvedThreadId,
              source_message_id: sourceMessageId,
              due_at: act.due_at,
              provenance: act.provenance
            });
            logger.info(`LifeThreadAgent: Created action ${act.logical_key}`);
          }
        } else if ((act.operation === 'update' || act.operation === 'complete' || act.operation === 'cancel') && (act.action_id || act.logical_key)) {
          const existing = activeActions.find(a => a.id === act.action_id || a.logical_key === act.logical_key);
          if (existing) {
            const nextState = act.operation === 'complete' ? 'completed'
                            : act.operation === 'cancel' ? 'cancelled'
                            : act.state || existing.state;

            await supabaseAdmin.from('nova_actions')
              .update({
                state: nextState,
                title: act.title || existing.title,
                description: act.description || existing.description,
                due_at: act.due_at || existing.due_at,
                updated_at: new Date().toISOString()
              })
              .eq('id', existing.id);
            logger.info(`LifeThreadAgent: Updated action ${existing.id} to ${nextState}`);
          }
        }
      }
    }
  }
}

export const lifeThreadAgent = new LifeThreadAgent();
