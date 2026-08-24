import { supabaseAdmin } from '../lib/supabase';
import { logger } from '../lib/logger';

export interface ActionRecord {
  id: string;
  user_id: string;
  logical_key: string;
  title: string;
  description: string;
  state: 'suggested' | 'pending_confirmation' | 'scheduled' | 'in_progress' | 'completed' | 'cancelled' | 'blocked';
  priority: 'low' | 'medium' | 'high';
  execution_class: 'SAFE_AUTOMATIC' | 'USER_VISIBLE_REVERSIBLE' | 'CONFIRMATION_REQUIRED';
  source_thread_id: string;
  due_at: string | null;
  dependency_ids: string[];
}

export class ActionIntelligenceService {
  /**
   * Evaluates all active actions for a given thread (or user) to determine the next best action.
   */
  async getNextBestAction(userId: string, threadId?: string): Promise<{ type: 'NEXT_BEST_ACTION', action: ActionRecord } | { type: 'NO_ACTION' }> {
    let query = supabaseAdmin
      .from('nova_actions')
      .select('*')
      .eq('user_id', userId)
      .in('state', ['suggested', 'pending_confirmation', 'scheduled', 'in_progress', 'blocked']);
      
    if (threadId) {
      query = query.eq('source_thread_id', threadId);
    }
    
    const { data: actions, error } = await query;
    if (error || !actions || actions.length === 0) {
      return { type: 'NO_ACTION' };
    }

    const typedActions = actions as ActionRecord[];
    
    // Evaluate Readiness based on Dependencies
    // An action is ready if it has no dependencies, OR if all its dependencies are 'completed'
    const readyActions = typedActions.filter(action => this.isActionReady(action, typedActions));
    
    if (readyActions.length === 0) {
      return { type: 'NO_ACTION' };
    }

    // Rank actions:
    // 1. Priority (high > medium > low)
    // 2. Due date (earlier > later, null goes last)
    readyActions.sort((a, b) => {
      const pMap = { high: 3, medium: 2, low: 1 };
      const pA = pMap[a.priority] || 2;
      const pB = pMap[b.priority] || 2;
      
      if (pA !== pB) return pB - pA;
      
      if (a.due_at && !b.due_at) return -1;
      if (!a.due_at && b.due_at) return 1;
      if (a.due_at && b.due_at) {
        return new Date(a.due_at).getTime() - new Date(b.due_at).getTime();
      }
      return 0;
    });

    return { type: 'NEXT_BEST_ACTION', action: readyActions[0] };
  }

  private isActionReady(action: ActionRecord, allActiveActions: ActionRecord[]): boolean {
    if (!action.dependency_ids || action.dependency_ids.length === 0) return true;
    
    // If any dependency is still in the active list (i.e. not completed/cancelled), this action is blocked
    for (const depId of action.dependency_ids) {
      if (allActiveActions.some(a => a.id === depId)) {
        return false;
      }
    }
    return true;
  }
  
  /**
   * Idempotent confirmation-required execution wrapper.
   */
  async executeConfirmedAction(actionId: string, userId: string): Promise<boolean> {
    const { data: action } = await supabaseAdmin
      .from('nova_actions')
      .select('*')
      .eq('id', actionId)
      .eq('user_id', userId)
      .single();
      
    if (!action) return false;
    if (action.state === 'completed' || action.state === 'cancelled') return false;
    
    // Here we would route to the appropriate execution engine based on the action details
    // For now, we simulate success and mark completed.
    logger.info(`[ActionIntelligence] Executing confirmed action ${actionId}: ${action.title}`);
    
    await supabaseAdmin.from('nova_actions')
      .update({ state: 'completed', updated_at: new Date().toISOString() })
      .eq('id', actionId);
      
    return true;
  }
}

export const actionIntelligenceService = new ActionIntelligenceService();
