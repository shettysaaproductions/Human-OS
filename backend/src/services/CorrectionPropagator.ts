/**
 * CorrectionPropagator — Centralized fact correction propagation (Phase 10)
 *
 * When a FactCorrectedEvent is produced by the SemanticEvent stream, this
 * service propagates the correction across all tables that may hold stale
 * state for the corrected canonical key.
 *
 * ── Memories scope: TRANSACTIONAL via rpc_supersede_memory ───────────────────
 * The memories mutation uses the existing rpc_supersede_memory Postgres function
 * (migration 055_p2fa_rpc_supersede_memory.sql) which atomically:
 *   1. Locks the current CURRENT row FOR UPDATE
 *   2. Marks it superseded
 *   3. Inserts the new authoritative CURRENT row
 *   4. Handles concurrent inserts via retry loop
 * This guarantees exactly one CURRENT row. A partial failure cannot leave the
 * user with zero authoritative memory for the key.
 *
 * ── Other scopes: per-scope isolation ────────────────────────────────────────
 * working_memory, profiles, kg_entities are individually try/catch isolated.
 * A failure in one scope does NOT prevent other scopes from running.
 *
 * ── Error contract ────────────────────────────────────────────────────────────
 * Every Supabase call inspects the returned { error } object.
 * Supabase does NOT throw on DB errors — it returns { data, error }.
 * Ignoring { error } produces silent success reports for failed mutations.
 * This file treats ANY non-null { error } as scope failure.
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
  scopes: PropagationScopeResult[];
  /** true if ALL scopes succeeded */
  fullySucceeded: boolean;
  /** true if ANY scope succeeded */
  partiallySucceeded: boolean;
  /** The eventId of the DB row that was superseded, if found (provenance only) */
  supersedesEventId?: string;
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
  const { canonicalKey, newValue } = event;
  const scopes: PropagationScopeResult[] = [];
  let supersedesEventId: string | undefined;
  const now = new Date().toISOString();

  // ── Scope 1: memories table — ATOMIC via rpc_supersede_memory ─────────────
  // The RPC handles supersede+insert atomically in a single Postgres transaction.
  // On failure, the original CURRENT row remains intact (no zero-CURRENT window).
  try {
    const rpcPayload = {
      p_user_id: userId,
      p_key: canonicalKey,
      p_value: newValue,
      p_type: 'personal',
      p_importance: 100,
      p_confidence: 1.0,
      p_is_user_confirmed: true,
      p_source_authority: 'explicit_user',
      p_source_event_id: event.eventId,
      p_source_message: event.sourceMessageId ?? null,
      p_is_protected: false,
      p_protection_source: null,
    };

    const { data: rpcResult, error: rpcErr } = await supabaseAdmin.rpc(
      'rpc_supersede_memory',
      rpcPayload,
    );

    if (rpcErr) {
      scopes.push({ scope: 'memories', success: false, error: safeErrMsg(rpcErr) });
      logger.error('[CorrectionPropagator] memories: RPC call failed', {
        userId, canonicalKey, eventId: event.eventId, errorCode: rpcErr.code,
      });
    } else if (rpcResult && rpcResult.success === false) {
      // RPC returned structured failure (e.g. STALE_WRITE, MISSING_PROVENANCE)
      const reason = rpcResult.reason ?? 'RPC_REJECTED';
      scopes.push({ scope: 'memories', success: false, error: reason });
      logger.warn('[CorrectionPropagator] memories: RPC rejected mutation', {
        userId, canonicalKey, eventId: event.eventId, reason,
      });
    } else {
      // RPC succeeded — extract provenance from result
      if (rpcResult?.superseded_id) {
        supersedesEventId = rpcResult.superseded_source_event_id ?? undefined;
      }
      scopes.push({ scope: 'memories', success: true });
      logger.info('[CorrectionPropagator] memories: correction applied atomically', {
        userId, canonicalKey, eventId: event.eventId,
      });
    }
  } catch (err: any) {
    scopes.push({ scope: 'memories', success: false, error: safeErrMsg(err) });
    logger.error('[CorrectionPropagator] memories: exception', {
      userId, canonicalKey, eventId: event.eventId, error: err?.message,
    });
  }

  // ── Scope 2: working_memory table ─────────────────────────────────────────
  try {
    const { data: wm, error: selectErr } = await supabaseAdmin
      .from('working_memory')
      .select('key')
      .eq('user_id', userId)
      .eq('key', canonicalKey)
      .maybeSingle();

    if (selectErr) {
      scopes.push({ scope: 'working_memory', success: false, error: safeErrMsg(selectErr) });
      logger.warn('[CorrectionPropagator] working_memory: select failed', {
        userId, canonicalKey, eventId: event.eventId, errorCode: selectErr.code,
      });
    } else if (wm) {
      const { error: upsertErr } = await supabaseAdmin
        .from('working_memory')
        .upsert({
          user_id: userId,
          key: canonicalKey,
          value: newValue,
          updated_at: now,
        }, { onConflict: 'user_id,key' });

      if (upsertErr) {
        scopes.push({ scope: 'working_memory', success: false, error: safeErrMsg(upsertErr) });
        logger.warn('[CorrectionPropagator] working_memory: upsert failed', {
          userId, canonicalKey, eventId: event.eventId, errorCode: upsertErr.code,
        });
      } else {
        scopes.push({ scope: 'working_memory', success: true });
        logger.info('[CorrectionPropagator] working_memory: correction applied', {
          userId, canonicalKey, eventId: event.eventId,
        });
      }
    } else {
      scopes.push({ scope: 'working_memory', success: true }); // no-op, key not present
    }
  } catch (err: any) {
    scopes.push({ scope: 'working_memory', success: false, error: safeErrMsg(err) });
    logger.warn('[CorrectionPropagator] working_memory: exception', {
      userId, canonicalKey, eventId: event.eventId, error: err?.message,
    });
  }

  // ── Scope 3: profiles table (profile-mapped keys only) ────────────────────
  if (isProfileMappedKey(canonicalKey)) {
    try {
      const profileColumn = canonicalKey;
      const { error: updateErr } = await supabaseAdmin
        .from('profiles')
        .update({ [profileColumn]: newValue, updated_at: now })
        .eq('id', userId);

      if (updateErr) {
        scopes.push({ scope: 'profiles', success: false, error: safeErrMsg(updateErr) });
        logger.error('[CorrectionPropagator] profiles: update failed', {
          userId, canonicalKey, eventId: event.eventId, errorCode: updateErr.code,
        });
      } else {
        scopes.push({ scope: 'profiles', success: true });
        logger.info('[CorrectionPropagator] profiles: correction applied', {
          userId, canonicalKey, eventId: event.eventId,
        });
      }
    } catch (err: any) {
      scopes.push({ scope: 'profiles', success: false, error: safeErrMsg(err) });
      logger.error('[CorrectionPropagator] profiles: exception', {
        userId, canonicalKey, eventId: event.eventId, error: err?.message,
      });
    }
  }

  // ── Scope 4: KG entities (relationship keys only) ─────────────────────────
  if (isRelationshipKey(canonicalKey)) {
    try {
      const relationship = canonicalKey.replace(/_name$|_nickname$/, '');
      const { data: entity, error: selectErr } = await supabaseAdmin
        .from('kg_entities')
        .select('id')
        .eq('user_id', userId)
        .eq('entity_type', 'person')
        .ilike('relationship', relationship)
        .limit(1)
        .maybeSingle();

      if (selectErr) {
        scopes.push({ scope: 'kg_entities', success: false, error: safeErrMsg(selectErr) });
        logger.warn('[CorrectionPropagator] kg_entities: select failed', {
          userId, canonicalKey, eventId: event.eventId, errorCode: selectErr.code,
        });
      } else if (entity) {
        const { error: updateErr } = await supabaseAdmin
          .from('kg_entities')
          .update({ entity: newValue, updated_at: now })
          .eq('id', entity.id);

        if (updateErr) {
          scopes.push({ scope: 'kg_entities', success: false, error: safeErrMsg(updateErr) });
          logger.warn('[CorrectionPropagator] kg_entities: update failed', {
            userId, canonicalKey, eventId: event.eventId, errorCode: updateErr.code,
          });
        } else {
          scopes.push({ scope: 'kg_entities', success: true });
          logger.info('[CorrectionPropagator] kg_entities: correction applied', {
            userId, canonicalKey, eventId: event.eventId,
          });
        }
      } else {
        scopes.push({ scope: 'kg_entities', success: true }); // no-op, entity not found
      }
    } catch (err: any) {
      scopes.push({ scope: 'kg_entities', success: false, error: safeErrMsg(err) });
      logger.warn('[CorrectionPropagator] kg_entities: exception', {
        userId, canonicalKey, eventId: event.eventId, error: err?.message,
      });
    }
  }

  const failedScopes = scopes.filter(s => !s.success);
  const succeededScopes = scopes.filter(s => s.success);

  const result: PropagationResult = {
    canonicalKey,
    scopes,
    fullySucceeded: failedScopes.length === 0 && scopes.length > 0,
    partiallySucceeded: succeededScopes.length > 0,
    supersedesEventId,
  };

  if (failedScopes.length > 0) {
    logger.warn('[CorrectionPropagator] Partial propagation failure', {
      userId,
      canonicalKey,
      eventId: event.eventId,
      failedScopes: failedScopes.map(s => ({ scope: s.scope, error: s.error })),
      succeededScopes: succeededScopes.map(s => s.scope),
    });
  }

  return result;
}

/** Returns a safe non-PII error message from a Supabase error object or thrown error. */
function safeErrMsg(err: any): string {
  if (!err) return 'unknown';
  // Supabase error objects have .message and .code
  if (typeof err === 'object') {
    const code = err.code ? `[${err.code}]` : '';
    const msg = err.message ?? 'DB error';
    return `${code} ${msg}`.trim();
  }
  return String(err);
}
