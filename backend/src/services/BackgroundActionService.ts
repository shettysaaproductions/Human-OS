import { logger } from '../lib/logger';
import { supabaseAdmin } from '../lib/supabase';
import { memoryRepository } from './memoryRepository';

const TIMEZONE_OFFSETS: Record<string, number> = {
  IN: 5.5,
  US: -5,
  UK: 0,
};


const processedCache = new Map<string, number>();

export class BackgroundActionService {
  async processCriticalActions(userId: string, requestId: string, actions: any[], userCountry: string): Promise<{ success: boolean, actionType: string, error?: string }> {
    if (!actions || actions.length === 0) return { success: true, actionType: 'none' };

    // We only execute the FIRST action synchronously as the primary critical action
    const action = actions[0];
    const actionType = `${action.tool}.${action.action}`;

    try {
      // 1. Atomic Idempotency Check
      const { error } = await supabaseAdmin
        .from('action_idempotency')
        .insert({
          user_id: userId,
          idempotency_key: requestId,
          action_type: actionType,
          status: 'pending'
        })
        .select()
        .maybeSingle();

      if (error && error.code === '23505') {
        // Conflict! Row already exists.
        const { data: existing } = await supabaseAdmin
          .from('action_idempotency')
          .select('status, result')
          .eq('user_id', userId)
          .eq('idempotency_key', requestId)
          .maybeSingle();

        if (existing?.status === 'completed') {
          return { success: true, actionType };
        } else if (existing?.status === 'failed') {
          return { success: false, actionType, error: existing.result?.error || 'Previously failed' };
        } else {
          return { success: false, actionType, error: 'Action is currently pending execution by another process' };
        }
      }

      // 2. Execute Action Synchronously
      if (action.tool === 'ReminderEngine' && action.action === 'schedule') {
        const userTzOffset = TIMEZONE_OFFSETS[userCountry] ?? 5.5;
        const { ReminderEngine } = await import('./ReminderEngine');
        const engine = new ReminderEngine(userTzOffset);
        
        let specs = action.data.reminders || [action.data];
        if (!Array.isArray(specs)) specs = [specs];
        
        specs = specs.map((spec: any) => {
          if (!spec.time_phrase) return this.normalizeStructuredSpec(spec);
          // For critical synchronous execution, we only want to support the structured LLM output
          // to avoid complex regex logic, but we'll fall back to normalize if needed.
          // Wait, we need the regex from earlier for safety! We will just re-use the exact same logic.
          // Actually, we can just extract that regex block into a private method `parseLegacySpec`.
          return this.parseLegacySpec(spec, userTzOffset);
        });

        const allScheduled: any[] = [];
        for (const spec of specs) {
          const parsedList = engine.parse(spec);
          const inserted = await engine.scheduleAll(userId, parsedList);
          allScheduled.push(...inserted);
        }
        logger.info('[BackgroundAction] Synchronously scheduled reminders', { userId, count: allScheduled.length });
      } else {
        // Unhandled critical action type
        throw new Error(`Unsupported critical action: ${actionType}`);
      }

      // 3. Mark Completed
      await supabaseAdmin.from('action_idempotency')
        .update({ status: 'completed', result: { success: true }, completed_at: new Date().toISOString() })
        .eq('user_id', userId)
        .eq('idempotency_key', requestId);

      return { success: true, actionType };
    } catch (e: any) {
      logger.error(`[BackgroundAction] Critical action failed: ${actionType}`, { error: e.message });
      // Mark Failed
      await supabaseAdmin.from('action_idempotency')
        .update({ status: 'failed', result: { error: e.message }, completed_at: new Date().toISOString() })
        .eq('user_id', userId)
        .eq('idempotency_key', requestId);
        
      return { success: false, actionType, error: e.message };
    }
  }

  async processActions(userId: string, conversationId: string, actions: any[], userCountry: string, messageHash?: string) {
    if (!actions || actions.length === 0) return;

    if (messageHash) {
      const cacheKey = `${userId}:${messageHash}`;
      const now = Date.now();
      if (processedCache.has(cacheKey) && (now - processedCache.get(cacheKey)!) < 60000) {
        logger.info(`[BackgroundAction] Idempotency hit for ${cacheKey}, skipping duplicate execution.`);
        return;
      }
      processedCache.set(cacheKey, now);
      
      // Cleanup old cache entries
      for (const [k, v] of processedCache.entries()) {
        if (now - v > 60000) processedCache.delete(k);
      }
    }

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
            return this.parseLegacySpec(spec, userTzOffset);
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

           // QUALITY GATE: Ignore generic conversational fluff
           const lowerMem = memString.toLowerCase();
           const FLUFF_WORDS = ['said hi', 'said hello', 'how are', 'how is', 'checking in', 'good morning', 'good night', 'nothing much', 'just texting', 'just saying hi'];
           if (FLUFF_WORDS.some(w => lowerMem.includes(w)) || memString.length < 15) {
             logger.info('[BackgroundAction] Rejected short-term memory as fluff', { memString });
             continue;
           }

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
           // Quality gate — reject trash before it pollutes long-term memory
           const memValue = String(action.data?.value || '').trim();
           const memKey = String(action.data?.key || '').trim();
           const MEMORY_TRASH_PATTERNS = [
             /^(user (?:was|is|said|feeling|feels|mentioned|says))\s+(?:sleepy|tired|ok|fine|good|kaam|busy|bored)/i,
             /^\d+:\d+/,
             /^(feeling|feel|mood|state)\s+\w+\s*$/i,
             /^(kaam|lag|pine|soo|raat|neend|ok|hmm|haan|nahi)/i,
             /^(user is|user was|currently)\s+\w+\s*$/i,
           ];
           const isTrash = !memValue || memValue.length < 12 || memValue.split(' ').length < 3 ||
             MEMORY_TRASH_PATTERNS.some(p => p.test(memValue));
           if (isTrash) {
             logger.info('[BackgroundAction] MemoryRepository quality gate: rejected', { memKey, memValue });
           } else {
             logger.info('[BackgroundAction] Saving memory via memoryRepository', { memKey });
             await memoryRepository.upsertMemory(userId, {
               key: memKey,
               value: memValue,
               type: (action.data.memory_type || 'semantic') as any,
               shouldPersist: true,
               source_authority: 'subconscious_inference',
               importance: 50,
               confidence: 0.7,
               emotional_weight: 0,
             }, action.data.source || 'background_action');
           }
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
        else if (action.tool === 'WorkingMemory' && action.action === 'set') {
           const { key, value } = action.data;
           if (key) {
             const PERMANENT_KEYS = ['work_schedule', 'weekoff_day', 'daily_commute', 'sleep_cycle',
               'office_hours', 'login_time', 'logout_time', 'gym_time', 'working_days', 'work_days',
               'sleep_time', 'wake_time', 'shift_time', 'lunch_time'];
             const isPermanentKey = PERMANENT_KEYS.some(k => key.toLowerCase().includes(k));
             const payload: any = {
               user_id: userId,
               key: key,
               value: value || '',
               updated_at: new Date().toISOString()
             };
             
             if (isPermanentKey) {
               // Make schedule facts effectively permanent (10 years) to override the default 7-day expiry
               payload.expires_at = new Date(Date.now() + 10 * 365 * 24 * 60 * 60 * 1000).toISOString();
             }
             
             await supabaseAdmin.from('working_memory').upsert(payload, { onConflict: 'user_id, key' });
             logger.info('[BackgroundAction] Updated WorkingMemory', { userId, key, value });
           }
        }
        // ── LifeThread tool handlers (Routed via LifeThreadRepository - Single Writer) ──
        else if (action.tool === 'LifeThread' && (action.action === 'upsert' || action.action === 'create')) {
          const topic = String(action.data?.topic || '').trim().substring(0, 500);
          const state = action.data?.state || 'active';
          const priority = action.data?.priority || 'medium';
          const provenance = String(action.data?.provenance || '').substring(0, 500);
          if (!topic) {
            logger.warn('[BackgroundAction] LifeThread.upsert missing topic', { userId });
          } else {
            const { lifeThreadRepository } = await import('./lifeThreadRepository');
            await lifeThreadRepository.createOrUpdateThread(
              userId,
              { topic, state, priority, provenance },
              {
                sourceAuthority: 'llm_proposal',
                provenanceNote: provenance || undefined
              }
            );
            logger.info('[BackgroundAction] LifeThread handled via repository', { userId, topic, state });
          }
        }
        else if (action.tool === 'LifeThread' && action.action === 'complete') {
          const topic = String(action.data?.topic || '').trim();
          if (!topic) {
            logger.warn('[BackgroundAction] LifeThread.complete missing topic', { userId });
          } else {
            const { lifeThreadRepository } = await import('./lifeThreadRepository');
            const completed = await lifeThreadRepository.completeThreadByTopic(
              userId,
              topic,
              {
                sourceAuthority: 'llm_proposal',
                reason: 'Completed via subconscious action'
              }
            );
            if (completed) {
              logger.info('[BackgroundAction] LifeThread completed via repository', { userId, topic });
            } else {
              logger.warn('[BackgroundAction] LifeThread complete target not found', { userId, topic });
            }
          }
        }
        // ── NovaAction tool handlers ──────────────────────────────────────────────
        else if (action.tool === 'NovaAction' && action.action === 'create') {
          const logicalKey = String(action.data?.logical_key || '').trim().substring(0, 200);
          const title = String(action.data?.title || '').trim().substring(0, 500);
          if (!logicalKey || !title) { logger.warn('[BackgroundAction] NovaAction.create missing logical_key or title', { userId }); }
          else {
            // Idempotent: UNIQUE(user_id, logical_key) — upsert on conflict
            await supabaseAdmin.from('nova_actions').upsert({
              user_id: userId,
              logical_key: logicalKey,
              title,
              description: String(action.data?.description || '').substring(0, 1000),
              state: action.data?.state || 'suggested',
              priority: action.data?.priority || 'medium',
              execution_class: action.data?.execution_class || 'SAFE_AUTOMATIC',
              source_thread_id: action.data?.source_thread_id || null,
              due_at: action.data?.due_at || null,
              dependency_ids: action.data?.dependency_ids || [],
              updated_at: new Date().toISOString()
            }, { onConflict: 'user_id,logical_key', ignoreDuplicates: false });
            logger.info('[BackgroundAction] NovaAction created/upserted', { userId, logicalKey, title });
          }
        }
        else if (action.tool === 'NovaAction' && action.action === 'complete') {
          const logicalKey = String(action.data?.logical_key || '').trim();
          if (!logicalKey) { logger.warn('[BackgroundAction] NovaAction.complete missing logical_key', { userId }); }
          else {
            const { error } = await supabaseAdmin.from('nova_actions')
              .update({ state: 'completed', updated_at: new Date().toISOString() })
              .eq('user_id', userId)
              .eq('logical_key', logicalKey)
              .neq('state', 'completed');
            if (error) logger.warn('[BackgroundAction] NovaAction.complete failed', { userId, logicalKey, error: error.message });
            else logger.info('[BackgroundAction] NovaAction completed', { userId, logicalKey });
          }
        }
        else if (action.tool === 'NovaAction' && action.action === 'cancel') {
          const logicalKey = String(action.data?.logical_key || '').trim();
          if (logicalKey) {
            await supabaseAdmin.from('nova_actions')
              .update({ state: 'cancelled', updated_at: new Date().toISOString() })
              .eq('user_id', userId)
              .eq('logical_key', logicalKey)
              .not('state', 'in', '("completed","cancelled")');
            logger.info('[BackgroundAction] NovaAction cancelled', { userId, logicalKey });
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

  private parseLegacySpec(spec: any, userTzOffset: number): any {
    const phrase = String(spec.time_phrase).toLowerCase().trim();
    const title = spec.description || spec.title || spec.text || 'Reminder';
    const base: any = { title, notes: spec.notes };

    const everyMatch = phrase.match(/every\s+(\d+(?:\.\d+)?)\s*(min(?:ute)?s?|hour?s?|hr?s?|day?s?|week?s?|month?s?)/i);
    if (everyMatch) {
      base.relative_value = parseFloat(everyMatch[1]);
      base.relative_unit = everyMatch[2];
      base.recurrence_interval_value = parseFloat(everyMatch[1]);
      base.recurrence_interval_unit = everyMatch[2];
      return base;
    }

    const relMatch = phrase.match(/(\d+(?:\.\d+)?)\s*(min(?:ute)?s?|hour?s?|hr?s?|day?s?|week?s?|month?s?)/i);
    if (relMatch) {
      base.relative_value = parseFloat(relMatch[1]);
      base.relative_unit = relMatch[2];
      return base;
    }

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

    const atTimeMatch = phrase.match(/at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
    if (atTimeMatch) {
      let hh = parseInt(atTimeMatch[1]);
      const mm = atTimeMatch[2] ? parseInt(atTimeMatch[2]) : 0;
      const meridiem = atTimeMatch[3]?.toLowerCase();
      if (meridiem === 'pm' && hh < 12) hh += 12;
      if (meridiem === 'am' && hh === 12) hh = 0;
      base.time_of_day = `${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}`;
      if (phrase.includes('tomorrow')) {
        const d = new Date(Date.now() + userTzOffset * 3600000 + 86400000);
        base.date = d.toISOString().split('T')[0];
      }
      return base;
    }

    if (phrase.includes('tomorrow')) {
      const d = new Date(Date.now() + userTzOffset * 3600000 + 86400000);
      base.date = d.toISOString().split('T')[0];
      base.time_of_day = '09:00';
      return base;
    }

    const dayMatch = phrase.match(/\bon\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i);
    if (dayMatch) {
      const dayName = dayMatch[1].toLowerCase();
      const dayIndex = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'].indexOf(dayName);
      if (dayIndex !== -1) {
        const today = new Date(Date.now() + userTzOffset * 3600000);
        let daysAhead = (dayIndex - today.getDay() + 7) % 7;
        if (daysAhead === 0) daysAhead = 7;
        const targetDate = new Date(today);
        targetDate.setDate(today.getDate() + daysAhead);
        base.date = targetDate.toISOString().split('T')[0];
        base.needs_time_clarification = true;
        base.active_days = [dayName];
      }
      return base;
    }

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

    logger.warn('[BackgroundAction] Could not parse time_phrase, defaulting to 1h', { phrase });
    base.relative_value = 1;
    base.relative_unit = 'hours';
    return base;
  }
}

export const backgroundActions = new BackgroundActionService();
