import { Job } from '../services/QueueService';
import { supabaseAdmin } from '../lib/supabase';
import { logger } from '../lib/logger';
import { interpretTurn, getPendingClarification, setPendingClarification, toSemanticEvents } from '../lib/SemanticInterpreter';
import { validateTurn as validate } from '../lib/SemanticValidator';
import { deterministicFactAgent } from './DeterministicFactAgent';
import { subconsciousQueue } from '../services/QueueService';

export class SemanticTurnAgent {
  async processJob(job: Job) {
    const { userId, turnId, userMessageId, primaryMessage, is_proactive } = job.payload;
    if (!userId || !turnId || !primaryMessage) {
      logger.warn('[SemanticTurnAgent] Missing required payload fields', { jobId: job.id });
      return;
    }

    if (is_proactive || primaryMessage.length <= 1) {
      return { semanticEvents: [], reminderNote: '', reminderCreated: false };
    }

    let resultEvents: any[] = [];
    let reminderNote = '';
    let reminderCreated = false;

    try {
      const pending = await getPendingClarification(userId, supabaseAdmin);
      const semanticTurn = await interpretTurn(
        primaryMessage,
        userMessageId,
        pending ?? null
      );

      if (semanticTurn) {
        const validatedSemanticTurn = validate(semanticTurn, primaryMessage);

        const semanticEvents = toSemanticEvents(validatedSemanticTurn, userId, userMessageId || turnId);

        logger.info('[SemanticTurnAgent] Turn interpreted', {
          userId,
          turnId,
          intent: semanticTurn.intent,
          validatedFacts: validatedSemanticTurn.facts.length,
          semanticEventCount: semanticEvents.length
        });

        if (validatedSemanticTurn.requiresClarification && validatedSemanticTurn.clarificationQuestion) {
          await setPendingClarification(userId, {
            turnId,
            type: validatedSemanticTurn.actions?.[0]?.type === 'REMINDER' ? 'REMINDER' : 'CORRECTION',
            originalAction: (validatedSemanticTurn.actions?.[0] || validatedSemanticTurn.corrections?.[0]) as any,
            missingFields: (validatedSemanticTurn.actions?.[0] as any)?.missingFields || [],
            askedQuestion: validatedSemanticTurn.clarificationQuestion
          }, supabaseAdmin);
        }

        // Run Phase 11 deterministically inline
        if (semanticEvents.length > 0) {
          try {
            await deterministicFactAgent.processJob({
              id: `phase11_${turnId}`,
              job_type: 'extract_deterministic_fact',
              attempts: 0,
              status: 'running',
              created_at: new Date(),
              payload: {
                userId,
                messageId: userMessageId || turnId,
                events: semanticEvents
              }
            });
            logger.info('[SemanticTurnAgent] Phase 11 executed successfully', { userId, turnId });
          } catch (err: any) {
            logger.error('[SemanticTurnAgent] Phase 11 deterministic error', { 
              userId, 
              turnId, 
              error: err.message 
            });
            throw err;
          }
        }
        // ── Phase 11: Deterministic reminder persistence from ScheduleAssertedEvent ─
        const { isScheduleAsserted: isSchedEv } = await import('../types/semanticEvent');
        const scheduleEvents = semanticEvents.filter((e: any) => isSchedEv(e));

        if (validatedSemanticTurn?.requiresClarification && scheduleEvents.length === 0) {
          reminderNote = 'REMINDER_INTENT_DETECTED_BUT_TIME_AMBIGUOUS: User wants a reminder but no clear time was found. Ask ONCE for the exact time. Do not guess or assume a time.';
        }

        if (scheduleEvents.length > 0) {
          const { data: profile } = await supabaseAdmin.from('user_profiles').select('country, timezone_offset').eq('id', userId).single();
          
          for (const schedEvt of scheduleEvents) {
            try {
              // Duplicate resolveUserTzOffsetHours logic roughly
              const userTzHours = profile?.timezone_offset ?? (profile?.country === 'IN' ? 5.5 : 5.5);
              const { ReminderEngine: RE } = await import('../services/ReminderEngine');
              const engine = new RE(userTzHours);
              const parsed = engine.parse((schedEvt as any).reminderSpec);
              const scheduled = await engine.scheduleAll(userId, parsed);
              if (scheduled && scheduled.length > 0) {
                reminderCreated = true;
                const isAlreadyActive = scheduled.some((r: any) => r.alreadyExists);
                if (isAlreadyActive) {
                  reminderNote += `REMINDER_ALREADY_EXISTS: A reminder for "${engine.formatConfirmation(parsed)}" is ALREADY active. `;
                } else {
                  reminderNote += `REMINDER_ALREADY_PERSISTED: "${engine.formatConfirmation(parsed)}" — confirm this naturally to the user. `;
                }
                logger.info('[SemanticTurnAgent] Deterministic reminder from ScheduleAssertedEvent', {
                  userId,
                  eventId: (schedEvt as any).eventId,
                  reminderId: scheduled[0].id
                });
              }
            } catch (e) {
              logger.error('[SemanticTurnAgent] ScheduleAsserted reminder failed', {
                eventId: (schedEvt as any).eventId,
                error: e instanceof Error ? e.message : String(e),
              });
              reminderNote += 'REMINDER_PERSISTENCE_FAILED: The reminder could not be saved right now. Do NOT confirm a reminder was set. ';
            }
          }
        }

        // ── Phase 11: GoalCorrected suppression dedup ─────────────────────────────
        const hasGoalCorrectedEvents = semanticEvents.some((e: any) => e.family === 'GoalCorrected');
        if (!hasGoalCorrectedEvents && validatedSemanticTurn) {
          const goalActions = validatedSemanticTurn.actions.filter((a: any) => a.type === 'GOAL_UPDATE');
          for (const action of goalActions) {
            const data = action.data || {};
            if (data.status === 'paused' || data.status === 'abandoned') {
              try {
                await subconsciousQueue.add('suppress_life_thread', {
                  user_id: userId,
                  negated_concept: data.goal_name || data.target_fact_key || 'unknown',
                  target_fact_key: data.target_fact_key,
                  is_current: data.status === 'paused',
                  reason: `User said: (message length ${primaryMessage.length})`,
                });
              } catch (suppErr: any) {
                logger.error('[SemanticTurnAgent] Failed to queue suppress_life_thread', { userId, error: suppErr?.message });
              }
            }
          }
        }
        
        resultEvents = semanticEvents;
      }
      
      return { semanticEvents: resultEvents, reminderNote, reminderCreated };
    } catch (err: any) {
      logger.error('[SemanticTurnAgent] Processing error', {
        userId,
        turnId,
        error: err.message
      });
      throw err;
    }
  }
}

export const semanticTurnAgent = new SemanticTurnAgent();
