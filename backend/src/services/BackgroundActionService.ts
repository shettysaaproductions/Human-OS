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

          // ── Spec normalisation ──────────────────────────────────────────────
          // Primary path: Nova emits structured JSON (trigger_date, trigger_time,
          // recurrence_interval/unit, purpose, urgency, event_trigger, ...).
          // Fallback: older/legacy `time_phrase` (regex bridge) still converts
          // natural language → structured fields, kept for safety.
          specs = specs.map((spec: any) => {
            if (!spec.time_phrase) return this.normalizeStructuredSpec(spec);

            const phrase = String(spec.time_phrase).toLowerCase().trim();
            const title = spec.description || spec.title || spec.text || 'Reminder';
            const base: any = { title, notes: spec.notes };

            // Pattern: "every X minutes/hours/days/weeks/months" → RECURRING reminder
            const everyMatch = phrase.match(/every\s+(\d+(?:\.\d+)?)\s*(min(?:ute)?s?|hour?s?|hr?s?|day?s?|week?s?|month?s?)/i);
            if (everyMatch) {
              base.relative_value = parseFloat(everyMatch[1]); // first fire in X units
              base.relative_unit = everyMatch[2];
              base.recurrence_interval_value = parseFloat(everyMatch[1]);
              base.recurrence_interval_unit = everyMatch[2];
              return base;
            }

            // Pattern: "in X minutes/hours/days/weeks/months" or "X mins later" → one-shot
            const relMatch = phrase.match(/(\d+(?:\.\d+)?)\s*(min(?:ute)?s?|hour?s?|hr?s?|day?s?|week?s?|month?s?)/i);
            if (relMatch) {
              base.relative_value = parseFloat(relMatch[1]);
              base.relative_unit = relMatch[2];
              return base;
            }

            // Pattern: "on <dayname> at HH:MM" or "on Sunday at 10am" — specific day with time
            const dayAtTimeMatch = phrase.match(/\bon\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
            if (dayAtTimeMatch) {
              const dayName = dayAtTimeMatch[1].toLowerCase();
              let hh = parseInt(dayAtTimeMatch[2]);
              const mm = dayAtTimeMatch[3] ? parseInt(dayAtTimeMatch[3]) : 0;
              const meridiem = dayAtTimeMatch[4]?.toLowerCase();
              if (meridiem === 'pm' && hh < 12) hh += 12;
              if (meridiem === 'am' && hh === 12) hh = 0;
              base.time_of_day = `${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}`;

              const dayIndex = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'].indexOf(dayName);
              if (dayIndex !== -1) {
                const today = new Date(Date.now() + userTzOffset * 3600000);
                let daysAhead = (dayIndex - today.getDay() + 7) % 7;
                if (daysAhead === 0) daysAhead = 7;
                const targetDate = new Date(today);
                targetDate.setDate(today.getDate() + daysAhead);
                base.date = targetDate.toISOString().split('T')[0];
                base.active_days = [dayName];
              }
              base.needs_time_clarification = false;
              return base;
            }

            // Pattern: "at HH:MM" or "at 7am" or "at 10:30pm"
            const atTimeMatch = phrase.match(/at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
            if (atTimeMatch) {
              let hh = parseInt(atTimeMatch[1]);
              const mm = atTimeMatch[2] ? parseInt(atTimeMatch[2]) : 0;
              const meridiem = atTimeMatch[3]?.toLowerCase();
              if (meridiem === 'pm' && hh < 12) hh += 12;
              if (meridiem === 'am' && hh === 12) hh = 0;
              base.time_of_day = `${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}`;
              // If "tomorrow" mentioned, add date
              if (phrase.includes('tomorrow')) {
                const d = new Date(Date.now() + userTzOffset * 3600000 + 86400000);
                base.date = d.toISOString().split('T')[0];
              }
              return base;
            }

            // Pattern: "tomorrow" (no time → 9am default)
            if (phrase.includes('tomorrow')) {
              const d = new Date(Date.now() + userTzOffset * 3600000 + 86400000);
              base.date = d.toISOString().split('T')[0];
              base.time_of_day = '09:00';
              return base;
            }

            // Pattern: "on <dayname>" — e.g. "on Sunday", "on Monday" — needs time clarification if no time given
            const dayMatch = phrase.match(/\bon\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i);
            if (dayMatch) {
              const dayName = dayMatch[1].toLowerCase();
              const dayIndex = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'].indexOf(dayName);
              if (dayIndex !== -1) {
                const today = new Date(Date.now() + userTzOffset * 3600000);
                let daysAhead = (dayIndex - today.getDay() + 7) % 7;
                if (daysAhead === 0) daysAhead = 7; // Next week if today
                const targetDate = new Date(today);
                targetDate.setDate(today.getDate() + daysAhead);
                base.date = targetDate.toISOString().split('T')[0];
                // No time provided — will default to 9am in ReminderEngine, but we should flag for clarification
                base.needs_time_clarification = true;
                base.active_days = [dayName];
              }
              return base;
            }

            // Pattern: time-of-day keywords
            if (phrase.includes('tonight') || phrase.includes('evening')) {
              base.time_of_day = '20:00';
              return base;
            }
            if (phrase.includes('morning')) {
              base.time_of_day = '08:00';
              return base;
            }
            if (phrase.includes('noon') || phrase.includes('lunch')) {
              base.time_of_day = '12:00';
              return base;
            }
            if (phrase.includes('night')) {
              base.time_of_day = '22:00';
              return base;
            }

            // Fallback: 1 hour from now
            logger.warn('[BackgroundAction] Could not parse time_phrase, defaulting to 1h', { phrase });
            base.relative_value = 1;
            base.relative_unit = 'hours';
            return base;
          });

          const allScheduled: any[] = [];
          for (const spec of specs) {
            const parsedList = engine.parse(spec);
            const inserted = await engine.scheduleAll(userId, parsedList);
            allScheduled.push(...inserted);
          }
          logger.info('[BackgroundAction] Scheduled reminders', { userId, count: allScheduled.length });
        }
        else if (action.tool === 'ReminderEngine' && action.action === 'delete') {
          const id = action.data?.id;
          if (!id) {
            logger.warn('[BackgroundAction] ReminderEngine.delete missing id', { userId });
            continue;
          }
          const { ReminderEngine } = await import('./ReminderEngine');
          const engine = new ReminderEngine();
          const cancelled = await engine.delete(userId, String(id));
          logger.info('[BackgroundAction] ReminderEngine.delete', { userId, id, cancelled });
        }
        else if (action.tool === 'EventDetector' && action.action === 'fire') {
          const event = String(action.data?.event || '').toLowerCase().trim();
          if (!event) {
            logger.warn('[BackgroundAction] EventDetector.fire missing event', { userId });
            continue;
          }
          const { reminderSchedulerService } = await import('./ReminderSchedulerService');
          const fired = await reminderSchedulerService.fireEvent(userId, event);
          logger.info('[BackgroundAction] EventDetector.fire', { userId, event, fired });
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
             last_accessed_at: new Date().toISOString(),
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

  /**
   * Map the structured LLM JSON (primary reminder path) onto a ReminderSpec that
   * ReminderEngine.parse() understands. Supports both the newer camelCase keys
   * (trigger_date, trigger_time, recurrence_interval/unit) and the legacy
   * ReminderSpec keys (date, time_of_day, recurrence_interval_value/unit).
   */
  private normalizeStructuredSpec(spec: any): any {
    const out: any = {
      title: spec.title || spec.description || spec.text || 'Reminder',
      notes: spec.notes,
    };

    // New fields pass straight through
    if (spec.purpose) out.purpose = spec.purpose;
    if (spec.urgency) out.urgency = spec.urgency;
    if (spec.event_trigger) out.event_trigger = spec.event_trigger;
    if (spec.end_condition) out.end_condition = spec.end_condition;

    // Time fields (new + legacy keys)
    if (spec.trigger_date) out.date = spec.trigger_date;
    if (spec.date) out.date = spec.date;
    if (spec.trigger_time) out.time_of_day = this.normalizeTimeOfDay(spec.trigger_time);
    if (spec.time_of_day) out.time_of_day = this.normalizeTimeOfDay(spec.time_of_day);
    if (spec.relative_value !== undefined && spec.relative_value !== null) out.relative_value = Number(spec.relative_value);
    if (spec.relative_unit) out.relative_unit = spec.relative_unit;

    // Recurrence
    if (spec.recurrence_interval !== undefined && spec.recurrence_interval !== null) {
      out.recurrence_interval_value = Number(spec.recurrence_interval);
    }
    if (spec.recurrence_unit) out.recurrence_interval_unit = spec.recurrence_unit;
    if (spec.recurrence_limit !== undefined && spec.recurrence_limit !== null) {
      out.recurrence_limit = Number(spec.recurrence_limit);
    }

    // End date → end_at
    if (spec.end_at) out.end_at = spec.end_at;
    if (spec.end_date && !spec.end_at) out.end_at = spec.end_date;

    if (spec.is_auto !== undefined) out.is_auto = spec.is_auto;

    return out;
  }

  /**
   * Normalize an LLM-supplied time to "HH:MM" 24-hour. Accepts "19:00", "7pm", "7:30am".
   */
  private normalizeTimeOfDay(time: any): string {
    const s = String(time).trim().toLowerCase();
    const m = s.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
    if (!m) return s; // leave as-is; ReminderEngine will surface any issue
    let hh = parseInt(m[1], 10);
    const mm = m[2] ? parseInt(m[2], 10) : 0;
    if (m[3] === 'pm' && hh < 12) hh += 12;
    if (m[3] === 'am' && hh === 12) hh = 0;
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  }
}

export const backgroundActions = new BackgroundActionService();
