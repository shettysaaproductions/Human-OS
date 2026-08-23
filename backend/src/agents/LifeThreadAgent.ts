import { supabaseAdmin } from '../lib/supabase';
import { chatCompletionBackground } from '../lib/nvidia';
import { logger } from '../lib/logger';

interface LifeThreadUpdate {
  action: 'create' | 'update' | 'complete' | 'abandon' | 'ignore';
  thread_id?: string;
  topic?: string;
  state?: 'active' | 'waiting' | 'blocked' | 'completed' | 'abandoned';
  priority?: 'low' | 'medium' | 'high';
  provenance?: string;
  reason?: string;
}

export class LifeThreadAgent {
  async processJob(job: any): Promise<void> {
    const { user_id, turn_context } = job.payload;
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

    // 2. Fetch last 5 messages for context
    const { data: recentMessages } = await supabaseAdmin
      .from('chat_history')
      .select('role, content')
      .eq('user_id', user_id)
      .order('created_at', { ascending: false })
      .limit(5);
      
    const recentChat = (recentMessages || []).reverse();
    if (recentChat.length === 0) return; // Nothing to process

    // 3. Prompt LLM to analyze the context against existing threads
    const prompt = this.buildPrompt(activeThreads || [], recentChat);
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
    await this.applyUpdate(user_id, result, activeThreads || []);
  }

  private buildPrompt(activeThreads: any[], recentChat: any[]): string {
    return `You are Nova's cognitive background processor. Your task is to identify if the user's latest messages created a new meaningful goal/thread, updated an existing one, completed one, or abandoned one.
A "Life Thread" tracks unresolved plans, goals, commitments, or waiting states. Do NOT create threads for transient chat or trivial facts.

Existing Active Threads:
${JSON.stringify(activeThreads.map(t => ({ id: t.id, topic: t.topic, state: t.state })), null, 2)}

Recent Conversation:
${JSON.stringify(recentChat, null, 2)}

Based on the latest messages, decide the appropriate action:
- "create": user stated a new meaningful goal, commitment, or pending plan.
- "update": user added information to an existing thread.
- "complete": user indicated an existing thread is finished.
- "abandon": user dropped an existing thread.
- "ignore": no meaningful thread activity.

Respond ONLY with a JSON object in this exact schema:
{
  "action": "create" | "update" | "complete" | "abandon" | "ignore",
  "thread_id": "UUID of existing thread if updating/completing/abandoning",
  "topic": "Short descriptive topic (if creating)",
  "state": "active | waiting | blocked | completed | abandoned",
  "priority": "low | medium | high",
  "provenance": "Brief explanation of what happened or changed",
  "reason": "Why you chose this action"
}`;
  }

  private async applyUpdate(userId: string, update: LifeThreadUpdate, activeThreads: any[]): Promise<void> {
    if (update.action === 'ignore') return;

    if (update.action === 'create' && update.topic) {
      await supabaseAdmin.from('life_threads').insert({
        user_id: userId,
        topic: update.topic,
        state: update.state || 'active',
        priority: update.priority || 'medium',
        provenance: update.provenance,
        last_relevant_at: new Date().toISOString()
      });
      logger.info(`LifeThreadAgent: Created thread "${update.topic}" for user ${userId}`);
    } 
    else if ((update.action === 'update' || update.action === 'complete' || update.action === 'abandon') && update.thread_id) {
      // Verify the thread belongs to the user and exists
      const targetThread = activeThreads.find(t => t.id === update.thread_id);
      if (!targetThread) {
        logger.warn(`LifeThreadAgent: Attempted to modify unknown thread ${update.thread_id}`);
        return;
      }
      
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
    }
  }
}

export const lifeThreadAgent = new LifeThreadAgent();
