import { supabaseAdmin } from '../lib/supabase';
import { chatCompletionBackground } from '../lib/nvidia';
import { logger } from '../lib/logger';


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
  async processJob(job: any): Promise<void> {
    const { user_id, turn_context, message_id } = job.payload;
    if (!user_id || !turn_context) {
      throw new Error('LifeThreadAgent: Missing user_id or turn_context');
    }

    // 1. Fetch active threads
    const { data: activeThreads, error: fetchErr } = await supabaseAdmin
      .from('life_threads')
      .select('*')
      .eq('user_id', user_id)
      .in('state', ['active', 'waiting', 'blocked']);
      
    if (fetchErr) throw fetchErr;

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

    // 3. Prompt LLM to analyze
    const prompt = this.buildPrompt(activeThreads || [], activeActions || [], recentChat);
    const responseText = await chatCompletionBackground([
      { role: 'user', content: prompt }
    ], { temperature: 0.1 });
    
    // 4. Parse the action
    let result: LifeThreadUpdate;
    try {
      const jsonMatch = responseText.match(/```json\n([\s\S]*?)\n```/) || responseText.match(/\{[\s\S]*\}/);
      const jsonStr = jsonMatch ? jsonMatch[0].replace(/```json|```/g, '') : responseText;
      result = JSON.parse(jsonStr) as LifeThreadUpdate;
    } catch (e) {
      logger.error('LifeThreadAgent: Failed to parse LLM response', { responseText });
      return;
    }

    // 5. Apply the action deterministically
    await this.applyUpdate(user_id, result, activeThreads || [], activeActions || [], message_id);
  }

  private buildPrompt(activeThreads: any[], activeActions: any[], recentChat: any[]): string {
    return `You are Nova's cognitive Action & Goal processor. 
Your task is to identify if the user's latest messages created a new goal/thread, updated an existing one, completed one, or abandoned one.
AND you must decompose goals into explicitly trackable ACTIONS.

A "Life Thread" tracks unresolved plans, goals, commitments, or waiting states.
An "Action" is a concrete step required to advance or complete a Life Thread.

Existing Active Threads:
${JSON.stringify(activeThreads.map(t => ({ id: t.id, topic: t.topic, state: t.state })), null, 2)}

Existing Active Actions:
${JSON.stringify(activeActions.map(a => ({ id: a.id, thread_id: a.source_thread_id, logical_key: a.logical_key, title: a.title, state: a.state, execution_class: a.execution_class })), null, 2)}

Recent Conversation:
${JSON.stringify(recentChat, null, 2)}

Based on the latest messages, decide the appropriate thread action:
- "create": user stated a new meaningful goal/plan.
- "update": user added information to an existing thread.
- "complete": user indicated an existing thread is finished.
- "abandon": user dropped an existing thread.
- "ignore": no meaningful thread activity.

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
  "thread_id": "UUID of existing thread if updating/completing/abandoning",
  "topic": "Short descriptive topic (if creating)",
  "state": "active | waiting | blocked | completed | abandoned",
  "priority": "low | medium | high",
  "provenance": "Brief explanation",
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

  private async applyUpdate(userId: string, update: LifeThreadUpdate, activeThreads: any[], activeActions: any[], sourceMessageId?: string): Promise<void> {
    let resolvedThreadId = update.thread_id;

    if (update.action !== 'ignore') {
      if (update.action === 'create' && update.topic) {
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
      else if ((update.action === 'update' || update.action === 'complete' || update.action === 'abandon') && update.thread_id) {
        const targetThread = activeThreads.find(t => t.id === update.thread_id);
        if (targetThread) {
          const nextState = update.action === 'complete' ? 'completed' 
                          : update.action === 'abandon' ? 'abandoned' 
                          : update.state || targetThread.state;

          await supabaseAdmin.from('life_threads')
            .update({
              state: nextState,
              provenance: update.provenance || targetThread.provenance,
              last_relevant_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            })
            .eq('id', update.thread_id)
            .eq('user_id', userId);
            
          logger.info(`LifeThreadAgent: Updated thread ${update.thread_id} to ${nextState} for user ${userId}`);
          
          // If thread completed/abandoned, automatically cancel pending actions if they are SAFE_AUTOMATIC
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
