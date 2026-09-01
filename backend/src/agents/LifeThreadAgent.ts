import { supabaseAdmin } from '../lib/supabase';
import { chatCompletionBackground } from '../lib/nvidia';
import { logger } from '../lib/logger';
import { lifeThreadRepository, LifeThreadRow } from '../services/lifeThreadRepository';
import { isSameCanonicalThread } from '../lib/lifeThreadKeySchema';

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
    const turnId = turn_context?.turnId || job.payload?.turnId;

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

    // 1. Fetch active threads via Single Writer Repository
    let activeThreads: LifeThreadRow[] = [];
    try {
      activeThreads = await lifeThreadRepository.getActiveThreads(user_id);
    } catch (fetchErr: any) {
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
    const negatedConcepts: string[] = turn_context?.negativeCorrectionConcepts || [];
    if (negatedConcepts.length > 0 && activeThreads && activeThreads.length > 0) {
      await this.updateThreadProvenanceForCorrection(user_id, activeThreads, negatedConcepts, turnId);
    }

    // 3. Prompt LLM to analyze (with canonical identity & dedup context injected)
    const threads = activeThreads || [];
    const prompt = this.buildPrompt(threads, activeActions || [], recentChat);
    let responseText: string;
    try {
      responseText = await chatCompletionBackground([
        { role: 'user', content: prompt }
      ], { temperature: 0.1 });
    } catch (llmErr: any) {
      throw new Error(`LifeThreadAgent[EXTRACTION_FAILURE]: LLM call failed — ${llmErr?.message ?? String(llmErr)}`);
    }

    // 4. Parse the action
    let result: LifeThreadUpdate;
    try {
      const jsonMatch = responseText.match(/```json\n([\s\S]*?)\n```/) || responseText.match(/\{[\s\S]*\}/);
      const jsonStr = jsonMatch ? jsonMatch[0].replace(/```json|```/g, '') : responseText;
      result = JSON.parse(jsonStr) as LifeThreadUpdate;
    } catch (e: any) {
      throw new Error(`LifeThreadAgent[APPLICATION_EXCEPTION]: JSON parse failed — ${e?.message ?? String(e)} | raw: ${responseText?.slice(0, 200)}`);
    }

    // 5. Apply the action deterministically via Repository
    await this.applyUpdate(user_id, result, threads, activeActions || [], message_id, turnId, recentChat);
  }

  /**
   * Deterministic thread suppression (Amendment 3).
   * Called from queue worker after a negation is detected.
   */
  async processSuppressJob(job: any): Promise<void> {
    const { user_id, negated_concept, reason, is_current, turnId } = job.payload || {};
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

    const suppressed = await lifeThreadRepository.suppressThreadByConcept(
      user_id,
      negated_concept,
      is_current !== false,
      {
        turnId: turnId || job.payload?.turn_id,
        sourceAuthority: 'deterministic_turn_analysis',
        reason: reason || `Negated concept: "${negated_concept}"`
      }
    );

    logger.info(`LifeThreadAgent[SUPPRESS]: Suppressed ${suppressed} threads matching "${negated_concept}"`, {
      userId: user_id, isCurrent: is_current
    });
  }

  /**
   * BUG-06 / Amendment 3: Mark concepts as superseded within active threads.
   */
  private async updateThreadProvenanceForCorrection(
    userId: string,
    activeThreads: any[],
    negatedConcepts: string[],
    turnId?: string
  ): Promise<void> {
    for (const thread of activeThreads) {
      const topicLower = (thread.topic ?? '').toLowerCase();
      const provLower = (thread.provenance ?? '').toLowerCase();
      const matchedConcept = negatedConcepts.find(c =>
        topicLower.includes(c) || provLower.includes(c)
      );
      if (matchedConcept && !provLower.includes('[concept superseded]')) {
        await lifeThreadRepository.createOrUpdateThread(
          userId,
          {
            threadId: thread.id,
            topic: thread.topic,
            provenance: thread.provenance
          },
          {
            turnId,
            sourceAuthority: 'deterministic_turn_analysis',
            provenanceNote: `[CONCEPT SUPERSEDED: "${matchedConcept}" — user correction]`,
            scrubbedConcept: matchedConcept
          }
        );
        logger.info(`LifeThreadAgent: Concept superseded in thread ${thread.id}`, { userId, matchedConcept });
      }
    }
  }

  private buildPrompt(activeThreads: any[], activeActions: any[], recentChat: any[]): string {
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
      ? `\nSIMILAR THREADS DETECTED (these may be the same real-world goal):\n${similarCandidates.map(x => `  ID=${x.thread.id} topic="${x.thread.topic}" canonical_key="${x.thread.canonical_key || ''}" state=${x.thread.state} score=${x.score.toFixed(2)}`).join('\n')}\n⚠️ DEDUPLICATION RULE: If the current conversation relates to the same real-world objective as any candidate above, emit "update" for that thread instead of "create".`
      : '';

    const pausedThreads = activeThreads.filter(t => t.state === 'waiting');
    const pausedNote = pausedThreads.length > 0
      ? `\n⏸️ PAUSED THREADS (user previously put these goals on hold):
${pausedThreads.map(t => `  ID=${t.id} topic="${t.topic}" canonical_key="${t.canonical_key || ''}" state=waiting`).join('\n')}

RULES FOR PAUSED THREADS:
1. Do NOT create a new duplicate thread for a goal that already exists above as "waiting".
2. RESUME: If the user explicitly says they are restarting, resuming, or scheduling a paused goal, you MUST emit:
     action = "update"
     thread_id = <exact UUID from the paused thread above>
     state = "active"
3. UNRELATED: If the conversation has nothing to do with a paused thread, emit "ignore" for it.`
      : '';

    return `You are Nova's cognitive Action & Goal processor.
Your task is to identify if the user's latest messages created a new goal/thread, updated an existing one, completed one, or abandoned one.
AND you must decompose goals into explicitly trackable ACTIONS.

A "Life Thread" tracks unresolved plans, goals, commitments, or waiting states.
An "Action" is a concrete step required to advance or complete a Life Thread.

CRITICAL RULE - ADMISSION THRESHOLD:
DO NOT create LifeThreads for trivial, short-lived, or single-step tasks (e.g., "call plumber tomorrow", "remind me to buy milk"). ONLY create a LifeThread for complex, multi-day, or emotionally significant ongoing goals that require multiple steps to complete. For simple tasks or casual conversation, emit "ignore".

${softLimitNote}
${candidateNote}
${pausedNote}

All Threads (active, waiting, blocked):
${JSON.stringify(activeThreads.map(t => ({ id: t.id, topic: t.topic, canonical_key: t.canonical_key, state: t.state, provenance: (t.provenance ?? '').substring(0, 120) })), null, 2)}

Existing Active Actions:
${JSON.stringify(activeActions.map(a => ({ id: a.id, thread_id: a.source_thread_id, logical_key: a.logical_key, title: a.title, state: a.state, execution_class: a.execution_class })), null, 2)}

Recent Conversation:
${JSON.stringify(recentChat, null, 2)}

Based on the latest messages, decide the appropriate thread action:
- "create": user stated a brand-new complex, multi-day goal/plan that does NOT overlap with any existing thread.
- "update": user added information to an existing thread, OR user explicitly resumed a PAUSED (waiting) thread. When resuming, set state="active".
- "complete": user indicated an existing thread is finished.
- "abandon": user explicitly dropped this goal (NOT just corrected a concept within it).
- "ignore": casual conversation, simple single-step tasks, or no meaningful thread activity.

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

  private async applyUpdate(
    userId: string,
    update: LifeThreadUpdate,
    activeThreads: any[],
    activeActions: any[],
    sourceMessageId?: string,
    turnId?: string,
    recentChat: any[] = []
  ): Promise<void> {
    let resolvedThreadId = update.thread_id;

    if (update.action === 'ignore') {
      // Nothing to do
    } else {
      const reversedChat = [...recentChat].reverse();
      const lastUserMsg = reversedChat.find((m: any) => m.role === 'user')?.content || '';
      const isExplicitResume = detectExplicitResume(lastUserMsg);

      // Handle resume intercept or DEDUP_GUARD if LLM emitted create for an existing waiting thread
      if (update.action === 'create' && update.topic) {
        const topicStr = update.topic;
        const waitingThreads = activeThreads.filter(t => t.state === 'waiting');
        const resumeCandidate = isExplicitResume
          ? (findBestWaitingCandidate(waitingThreads, lastUserMsg) || waitingThreads.find(t => isSameCanonicalThread(topicStr, t.topic || '')))
          : waitingThreads.find(t => isSameCanonicalThread(topicStr, t.topic || '') || jaccardSimilarity(topicStr, t.topic || '') >= 0.25);

        if (resumeCandidate) {
          if (isExplicitResume) {
            logger.info(`LifeThreadAgent[RESUME_REDIRECT]: Redirecting create to update thread "${resumeCandidate.topic}"`, { userId });
            update = {
              ...update,
              action: 'update',
              thread_id: resumeCandidate.id,
              state: 'active',
            };
          } else {
            logger.info(`LifeThreadAgent[DEDUP_GUARD]: Skipping create for topic "${update.topic}" as it matches waiting thread "${resumeCandidate.topic}" without resume intent`, { userId });
            return;
          }
        }
      }

      // Route all thread mutations through LifeThreadRepository (Single Writer)
      if ((update.action === 'update' || update.action === 'complete' || update.action === 'abandon') && update.thread_id) {
        const targetThread = activeThreads.find(t => t.id === update.thread_id);
        const nextState = update.action === 'complete' ? 'completed'
                        : update.action === 'abandon' ? 'abandoned'
                        : (isExplicitResume && targetThread?.state === 'waiting' ? 'active' : update.state || targetThread?.state);

        const result = await lifeThreadRepository.createOrUpdateThread(
          userId,
          {
            threadId: update.thread_id,
            topic: update.topic || targetThread?.topic || '',
            state: nextState,
            priority: update.priority || targetThread?.priority,
            provenance: update.provenance
          },
          {
            turnId,
            sourceMessageId,
            sourceAuthority: isExplicitResume ? 'deterministic_turn_analysis' : 'llm_proposal',
            isExplicitResume,
            contextText: lastUserMsg,
            existingThread: targetThread
          }
        );
        resolvedThreadId = result.thread.id;
      } else if (update.action === 'create' && update.topic) {
        const topicStr = update.topic;
        const existingActive = activeThreads.find(t => isSameCanonicalThread(topicStr, t.topic || ''));
        const result = await lifeThreadRepository.createOrUpdateThread(
          userId,
          {
            threadId: existingActive?.id,
            topic: topicStr,
            state: update.state || 'active',
            priority: update.priority || 'medium',
            provenance: update.provenance
          },
          {
            turnId,
            sourceMessageId,
            sourceAuthority: isExplicitResume ? 'deterministic_turn_analysis' : 'llm_proposal',
            isExplicitResume,
            contextText: lastUserMsg,
            existingThread: existingActive
          }
        );
        resolvedThreadId = result.thread.id;
      }
    }



    // Process Actions via nova_actions table
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

