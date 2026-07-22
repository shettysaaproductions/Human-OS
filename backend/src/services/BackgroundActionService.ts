import { logger } from '../lib/logger';
import { supabaseAdmin } from '../lib/supabase';
const TIMEZONE_OFFSETS: Record<string, number> = {
  IN: 5.5,
  US: -5,
  UK: 0,
};

export class BackgroundActionService {
  async processActions(userId: string, conversationId: string, actions: any[], userCountry: string) {
    if (!actions || actions.length === 0) return;

    for (const action of actions) {
      try {
        if (action.tool === 'ReminderEngine' && action.action === 'schedule') {
          const userTzOffset = TIMEZONE_OFFSETS[userCountry] ?? 5.5;
          const { ReminderEngine } = await import('./ReminderEngine');
          const engine = new ReminderEngine(userTzOffset);

          // Support array of reminders or single reminder data
          let specs = action.data.reminders || [action.data];
          if (!Array.isArray(specs)) specs = [specs];

          const allScheduled: any[] = [];
          for (const spec of specs) {
            const parsedList = engine.parse(spec);
            const inserted = await engine.scheduleAll(userId, parsedList);
            allScheduled.push(...inserted);
          }
          logger.info('[BackgroundAction] Scheduled reminders', { userId, count: allScheduled.length });
        }
        else if (action.tool === 'MomentEngine' && action.action === 'extract') {
           // Insert into a pending queue or process directly
           // We will implement this later when we refactor MomentEngine
           logger.info('[BackgroundAction] Extracted moment', action.data);
        }
        else if (action.tool === 'MemoryRepository' && action.action === 'save') {
           // Direct save
           logger.info('[BackgroundAction] Saving memory', action.data);
           await supabaseAdmin.from('memories').upsert({
             user_id: userId,
             key: action.data.key,
             value: action.data.value,
             memory_type: 'semantic',
             updated_at: new Date().toISOString()
           });
        }
        else if (action.tool === 'NovaFollowupService' && action.action === 'queue') {
           const { novaFollowupService } = await import('./NovaFollowupService');
           await novaFollowupService.queueFollowup(userId, conversationId, action.data.question, action.data.delay_hours);
        }
        else if (action.tool === 'LifeEventExtractor' && action.action === 'event') {
           const expectedTime = new Date(action.data.expected_time);
           if (!isNaN(expectedTime.getTime())) {
             const followUpMinutes = Math.min(Math.max(action.data.follow_up_after_minutes || 60, 15), 24 * 60);
             const followUpAfter = new Date(expectedTime.getTime() + followUpMinutes * 60 * 1000);
             if (followUpAfter.getTime() > Date.now()) {
               await supabaseAdmin.from('nova_agenda').insert({
                 user_id: userId,
                 event_description: action.data.description.substring(0, 500),
                 expected_time: expectedTime.toISOString(),
                 follow_up_question: action.data.follow_up_question?.substring(0, 500) || `How did the ${action.data.description} go?`,
                 follow_up_after: followUpAfter.toISOString(),
                 source_message: 'Extracted by Brain',
                 status: 'pending',
                 next_retry_at: followUpAfter.toISOString(),
                 urgency: action.data.urgency || 'medium',
                 is_recurring: action.data.is_recurring || false,
               });
               logger.info('[BackgroundAction] Stored agenda event', { userId, event: action.data.description });
             }
           }
        }
        else if (action.tool === 'LifeEventExtractor' && action.action === 'routine') {
           await supabaseAdmin.from('user_routines').insert({
             user_id: userId,
             routine_type: action.data.routineType || 'general',
             description: action.data.description.substring(0, 500),
             confidence: 80,
           });
           logger.info('[BackgroundAction] Stored user routine', { userId, routine: action.data.description });
        }
        else if (action.tool === 'AgendaManager' && action.action === 'update_status') {
          const { data: items } = await supabaseAdmin
            .from('nova_agenda')
            .select('id, event_description')
            .eq('user_id', userId)
            .in('status', ['pending', 'active'])
            .order('created_at', { ascending: false })
            .limit(10);
            
          if (items && items.length > 0) {
            const keywords = action.data.task_description.toLowerCase().split(' ').filter((w: string) => w.length > 3);
            let bestMatch = items[0];
            for (const item of items) {
              const desc = item.event_description.toLowerCase();
              if (keywords.some((kw: string) => desc.includes(kw))) {
                bestMatch = item;
                break;
              }
            }
            await supabaseAdmin.from('nova_agenda')
              .update({ status: action.data.status, updated_at: new Date().toISOString() })
              .eq('id', bestMatch.id);
            logger.info('[BackgroundAction] Updated agenda item status', { userId, id: bestMatch.id, status: action.data.status });
          }
        }
      } catch (err) {
        logger.error(`[BackgroundAction] Failed executing ${action.tool}.${action.action}`, { err: err instanceof Error ? err.message : String(err) });
      }
    }
  }
}

export const backgroundActions = new BackgroundActionService();
