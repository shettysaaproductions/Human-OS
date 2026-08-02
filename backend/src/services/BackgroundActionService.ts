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
           // Save to short_term_memories with deduplication
           const memString = action.data.memory || action.data.summary || action.data.key || action.data.moment;
           if (!memString) continue;

           // Dedupe: check if exact memory was saved in last 10 mins
           const tenMinsAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
           const { data: existing } = await supabaseAdmin
             .from('short_term_memories')
             .select('id')
             .eq('user_id', userId)
             .eq('memory', memString)
             .gte('created_at', tenMinsAgo)
             .limit(1);

           if (existing && existing.length > 0) {
             logger.info('[BackgroundAction] Skipped duplicate short-term memory', { memString });
             continue;
           }

           logger.info('[BackgroundAction] Saving short-term memory', action.data);
           await supabaseAdmin.from('short_term_memories').insert({
             user_id: userId,
             memory: memString,
             emotion: action.data.emotion || 'neutral',
             importance: action.data.importance || 5,
             confidence: action.data.confidence || 0.8
           });
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
        else if (action.tool === 'AgendaManager' && action.action === 'add') {
           const { data: profile } = await supabaseAdmin.from('profiles').select('timezone_offset').eq('id', userId).maybeSingle();
           const tzOffset = profile?.timezone_offset || 0;
           
           let followUpIso = null;
           try {
             const { novaBrain } = await import('./NovaBrainService');
             // Try to extract exact completion time via LLM based on task description
             followUpIso = await novaBrain.extractTimeFromRoutine(action.data.task_description, tzOffset);
           } catch (e) {
             logger.warn('[BackgroundAction] Failed to extract time for implicit agenda', { error: e });
           }

           // Fallback to 4 hours if the LLM couldn't determine a time
           let followUpAfter = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(); 
           if (followUpIso) {
             const parsedTarget = new Date(followUpIso);
             // If the parsed time is in the future, use it!
             if (parsedTarget.getTime() > Date.now()) {
               followUpAfter = followUpIso;
             }
           }

           await supabaseAdmin.from('nova_agenda').insert({
             user_id: userId,
             event_description: action.data.task_description.substring(0, 500),
             expected_time: new Date().toISOString(), // no strict time, just today
             follow_up_question: `Did you end up finishing: ${action.data.task_description}?`,
             follow_up_after: followUpAfter,
             source_message: 'Implicit Goal Extraction',
             status: 'pending',
             next_retry_at: followUpAfter,
             urgency: 'low',
             is_recurring: false,
           });
           logger.info('[BackgroundAction] Added implicit agenda item', { userId, task: action.data.task_description, followUpAfter });
        }
        else if (action.tool === 'ExternalApiEngine' && action.action === 'webhook') {
           const { url, method, body } = action.data;
           if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
             try {
               const axios = (await import('axios')).default;
               logger.info(`[ExternalApiEngine] Triggering webhook: ${method} ${url}`);
               await axios({
                 method: method || 'POST',
                 url: url,
                 data: body || {},
                 timeout: 5000, // 5s timeout so it doesn't hang
               });
             } catch (webhookErr) {
               logger.warn(`[ExternalApiEngine] Webhook failed for ${url}`, { error: webhookErr instanceof Error ? webhookErr.message : String(webhookErr) });
             }
           }
        }
      } catch (err) {
        logger.error(`[BackgroundAction] Failed executing ${action.tool}.${action.action}`, { err: err instanceof Error ? err.message : String(err) });
      }
    }
  }
}

export const backgroundActions = new BackgroundActionService();
