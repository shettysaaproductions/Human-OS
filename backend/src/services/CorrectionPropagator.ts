/**
 * CorrectionPropagator — Centralized fact correction propagation (Phase 10)
 *
 * When a FactCorrectedEvent is produced by the SemanticEvent stream, this
 * service propagates the correction across all tables that may hold stale
 * state for the corrected canonical key.
 *
 * ── Memories scope: TRANSACTIONAL via atomic_supersede_memory (migration 055) ───
 * The memories mutation uses atomic_supersede_memory (defined in migration 055).
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

  // ── Scope 1: memories table — ATOMIC via atomic_supersede_memory (migration 055) ──
  //
  // Function: atomic_supersede_memory (backend/supabase/migrations/055_p2fa_rpc_supersede_memory.sql)
  //
  // The RPC atomically:
  //   1. Validates p_source_message_id exists in chat_history as a user message
  //   2. Validates provenance ordering (incoming must be newer than current)
  //   3. Marks the existing CURRENT row SUPERSEDED (FOR UPDATE locked)
  //   4. Inserts the new CURRENT row
  //   5. Links old row to new via superseded_by
  // On failure, the original CURRENT row remains intact (no zero-CURRENT window).
  // Concurrent inserts handled via retry loop (up to 3 attempts).
  //
  // Migration-055 parameter mapping:
  //   p_user_id          = userId
  //   p_key              = canonicalKey
  //   p_new_value        = newValue          (NOT p_value)
  //   p_memory_type      = 'personal'        (NOT p_type)
  //   p_importance       = 100
  //   p_confidence       = 1.0
  //   p_emotional_weight = 0                 (required; 0 = neutral, no emotional weight)
  //   p_source_message   = null              (free-text label; distinct from p_source_message_id)
  //   p_source_message_id = event.sourceMessageId  (chat_history UUID; must be a user message row)
  //   p_source_authority = 'explicit_user'
  //   p_is_protected     = false
  //   p_protection_source = null
  //   (optional defaults: p_source_references, p_compression_status, p_valid_from, etc.)
  //
  // Return shape (success):  { success: true,  new_id: UUID, superseded_id: UUID|null }
  // Return shape (failure):  { success: false, reason: TEXT, current_id?: UUID, detail?: TEXT }
  // Known reasons: MISSING_PROVENANCE, STALE_WRITE, CONCURRENT_RACE
  //
  // NOTE: p_source_message_id validation runs inside PG. If the sourceMessageId is not
  // a real chat_history row with role='user' for this user, the RPC returns
  // { success: false, reason: 'MISSING_PROVENANCE' }. This is by design — it prevents
  // LLM-invented or fabricated provenance from being written to the DB.
  try {
    const rpcPayload = {
      p_user_id:           userId,
      p_key:               canonicalKey,
      p_new_value:         newValue,
      p_memory_type:       'personal',
      p_importance:        100,
      p_confidence:        1.0,
      p_emotional_weight:  0,
      p_source_message:    null,
      p_source_message_id: event.sourceMessageId,
      p_source_authority:  'explicit_user',
      p_is_protected:      false,
      p_protection_source: null,
    };

    const { data: rpcResult, error: rpcErr } = await supabaseAdmin.rpc(
      'atomic_supersede_memory',
      rpcPayload,
    );

    if (rpcErr) {
      scopes.push({ scope: 'memories', success: false, error: safeErrMsg(rpcErr) });
      logger.error('[CorrectionPropagator] memories: RPC transport error', {
        userId, canonicalKey, eventId: event.eventId, errorCode: rpcErr.code,
      });
    } else if (rpcResult && rpcResult.success === false) {
      // RPC returned structured failure: MISSING_PROVENANCE | STALE_WRITE | CONCURRENT_RACE
      // Return shape: { success: false, reason: TEXT, current_id?: UUID, detail?: TEXT }
      const reason: string = rpcResult.reason ?? 'RPC_REJECTED';
      scopes.push({ scope: 'memories', success: false, error: reason });
      logger.warn('[CorrectionPropagator] memories: RPC rejected mutation', {
        userId, canonicalKey, eventId: event.eventId, reason,
        // currentId is not logged to avoid exposing internal row UUIDs unnecessarily
      });
    } else if (rpcResult && rpcResult.success === true) {
      // Return shape: { success: true, new_id: UUID, superseded_id: UUID|null }
      // superseded_id is the old CURRENT row's UUID (or null if no prior row existed)
      supersedesEventId = rpcResult.superseded_id ?? undefined;
      scopes.push({ scope: 'memories', success: true });
      logger.info('[CorrectionPropagator] memories: correction applied atomically via atomic_supersede_memory', {
        userId, canonicalKey, eventId: event.eventId,
        hasSuperseded: rpcResult.superseded_id != null,
      });
    } else {
      // Unexpected null/undefined result with no error — treat as failure
      scopes.push({ scope: 'memories', success: false, error: 'RPC_NULL_RESULT' });
      logger.error('[CorrectionPropagator] memories: RPC returned null result without error', {
        userId, canonicalKey, eventId: event.eventId,
      });
    }
  } catch (err: any) {
    scopes.push({ scope: 'memories', success: false, error: safeErrMsg(err) });
    logger.error('[CorrectionPropagator] memories: exception during RPC call', {
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
