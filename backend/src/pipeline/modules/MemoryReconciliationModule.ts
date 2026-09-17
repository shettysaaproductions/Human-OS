/**
 * MemoryReconciliationModule.ts — Canonical Memory Reconciliation Pipeline Module (Phase 1)
 *
 * ARCHITECTURAL INVARIANTS:
 * 1. ONE CANONICAL MEMORY MODEL:
 *    - Entities live in `memory_bubbles`.
 *    - Facts & attributes live in `memories`, foreign-keyed via `bubble_id`.
 *    - `kg_nodes` kept in lockstep as a read projection to eliminate split-brain.
 * 2. PROVENANCE + CONFIDENCE:
 *    - Source, timestamp, evidence quote, confidence, and acquisition mode preserved.
 * 3. QUALITY GATE:
 *    - Linguistic validation prevents rogue Hindi/Hinglish verbs, postpositions, and garbage.
 */

import { NovaPipelineModule, NovaModuleResult, MemoryEffect } from '../NovaPipelineModule';
import { NovaInputEvent } from '../NovaEvent';
import { NovaPipelineContext } from '../NovaContext';
import { supabaseAdmin } from '../../lib/supabase';
import { logger } from '../../lib/logger';
import { memoryRepository } from '../../services/memoryRepository';
import { canonicalMemoryTreeService } from '../../services/CanonicalMemoryTreeService';
import { isValidEntityName, isValidMemoryAttributeValue } from '../../lib/entitySemanticValidator';

export class MemoryReconciliationModule implements NovaPipelineModule {
  readonly name = 'MemoryReconciliationModule';
  readonly version = '1.0.0';
  readonly description = 'Authoritative entity-fact reconciliation across memory_bubbles and memories';
  readonly dependencies: string[] = [];
  readonly requirements: {
    permissions?: string[];
    platformSupport?: ('server' | 'android' | 'ios')[];
    requiresAuth?: boolean;
  } = {
    requiresAuth: true,
    platformSupport: ['server', 'android', 'ios'],
  };

  canHandle(event: NovaInputEvent): boolean {
    return event.type === 'MEMORY_RECONCILE';
  }

  async process(event: NovaInputEvent, context: NovaPipelineContext): Promise<NovaModuleResult> {
    const effects = (event as any).payload?.memoryEffects as MemoryEffect[] || [];
    const reconciliationResults: unknown[] = [];

    for (const effect of effects) {
      const res = await this.reconcileEffect(context.userId, effect);
      reconciliationResults.push(res);
    }

    return {
      success: true,
      data: { reconciledCount: reconciliationResults.length, results: reconciliationResults },
      emittedEvents: [],
      memoryEffects: [],
    };
  }

  /**
   * Reconciles a single memory effect into the canonical memory hierarchy.
   */
  async reconcileEffect(userId: string, effect: MemoryEffect): Promise<{ status: string; bubbleId?: string; memoryId?: string }> {
    try {
      // ── 1. Reconcile ENTITY Effect ──────────────────────────────────────────
      if (effect.kind === 'ENTITY') {
        if (!isValidEntityName(effect.subjectEntityName, 'person')) {
          logger.warn('[MemoryReconciliation] Blocked invalid entity name', {
            name: effect.subjectEntityName,
            userId,
          });
          return { status: 'rejected_invalid_entity_name' };
        }

        const domain = (effect.domainKey || 'family') as any;
        const relation = effect.relationType || 'Friend';

        const bubbleRecord = await canonicalMemoryTreeService.resolveOrCreateEntityBubble(
          userId,
          {
            entityName: effect.subjectEntityName,
            relationType: relation,
            domainKey: domain,
          }
        );
        const bubbleId = typeof bubbleRecord === 'string' ? bubbleRecord : (bubbleRecord as any)?.id;

        // Keep kg_nodes in sync for backwards-compatibility read projection
        try {
          await supabaseAdmin.from('kg_nodes').upsert({
            user_id: userId,
            name: effect.subjectEntityName,
            entity_type: effect.relationType || 'person',
            bubble_id: bubbleId,
            attributes: {
              bubble_id: bubbleId,
              provenance: effect.provenance,
              confidence: effect.confidence,
              updated_at: new Date().toISOString(),
            },
            updated_at: new Date().toISOString(),
          }, { onConflict: 'user_id,name' });
        } catch (kgErr: any) {
          logger.debug('[MemoryReconciliation] Backwards-compat kg_nodes sync non-fatal', { error: kgErr.message });
        }

        return { status: 'entity_reconciled', bubbleId };
      }

      // ── 2. Reconcile ATTRIBUTE Effect ───────────────────────────────────────
      if (effect.kind === 'ATTRIBUTE' && effect.predicate && effect.value) {
        if (!isValidMemoryAttributeValue(effect.predicate, effect.value)) {
          logger.warn('[MemoryReconciliation] Blocked invalid attribute value', {
            predicate: effect.predicate,
            value: effect.value,
            userId,
          });
          return { status: 'rejected_invalid_attribute' };
        }

        let bubbleId: string | undefined = effect.parentBubbleId;

        // If direct user fact, bubbleId is undefined or user root
        if (effect.subjectEntityId !== 'user:self' && !bubbleId) {
          const bubbleRecord = await canonicalMemoryTreeService.resolveOrCreateEntityBubble(
            userId,
            {
              entityName: effect.subjectEntityName,
              relationType: 'Associate',
              domainKey: (effect.domainKey || 'family') as any,
            }
          );
          bubbleId = typeof bubbleRecord === 'string' ? bubbleRecord : (bubbleRecord as any)?.id;
        }

        // Canonical Key Formatting:
        // Direct user: "company_name", "military_service", "city"
        // Third-party / specific entity: "entity:<slug>:<predicate>"
        const canonicalKey = effect.subjectEntityId === 'user:self'
          ? effect.predicate
          : `${effect.subjectEntityId}:${effect.predicate}`;

        await memoryRepository.upsertMemory(
          userId,
          {
            key: canonicalKey,
            value: effect.value,
            type: (effect.domainKey as any) || 'lifestyle',
            confidence: effect.confidence || 0.95,
            shouldPersist: true,
            importance: 3,
            source_message_id: effect.provenance.sourceMessageId,
            source_authority: 'explicit_user',
          },
          effect.provenance.evidenceText || effect.value
        );

        // Link bubble_id to memory row if entity-scoped
        if (bubbleId) {
          try {
            await supabaseAdmin
              .from('memories')
              .update({ bubble_id: bubbleId })
              .eq('user_id', userId)
              .eq('key', canonicalKey)
              .eq('is_archived', false);
          } catch (linkErr: any) {
            logger.debug('[MemoryReconciliation] Linking bubble_id to memory non-fatal', { error: linkErr.message });
          }
        }

        // Also update the bubble metadata attribute snapshot if attached to a bubble
        if (bubbleId) {
          try {
            const { data: bubble } = await supabaseAdmin
              .from('memory_bubbles')
              .select('metadata')
              .eq('id', bubbleId)
              .single();

            const currentMeta = (bubble?.metadata as Record<string, unknown>) || {};
            const attributes = (currentMeta.attributes as Record<string, unknown>) || {};
            attributes[effect.predicate] = effect.value;

            await supabaseAdmin
              .from('memory_bubbles')
              .update({
                metadata: {
                  ...currentMeta,
                  attributes,
                  last_reconciled_at: new Date().toISOString(),
                },
                updated_at: new Date().toISOString(),
              })
              .eq('id', bubbleId);
          } catch (bubbleUpdateErr: any) {
            logger.warn('[MemoryReconciliation] Bubble metadata attribute sync non-fatal', {
              error: bubbleUpdateErr.message,
            });
          }
        }

        return { status: 'attribute_reconciled', bubbleId };
      }

      return { status: 'unhandled_effect_kind' };
    } catch (err: any) {
      logger.error('[MemoryReconciliation] Error reconciling memory effect', {
        error: err.message,
        effect,
        userId,
      });
      return { status: 'error' };
    }
  }
}

export const memoryReconciliationModule = new MemoryReconciliationModule();
