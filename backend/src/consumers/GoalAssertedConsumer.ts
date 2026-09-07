/**
 * GoalAssertedConsumer — Phase 11 canonical goal/life-thread writer.
 *
 * AUTHORITY INVARIANT:
 *   Input: GoalAssertedEvent only.
 *   Creates the canonical LifeThread record deterministically from the SemanticEvent.
 *   No LLM calls. LifeThreadAgent may ENRICH afterward but is NOT the sole creator.
 *
 * IDEMPOTENCY:
 *   lifeThreadRepository.createOrUpdateThread() deduplicates via canonical_key.
 *   Replaying the same GoalAssertedEvent for the same goal_key returns the
 *   existing thread without creating a duplicate.
 *
 * GOAL STATE:
 *   GoalAsserted always creates state='active'.
 *   GoalCorrected (paused/abandoned/resumed) is handled by LifeThreadAgent
 *   via GoalCorrectedEvent — that path is unchanged.
 */

import { logger } from '../lib/logger';
import { lifeThreadRepository } from '../services/lifeThreadRepository';
import type { GoalAssertedEvent, SemanticEvent } from '../types/semanticEvent';
import { isGoalAsserted } from '../types/semanticEvent';

// ── Result type ─────────────────────────────────────────────────────────────
export interface GoalConsumeResult {
  eventId: string;
  goalKey?: string;
  threadId?: string;
  isNew: boolean;
  skipped?: boolean;
  skipReason?: string;
  error?: string;
}

// ── Consumer ────────────────────────────────────────────────────────────────
export class GoalAssertedConsumer {
  /**
   * Consume a list of GoalAssertedEvents.
   *
   * Non-GoalAsserted events in the array are ignored.
   * Each event creates or confirms a canonical LifeThread record.
   *
   * @param userId  The user whose goal is being asserted
   * @param events  SemanticEvent[] — only GoalAsserted are processed
   * @param turnId  Provenance trace: the originating turn identifier
   */
  async consume(
    userId: string,
    events: SemanticEvent[],
    turnId?: string,
  ): Promise<GoalConsumeResult[]> {
    if (!events || events.length === 0) return [];

    const goalEvents = events.filter(isGoalAsserted);
    if (goalEvents.length === 0) return [];

    const results: GoalConsumeResult[] = [];

    for (const event of goalEvents) {
      results.push(await this.consumeOne(userId, event, turnId));
    }

    return results;
  }

  private async consumeOne(
    userId: string,
    event: GoalAssertedEvent,
    turnId?: string,
  ): Promise<GoalConsumeResult> {
    const { eventId, goalDescription, goalKey, sourceMessageId } = event;

    // A goal description is required — no empty goals
    if (!goalDescription || goalDescription.trim().length < 3) {
      logger.warn('[GoalAssertedConsumer] Skipping GoalAsserted with empty/trivial description', {
        userId, eventId, goalDescription,
      });
      return {
        eventId,
        goalKey,
        isNew: false,
        skipped: true,
        skipReason: 'empty_goal_description',
      };
    }

    try {
      const { thread, isNew } = await lifeThreadRepository.createOrUpdateThread(
        userId,
        {
          topic: goalDescription.trim(),
          state: 'active',
          provenance: `GoalAsserted via SemanticEvent: "${goalDescription.trim()}"`,
        },
        {
          sourceAuthority: 'deterministic_turn_analysis',
          sourceMessageId,
          turnId,
          reason: `GoalAssertedEvent: eventId=${eventId}`,
          provenanceNote: goalKey ? `goalKey=${goalKey}` : undefined,
        },
      );

      logger.info('[GoalAssertedConsumer] Goal thread ensured', {
        userId,
        eventId,
        goalKey,
        threadId: thread.id,
        isNew,
      });

      return {
        eventId,
        goalKey,
        threadId: thread.id,
        isNew,
      };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      logger.error('[GoalAssertedConsumer] Failed to create goal thread', {
        userId, eventId, goalKey, goalDescription, error,
      });
      return {
        eventId,
        goalKey,
        isNew: false,
        error,
      };
    }
  }
}

export const goalAssertedConsumer = new GoalAssertedConsumer();
