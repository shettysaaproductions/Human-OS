/**
 * cognitiveEventBus.ts — Lightweight structured cognitive pipeline event emitter.
 *
 * Emits structured [COGNITIVE_EVENT] log lines for every significant action taken
 * by Nova's cognition engines. Purely additive — no existing behavior changes.
 *
 * Future: write to a `nova_cognitive_events` Supabase table for the Watchtower UI.
 */

import { logger } from './logger';

export type CognitiveEventType =
  | 'turn_analyzed'
  | 'memory_proposal'
  | 'memory_written'
  | 'memory_blocked'
  | 'life_thread_changed'
  | 'life_thread_suppressed'
  | 'reminder_created'
  | 'reminder_exists'
  | 'reminder_failed'
  | 'negation_detected'
  | 'goal_paused'
  | 'gate_decision'
  | 'worker_success'
  | 'worker_failure'
  | 'conversation_rescoped'
  | 'session_end_queued';

export interface CognitiveEvent {
  eventType: CognitiveEventType;
  userId: string;
  requestId?: string;
  correlationId?: string;
  timestamp: string;
  data: Record<string, unknown>;
}

class CognitiveEventBus {
  emit(event: CognitiveEvent): void {
    // Structured log — queryable via Render log search or future Watchtower table
    logger.info(`[COGNITIVE_EVENT] ${event.eventType}`, {
      userId: event.userId,
      requestId: event.requestId,
      correlationId: event.correlationId,
      timestamp: event.timestamp,
      ...event.data,
    });
    // Future: await supabaseAdmin.from('nova_cognitive_events').insert(event)
  }
}

export const cognitiveEventBus = new CognitiveEventBus();
