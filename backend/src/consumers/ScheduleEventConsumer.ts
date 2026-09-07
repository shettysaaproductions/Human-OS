/**
 * ScheduleEventConsumer — Phase 11 canonical reminder writer.
 *
 * AUTHORITY INVARIANT:
 *   Input: ScheduleAssertedEvent only.
 *   The event has already passed:
 *     SemanticInterpreter → SemanticValidator → toSemanticEvents()
 *   Ambiguous/incomplete schedules are blocked at toSemanticEvents() (requiresClarification barrier).
 *   This consumer NEVER parses raw text. It only calls engine.parse(event.reminderSpec).
 *
 * IDEMPOTENCY:
 *   ReminderEngine.scheduleAll() deduplicates via logical_key + is_active check.
 *   Replaying the same event returns alreadyExists=true without creating a duplicate row.
 */

import { logger } from '../lib/logger';
import { memoryPolicyService } from '../services/MemoryPolicyService';
import type { ScheduleAssertedEvent, SemanticEvent } from '../types/semanticEvent';
import { isScheduleAsserted } from '../types/semanticEvent';

// ── Timezone helpers ────────────────────────────────────────────────────────
const TIMEZONE_OFFSETS: Record<string, number> = {
  IN: 5.5,
  US: -5,
  UK: 0,
};

// ── Result type ─────────────────────────────────────────────────────────────
export interface ScheduleConsumeResult {
  eventId: string;
  success: boolean;
  reminderId?: string;
  alreadyExists?: boolean;
  skipped?: boolean;
  skipReason?: string;
  error?: string;
}

// ── Consumer ────────────────────────────────────────────────────────────────
export class ScheduleEventConsumer {
  /**
   * Consume a list of ScheduleAssertedEvents.
   *
   * Non-ScheduleAsserted events in the array are ignored.
   * Returns one result per ScheduleAsserted event processed.
   *
   * @param userId    The user whose reminder we are creating
   * @param events    SemanticEvent[] — only ScheduleAsserted are processed
   * @param userCountry  ISO country code, used to derive timezone offset
   */
  async consume(
    userId: string,
    events: SemanticEvent[],
    userCountry = 'IN',
  ): Promise<ScheduleConsumeResult[]> {
    if (!events || events.length === 0) return [];

    const scheduleEvents = events.filter(isScheduleAsserted);
    if (scheduleEvents.length === 0) return [];

    // Privacy gate — re-checked at consumption time
    if (!(await memoryPolicyService.isMemoryEnabled(userId))) {
      logger.info('[ScheduleEventConsumer] Memory paused — skipping schedule events', { userId });
      return scheduleEvents.map(e => ({
        eventId: e.eventId,
        success: false,
        skipped: true,
        skipReason: 'memory_paused',
      }));
    }

    const tzOffset = TIMEZONE_OFFSETS[userCountry] ?? 5.5;
    const { ReminderEngine } = await import('../services/ReminderEngine');
    const engine = new ReminderEngine(tzOffset);

    const results: ScheduleConsumeResult[] = [];

    for (const event of scheduleEvents) {
      results.push(await this.consumeOne(userId, event, engine));
    }

    return results;
  }

  private async consumeOne(
    userId: string,
    event: ScheduleAssertedEvent,
    engine: import('../services/ReminderEngine').ReminderEngine,
  ): Promise<ScheduleConsumeResult> {
    const { eventId, reminderSpec } = event;

    try {
      // No text parsing. reminderSpec comes directly from the SemanticEvent.
      const parsedList = engine.parse(reminderSpec as any);

      if (!parsedList || parsedList.length === 0) {
        logger.warn('[ScheduleEventConsumer] engine.parse returned empty list', {
          userId, eventId, reminderSpec,
        });
        return { eventId, success: false, error: 'PARSE_EMPTY' };
      }

      const scheduled = await engine.scheduleAll(userId, parsedList);

      if (!scheduled || scheduled.length === 0) {
        return { eventId, success: false, error: 'SCHEDULE_EMPTY' };
      }

      const first = scheduled[0];
      const alreadyExists = !!first.alreadyExists;

      logger.info('[ScheduleEventConsumer] Reminder scheduled', {
        userId,
        eventId,
        reminderId: first.id,
        alreadyExists,
        trigger_at: first.trigger_at,
      });

      return {
        eventId,
        success: true,
        reminderId: first.id,
        alreadyExists,
      };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      logger.error('[ScheduleEventConsumer] Failed to schedule reminder', {
        userId, eventId, error,
      });
      return { eventId, success: false, error };
    }
  }
}

export const scheduleEventConsumer = new ScheduleEventConsumer();
