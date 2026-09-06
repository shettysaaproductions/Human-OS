import { memoryRepository } from '../services/memoryRepository';
import { MemoryType } from '../types/memory';
import { logger } from '../lib/logger';
import { memoryPolicyService } from '../services/MemoryPolicyService';
import { propagateCorrection } from '../services/CorrectionPropagator';
import type { FactCorrectedEvent } from '../types/semanticEvent';



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
  if (['company_name', 'job_title', 'workplace', 'profession'].includes(key)) {
    return 'work';
  }
  if (['goals', 'target', 'objective'].includes(key)) {
    return 'goals';
  }
  return 'personal';
}

export class DeterministicFactAgent {
  async processJob(job: any): Promise<void> {
    const { userId, facts, corrections: eventCorrections, sourceMessage, messageId } = job.payload;

    if (!userId || (!facts && !eventCorrections)) {
      throw new Error('Invalid payload for extract_deterministic_fact');
    }

    // Privacy gate: queued job must re-check at execution time (race safety)
    if (!(await memoryPolicyService.isMemoryEnabled(userId))) {
      logger.info('[DeterministicFactAgent] Memory paused — skipping fact persistence', { userId, messageId });
      return;
    }

    // ── Phase 10: FactCorrectedEvent propagation ────────────────────────
    // Corrections from the SemanticEvent stream are propagated via CorrectionPropagator
    // which handles all scopes (memories, working_memory, profiles, kg_entities).
    if (Array.isArray(eventCorrections) && eventCorrections.length > 0) {
      for (const corrEvent of eventCorrections as FactCorrectedEvent[]) {
        try {
          const result = await propagateCorrection(userId, corrEvent);
          // Phase 10 amendment: explicitly log partial failures — never treat partial as success
          if (!result.fullySucceeded) {
            logger.warn('[DeterministicFactAgent][Phase10] Partial correction propagation failure', {
              userId,
              canonicalKey: corrEvent.canonicalKey,
              newValue: corrEvent.newValue,
              failedScopes: result.scopes.filter(s => !s.success).map(s => ({ scope: s.scope, error: s.error })),
              succeededScopes: result.scopes.filter(s => s.success).map(s => s.scope),
            });
          } else {
            logger.info('[DeterministicFactAgent][Phase10] Correction propagated fully', {
              userId,
              canonicalKey: corrEvent.canonicalKey,
              newValue: corrEvent.newValue,
              supersededValue: result.supersedesValue,
            });
          }
        } catch (err) {
          logger.error('[DeterministicFactAgent][Phase10] CorrectionPropagator threw unexpectedly', {
            canonicalKey: corrEvent.canonicalKey,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    // ── Standard deterministic fact upserts ───────────────────────────────
    if (!Array.isArray(facts)) return;

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
          // Authority: explicit facts outrank deterministic facts
          source_authority: isProtected ? 'explicit_user' : 'deterministic',
          // Retention semantics (Phase 6.1 — unchanged)
          is_protected: isProtected,
          protection_source: isProtected ? 'user_explicit' : undefined,
          // Corrections from TurnAnalyzer carry correction_intent
          correction_intent: fact.factClass === 'PROTECTED_FACT' || fact.isCorrection === true || fact.is_correction === true,
          // Phase 2F-D Temporal Metadata
          valid_from: tm?.valid_from,
          valid_until: tm?.valid_until,
          temporal_precision: tm?.precision,
          temporal_status: tm?.temporal_status,
          temporal_metadata: tm,
          is_future_intent: tm?.is_future_intent,
          lifecycle_state: tm?.temporal_status === 'HISTORICAL' ? 'HISTORICAL' : tm?.is_future_intent ? 'UNKNOWN' : undefined,
          source_message_id: messageId,
          source_references: messageId ? [{ type: 'turn', id: messageId }] : undefined,
        }, sourceMessage || 'Direct Fact Extraction');

        logger.info('[DeterministicFactAgent] Successfully persisted deterministic fact', {
          userId,
          key: fact.key,
          value: fact.value,
          isProtected,
          factClass: fact.factClass || (isProtected ? 'PROTECTED_FACT' : 'HIGH_CONFIDENCE_DURABLE_FACT')
        });
      } catch (err) {
        logger.error('[DeterministicFactAgent] Failed to upsert fact', {
          fact,
          error: err instanceof Error ? err.message : String(err)
        });
      }
    }
  }
}

export const deterministicFactAgent = new DeterministicFactAgent();

