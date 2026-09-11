/**
 * FactAssertionConsumer — Phase 11 canonical fact writer.
 *
 * AUTHORITY INVARIANT:
 *   Input: FactAssertedEvent | RelationshipAssertedEvent
 *   These events have already passed:
 *     SemanticInterpreter → SemanticValidator → toSemanticEvents()
 *   No further LLM interpretation. No re-parsing of the raw message.
 *
 * IDEMPOTENCY:
 *   memoryRepository.upsertMemory() uses ON CONFLICT(user_id, key) semantics.
 *   Replaying the same event is safe — same key+value produces no duplicate row.
 *
 * PROVENANCE:
 *   sourceMessageId from the event maps to source_message_id in the DB row.
 *   authority from the event maps to source_authority.
 */

import { memoryRepository } from '../services/memoryRepository';
import { supabaseAdmin } from '../lib/supabase';
import { logger } from '../lib/logger';
import { memoryPolicyService } from '../services/MemoryPolicyService';
import type { FactAssertedEvent, RelationshipAssertedEvent, SemanticEvent } from '../types/semanticEvent';
import { isFactAsserted, isRelationshipAsserted } from '../types/semanticEvent';
import type { MemoryType } from '../types/memory';
import { classifyDomain } from '../lib/memoryDomains';

// ── Memory type routing ─────────────────────────────────────────────────────
const FAMILY_KEY_MAP: Record<string, MemoryType> = {
  mother_name: 'family', mother_nickname: 'family',
  father_name: 'family', father_nickname: 'family',
  wife_name: 'family',   wife_nickname: 'family',
  husband_name: 'family', husband_nickname: 'family',
  son_name: 'family',    son_nickname: 'family',
  daughter_name: 'family', daughter_nickname: 'family',
  sister_name: 'family', sister_nickname: 'family',
  brother_name: 'family', brother_nickname: 'family',
};

function memoryTypeForKey(key: string): MemoryType {
  if (FAMILY_KEY_MAP[key]) return FAMILY_KEY_MAP[key];
  const domainMeta = classifyDomain(key);
  if (domainMeta.domain === 'family') return 'family';
  if (domainMeta.domain === 'work') return 'work';
  if (domainMeta.domain === 'goals') return 'goals';
  if (domainMeta.domain === 'lifestyle') return 'preferences';
  return 'personal';
}

// ── Scoped result type ──────────────────────────────────────────────────────
export interface FactConsumeResult {
  eventId: string;
  family: 'FactAsserted' | 'RelationshipAsserted';
  canonicalKey: string;
  success: boolean;
  skipped?: boolean;
  skipReason?: string;
  error?: string;
}

// ── Consumer ────────────────────────────────────────────────────────────────
export class FactAssertionConsumer {
  /**
   * Consume a list of FactAsserted / RelationshipAsserted SemanticEvents.
   *
   * Only processes events of the two supported families; others are ignored.
   * Privacy gate is re-checked at execution time (queue race safety).
   */
  async consume(
    userId: string,
    events: SemanticEvent[],
    sourceMessage?: string,
  ): Promise<FactConsumeResult[]> {
    if (!events || events.length === 0) return [];

    // Privacy gate — must re-check at consumption time
    if (!(await memoryPolicyService.isMemoryEnabled(userId))) {
      logger.info('[FactAssertionConsumer] Memory paused — skipping all events', { userId });
      return events
        .filter(e => isFactAsserted(e) || isRelationshipAsserted(e))
        .map(e => ({
          eventId: e.eventId,
          family: e.family as 'FactAsserted' | 'RelationshipAsserted',
          canonicalKey: (e as any).canonicalKey,
          success: false,
          skipped: true,
          skipReason: 'memory_paused',
        }));
    }

    const results: FactConsumeResult[] = [];

    for (const event of events) {
      if (isFactAsserted(event)) {
        results.push(await this.consumeFactAsserted(userId, event, sourceMessage));
      } else if (isRelationshipAsserted(event)) {
        results.push(await this.consumeRelationshipAsserted(userId, event, sourceMessage));
      }
      // Other families are silently ignored — not this consumer's concern
    }

    return results;
  }

  // ── FactAsserted handler ─────────────────────────────────────────────────
  private async consumeFactAsserted(
    userId: string,
    event: FactAssertedEvent,
    sourceMessage?: string,
  ): Promise<FactConsumeResult> {
    const { eventId, canonicalKey, value, authority, sourceMessageId } = event;
    const base = { eventId, family: 'FactAsserted' as const, canonicalKey };

    try {
      await memoryRepository.upsertMemory(
        userId,
        {
          type: memoryTypeForKey(canonicalKey),
          key: canonicalKey,
          value,
          importance: authority === 'explicit_user' ? 90 : 75,
          confidence: 0.95,
          shouldPersist: true,
          source_authority: authority === 'explicit_user' ? 'explicit_user' : 'deterministic',
          is_protected: authority === 'explicit_user',
          protection_source: authority === 'explicit_user' ? 'user_explicit' : undefined,
          correction_intent: false,
          source_message_id: sourceMessageId,
          source_references: sourceMessageId ? [{ type: 'turn', id: sourceMessageId }] : undefined,
        },
        sourceMessage || 'FactAssertionConsumer',
      );

      logger.info('[FactAssertionConsumer] Persisted FactAsserted', {
        userId,
        canonicalKey,
        authority,
        eventId,
      });
      return { ...base, success: true };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      logger.error('[FactAssertionConsumer] Failed to persist FactAsserted', {
        userId, canonicalKey, eventId, error,
      });
      return { ...base, success: false, error };
    }
  }

  // ── RelationshipAsserted handler ─────────────────────────────────────────
  private async consumeRelationshipAsserted(
    userId: string,
    event: RelationshipAssertedEvent,
    sourceMessage?: string,
  ): Promise<FactConsumeResult> {
    const { eventId, canonicalKey, relatedPersonName, relationship, sourceMessageId } = event;
    const base = { eventId, family: 'RelationshipAsserted' as const, canonicalKey };

    try {
      // 1. Write the canonical memory row (same as FactAsserted, explicit_user authority)
      await memoryRepository.upsertMemory(
        userId,
        {
          type: 'family',
          key: canonicalKey,
          value: relatedPersonName,
          importance: 90,
          confidence: 0.98,
          shouldPersist: true,
          source_authority: 'explicit_user',
          is_protected: true,
          protection_source: 'user_explicit',
          correction_intent: false,
          source_message_id: sourceMessageId,
          source_references: sourceMessageId ? [{ type: 'turn', id: sourceMessageId }] : undefined,
        },
        sourceMessage || 'FactAssertionConsumer',
      );

      // 2. Write KG entity (relationship graph)
      //    ON CONFLICT DO NOTHING via upsert-equivalent: ignore if already present
      const { error: kgError } = await supabaseAdmin
        .from('kg_entities')
        .upsert(
          {
            user_id: userId,
            entity: relatedPersonName,
            entity_type: 'person',
            relationship,
            attributes: { canonical_key: canonicalKey, source_message_id: sourceMessageId },
          },
          { onConflict: 'user_id,entity,relationship', ignoreDuplicates: true },
        );

      if (kgError) {
        // Non-fatal: memory row succeeded, KG is supplementary
        logger.warn('[FactAssertionConsumer] KG entity upsert failed (non-fatal)', {
          userId, entity: relatedPersonName, relationship, error: kgError.message,
        });
      }

      logger.info('[FactAssertionConsumer] Persisted RelationshipAsserted', {
        userId,
        canonicalKey,
        relationship,
        relatedPersonName,
        eventId,
      });
      return { ...base, success: true };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      logger.error('[FactAssertionConsumer] Failed to persist RelationshipAsserted', {
        userId, canonicalKey, eventId, error,
      });
      return { ...base, success: false, error };
    }
  }
}

export const factAssertionConsumer = new FactAssertionConsumer();
