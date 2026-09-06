/**
 * CorrectionPropagator — Centralized fact correction propagation (Phase 10)
 *
 * When a FactCorrectedEvent is produced by the SemanticEvent stream, this
 * service propagates the correction across all tables that may hold stale
 * state for the corrected canonical key.
 *
 * ── Propagation is NOT atomic ──────────────────────────────────────────────
 * Each scope is individually wrapped in try/catch. A failure in one scope
 * does NOT prevent other scopes from running. The result object reports
 * which scopes succeeded and which failed — callers must log and surface
 * partial failures; they MUST NOT treat a partial result as a full success.
 *
 * If true database atomicity is required in the future, wrap the propagation
 * inside a Supabase/Postgres RPC transaction.
 */

import { supabaseAdmin } from '../lib/supabase';
import { logger } from '../lib/logger';
import {
  FactCorrectedEvent,
  isRelationshipKey,
  isProfileMappedKey,
} from '../types/semanticEvent';

export interface PropagationScopeResult {
  scope: string;
  success: boolean;
  error?: string;
}

export interface PropagationResult {
  canonicalKey: string;
  newValue: string;
  priorValue?: string;
  scopes: PropagationScopeResult[];
  /** true if ALL scopes succeeded */
  fullySucceeded: boolean;
  /** true if ANY scope succeeded */
  partiallySucceeded: boolean;
  /** The eventId and value of the DB row that was superseded, if found */
  supersedesEventId?: string;
  supersedesValue?: string;
}

/**
 * Propagate a FactCorrectedEvent across all stale-state scopes.
 *
 * @param userId
 * @param event - The FactCorrectedEvent from the SemanticEvent stream
 * @returns PropagationResult — callers must check fullySucceeded and log failures
 */
export async function propagateCorrection(
  userId: string,
  event: FactCorrectedEvent,
): Promise<PropagationResult> {
  const { canonicalKey, newValue, priorValue } = event;
  const scopes: PropagationScopeResult[] = [];
  let supersedesEventId: string | undefined;
  let supersedesValue: string | undefined;
  const now = new Date().toISOString();

  // ── Scope 1: memories table ────────────────────────────────────────────────
  // Find existing row (for provenance), then upsert the new value.
  try {
    const { data: existing } = await supabaseAdmin
      .from('memories')
      .select('id, value, source_event_id')
      .eq('user_id', userId)
      .eq('key', canonicalKey)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existing) {
      supersedesValue = existing.value;
      supersedesEventId = existing.source_event_id ?? undefined;

      // Soft-invalidate the old row — set confidence to 0 and mark superseded
      await supabaseAdmin
        .from('memories')
        .update({
          confidence: 0,
          is_superseded: true,
          superseded_by_event_id: event.eventId,
          updated_at: now,
        })
        .eq('id', existing.id);
    }

    // Insert corrected value as a new authoritative row
    await supabaseAdmin.from('memories').insert({
      user_id: userId,
      key: canonicalKey,
      value: newValue,
      type: 'personal',
      importance: 100,
      confidence: 1.0,
      is_user_confirmed: true,
      source_authority: 'explicit_user',
      source_event_id: event.eventId,
      source_message: event.sourceMessageId,
      created_at: now,
      updated_at: now,
    });

    scopes.push({ scope: 'memories', success: true });
    logger.info('[CorrectionPropagator] memories: corrected', {
      userId, canonicalKey, newValue, superseded: supersedesValue,
    });
  } catch (err: any) {
    scopes.push({ scope: 'memories', success: false, error: err?.message });
    logger.error('[CorrectionPropagator] memories: FAILED', {
      userId, canonicalKey, error: err?.message,
    });
  }

  // ── Scope 2: working_memory table ─────────────────────────────────────────
  try {
    const { data: wm } = await supabaseAdmin
      .from('working_memory')
      .select('key')
      .eq('user_id', userId)
      .eq('key', canonicalKey)
      .maybeSingle();

    if (wm) {
      await supabaseAdmin
        .from('working_memory')
        .upsert({
          user_id: userId,
          key: canonicalKey,
          value: newValue,
          updated_at: now,
        }, { onConflict: 'user_id,key' });
      scopes.push({ scope: 'working_memory', success: true });
      logger.info('[CorrectionPropagator] working_memory: corrected', { userId, canonicalKey });
    } else {
      scopes.push({ scope: 'working_memory', success: true }); // no-op, not present
    }
  } catch (err: any) {
    scopes.push({ scope: 'working_memory', success: false, error: err?.message });
    logger.warn('[CorrectionPropagator] working_memory: FAILED (non-critical)', {
      userId, canonicalKey, error: err?.message,
    });
  }

  // ── Scope 3: profiles table (profile-mapped keys only) ────────────────────
  if (isProfileMappedKey(canonicalKey)) {
    try {
      // Map canonical key to profile column
      const profileColumn = canonicalKey; // keys are identical (e.g. preferred_name)
      await supabaseAdmin
        .from('profiles')
        .update({ [profileColumn]: newValue, updated_at: now })
        .eq('id', userId);

      scopes.push({ scope: 'profiles', success: true });
      logger.info('[CorrectionPropagator] profiles: corrected', { userId, canonicalKey, newValue });
    } catch (err: any) {
      scopes.push({ scope: 'profiles', success: false, error: err?.message });
      logger.error('[CorrectionPropagator] profiles: FAILED', {
        userId, canonicalKey, error: err?.message,
      });
    }
  }

  // ── Scope 4: KG entities (relationship keys only) ─────────────────────────
  if (isRelationshipKey(canonicalKey)) {
    try {
      // relationship = e.g. 'wife' from 'wife_name'
      const relationship = canonicalKey.replace(/_name$|_nickname$/, '');
      const { data: entity } = await supabaseAdmin
        .from('kg_entities')
        .select('id')
        .eq('user_id', userId)
        .eq('entity_type', 'person')
        .ilike('relationship', relationship)
        .limit(1)
        .maybeSingle();

      if (entity) {
        await supabaseAdmin
          .from('kg_entities')
          .update({ entity: newValue, updated_at: now })
          .eq('id', entity.id);
        scopes.push({ scope: 'kg_entities', success: true });
        logger.info('[CorrectionPropagator] kg_entities: corrected', { userId, relationship, newValue });
      } else {
        scopes.push({ scope: 'kg_entities', success: true }); // no-op
      }
    } catch (err: any) {
      scopes.push({ scope: 'kg_entities', success: false, error: err?.message });
      logger.warn('[CorrectionPropagator] kg_entities: FAILED (non-critical)', {
        userId, canonicalKey, error: err?.message,
      });
    }
  }

  const failedScopes = scopes.filter(s => !s.success);
  const succeededScopes = scopes.filter(s => s.success);

  const result: PropagationResult = {
    canonicalKey,
    newValue,
    priorValue: priorValue ?? supersedesValue,
    scopes,
    fullySucceeded: failedScopes.length === 0,
    partiallySucceeded: succeededScopes.length > 0,
    supersedesEventId,
    supersedesValue,
  };

  if (failedScopes.length > 0) {
    logger.warn('[CorrectionPropagator] Partial propagation failure', {
      userId,
      canonicalKey,
      failedScopes: failedScopes.map(s => ({ scope: s.scope, error: s.error })),
      succeededScopes: succeededScopes.map(s => s.scope),
    });
  }

  return result;
}

