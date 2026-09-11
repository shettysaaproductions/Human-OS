/**
 * DeterministicFactAgent — Phase 11 compatibility adapter.
 *
 * ROLE (Phase 11+):
 *   This agent is now a thin adapter over the canonical consumers.
 *   It is retained only for:
 *     1. Legacy queued jobs (extract_deterministic_fact) already in the DB
 *     2. Backward compatibility with any callers that still use facts[] payload
 *
 *   New chat turns MUST NOT rely on this agent for authoritative fact writes.
 *   New turns pass semanticEvents[] and are handled by:
 *     - FactAssertionConsumer  (FactAsserted + RelationshipAsserted)
 *     - CorrectionPropagator   (FactCorrected via atomic_supersede_memory RPC)
 *
 * AUTHORITY INVARIANT:
 *   This agent does NOT call the LLM.
 *   When semanticEvents are present in the payload, they are routed to the
 *   canonical consumers first. Legacy facts[] are ignored for new turns
 *   (they are absent when the route populates semanticEvents correctly).
 */

import { memoryRepository } from '../services/memoryRepository';
import { MemoryType } from '../types/memory';
import { logger } from '../lib/logger';
import { memoryPolicyService } from '../services/MemoryPolicyService';
import { propagateCorrection } from '../services/CorrectionPropagator';
import { factAssertionConsumer } from '../consumers/FactAssertionConsumer';
import { goalAssertedConsumer } from '../consumers/GoalAssertedConsumer';
import type { FactCorrectedEvent, SemanticEvent } from '../types/semanticEvent';
import { isFactAsserted, isRelationshipAsserted, isGoalAsserted, isFactCorrected } from '../types/semanticEvent';
import { classifyDomain } from '../lib/memoryDomains';

// ── Legacy key→type routing (kept for backward compat with facts[] payloads) ─
function getMemoryTypeForKey(key: string): MemoryType {
  if ([
    'mother_name', 'mother_nickname',
    'father_name', 'father_nickname',
    'wife_name', 'wife_nickname',
    'husband_name', 'husband_nickname',
    'son_name', 'son_nickname',
    'daughter_name', 'daughter_nickname',
    'sister_name', 'sister_nickname',
    'brother_name', 'brother_nickname'
  ].includes(key)) {
    return 'family';
  }
  const domainMeta = classifyDomain(key);
  if (domainMeta.domain === 'family') return 'family';
  if (domainMeta.domain === 'work') return 'work';
  if (domainMeta.domain === 'goals') return 'goals';
  if (domainMeta.domain === 'lifestyle') return 'preferences';
  return 'personal';
}

export class DeterministicFactAgent {
  async processJob(job: any): Promise<void> {
    const {
      userId,
      // Phase 11: canonical path — semanticEvents replaces facts[]+corrections[]
      semanticEvents,
      // Phase 11 compat: older queued jobs may still carry these
      facts,
      corrections: eventCorrections,
      sourceMessage,
      messageId,
      turnId,
    } = job.payload;

    if (!userId) {
      throw new Error('Invalid payload for extract_deterministic_fact: missing userId');
    }

    // Privacy gate: queued job must re-check at execution time (race safety)
    if (!(await memoryPolicyService.isMemoryEnabled(userId))) {
      logger.info('[DeterministicFactAgent] Memory paused — skipping fact persistence', { userId, messageId });
      return;
    }

    // ── Phase 11 canonical path ───────────────────────────────────────────────
    // When semanticEvents[] is present, route through canonical consumers.
    // This is the authoritative path for new chat turns.
    if (Array.isArray(semanticEvents) && semanticEvents.length > 0) {
      const events = semanticEvents as SemanticEvent[];

      // 1. FactAsserted + RelationshipAsserted → FactAssertionConsumer
      const assertionEvents = events.filter(e => isFactAsserted(e) || isRelationshipAsserted(e));
      if (assertionEvents.length > 0) {
        const results = await factAssertionConsumer.consume(userId, assertionEvents, sourceMessage);
        const failed = results.filter(r => !r.success && !r.skipped);
        if (failed.length > 0) {
          logger.warn('[DeterministicFactAgent] Some FactAsserted events failed', {
            userId, turnId, failed: failed.map(f => ({ canonicalKey: f.canonicalKey, error: f.error })),
          });
        }
      }

      // 2. FactCorrected → CorrectionPropagator (atomic_supersede_memory RPC)
      const correctionEvents = events.filter(isFactCorrected) as FactCorrectedEvent[];
      for (const corrEvent of correctionEvents) {
        try {
          const result = await propagateCorrection(userId, corrEvent);
          if (!result.fullySucceeded) {
            logger.warn('[DeterministicFactAgent][Phase11] Partial correction propagation failure', {
              userId,
              canonicalKey: corrEvent.canonicalKey,
              failedScopes: result.scopes.filter(s => !s.success).map(s => ({ scope: s.scope, error: s.error })),
            });
          } else {
            logger.info('[DeterministicFactAgent][Phase11] Correction propagated fully', {
              userId,
              canonicalKey: corrEvent.canonicalKey,
              supersedesEventId: result.supersedesEventId,
            });
          }
        } catch (err) {
          logger.error('[DeterministicFactAgent][Phase11] CorrectionPropagator threw unexpectedly', {
            canonicalKey: corrEvent.canonicalKey,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      // 3. GoalAsserted → GoalAssertedConsumer
      const goalEvents = events.filter(isGoalAsserted);
      if (goalEvents.length > 0) {
        const goalResults = await goalAssertedConsumer.consume(userId, goalEvents, turnId);
        const failed = goalResults.filter(r => !r.isNew && !r.skipped && r.error);
        if (failed.length > 0) {
          logger.warn('[DeterministicFactAgent] Some GoalAsserted events failed', {
            userId, turnId, failed: failed.map(f => ({ goalKey: f.goalKey, error: f.error })),
          });
        }
      }

      // Phase 11: When semanticEvents present, skip legacy facts[] — they are a
      // re-extraction of the same turn and would be an authority bypass.
      return;
    }

    // ── Phase 11 legacy compatibility path ────────────────────────────────────
    // Reached only for old queued jobs that pre-date semanticEvents payload.
    // Log clearly so we can track and eventually retire this path.

    // ─ Legacy corrections (pre-Phase 10 format) ────────────────────────────
    if (Array.isArray(eventCorrections) && eventCorrections.length > 0) {
      logger.info('[DeterministicFactAgent] Legacy corrections path (pre-Phase11 job)', {
        userId, count: eventCorrections.length,
      });
      for (const corrEvent of eventCorrections as FactCorrectedEvent[]) {
        try {
          const result = await propagateCorrection(userId, corrEvent);
          if (!result.fullySucceeded) {
            logger.warn('[DeterministicFactAgent][Phase10-compat] Partial correction failure', {
              userId,
              canonicalKey: corrEvent.canonicalKey,
              failedScopes: result.scopes.filter(s => !s.success).map(s => ({ scope: s.scope, error: s.error })),
            });
          } else {
            logger.info('[DeterministicFactAgent][Phase10-compat] Correction propagated', {
              userId,
              canonicalKey: corrEvent.canonicalKey,
              supersedesEventId: result.supersedesEventId,
            });
          }
        } catch (err) {
          logger.error('[DeterministicFactAgent][Phase10-compat] CorrectionPropagator threw', {
            canonicalKey: corrEvent.canonicalKey,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    // ─ Legacy facts[] (pre-Phase 11 format) ────────────────────────────────
    if (!Array.isArray(facts) || facts.length === 0) return;

    logger.info('[DeterministicFactAgent] Legacy facts[] path (pre-Phase11 job)', {
      userId, count: facts.length,
    });

    for (const fact of facts) {
      if (!fact.key || !fact.value) continue;

      const isProtected = fact.is_protected === true || fact.factClass === 'PROTECTED_FACT';

      try {
        const tm = fact.temporalMetadata;
        await memoryRepository.upsertMemory(userId, {
          type: getMemoryTypeForKey(fact.key),
          key: fact.key,
          value: fact.value,
          importance: isProtected ? 90 : 75,
          confidence: 0.95,
          shouldPersist: true,
          source_authority: isProtected ? 'explicit_user' : 'deterministic',
          is_protected: isProtected,
          protection_source: isProtected ? 'user_explicit' : undefined,
          correction_intent: fact.factClass === 'PROTECTED_FACT' || fact.isCorrection === true || fact.is_correction === true,
          valid_from: tm?.valid_from,
          valid_until: tm?.valid_until,
          temporal_precision: tm?.precision,
          temporal_status: tm?.temporal_status,
          temporal_metadata: tm,
          is_future_intent: tm?.is_future_intent,
          lifecycle_state: tm?.temporal_status === 'HISTORICAL' ? 'HISTORICAL' : tm?.is_future_intent ? 'UNKNOWN' : undefined,
          source_message_id: messageId,
          source_references: messageId ? [{ type: 'turn', id: messageId }] : undefined,
        }, sourceMessage || 'DeterministicFactAgent-Legacy');

        logger.info('[DeterministicFactAgent] Legacy fact persisted', {
          userId,
          key: fact.key,
          value: fact.value,
          isProtected,
          factClass: fact.factClass || (isProtected ? 'PROTECTED_FACT' : 'HIGH_CONFIDENCE_DURABLE_FACT')
        });
      } catch (err) {
        logger.error('[DeterministicFactAgent] Legacy fact upsert failed', {
          fact,
          error: err instanceof Error ? err.message : String(err)
        });
      }
    }
  }
}

export const deterministicFactAgent = new DeterministicFactAgent();
