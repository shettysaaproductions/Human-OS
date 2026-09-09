import { supabaseAdmin } from '../lib/supabase';
import { logger } from '../lib/logger';
import { proactiveGate } from './ProactiveGate';
import { sendNovaReplyNotification } from '../lib/pushNotifications';
import crypto from 'crypto';
import type { OutboundSource } from '../types/outbound';

// ── Structured dispatch result ─────────────────────────────────────────────

/** Terminal statuses: the intent lifecycle is complete, no retry meaningful. */
export type DispatchStatus =
  | 'DELIVERED'           // chat_history persisted + push sent
  | 'DELIVERED_PARTIAL'   // chat_history persisted, push failed or skipped
  | 'NOTIFICATION_SKIPPED' // chat_history persisted, no push token
  | 'SUPPRESSED'          // gate blocked — intent was NOT delivered; retry-eligible
  | 'FAILED_TRANSIENT'    // transient error — retry may succeed
  | 'FAILED_TERMINAL';    // permanent failure — no retry

/** Reason codes for SUPPRESSED status. Closed union — no | string widening. */
export type DispatchSuppressReason =
  | 'DUPLICATE'
  | 'QUIET_HOURS'
  | 'BURDEN'
  | 'MIN_GAP'
  | 'TOMBSTONED'
  | 'POLICY';

/** Reason codes for failure statuses. */
export type DispatchFailureReason =
  | 'ACCOUNT_TOMBSTONED'
  | 'EMPTY_MESSAGE'
  | 'UNKNOWN_STRATEGY'
  | 'RPC_COMMIT_FAILED'
  | 'INTENT_RACE'
  | 'PUSH_FAILED'
  | 'CRASH_WINDOW'
  | 'UNHANDLED';

/** Closed union of all structured reason codes. */
export type DispatchReason = DispatchSuppressReason | DispatchFailureReason;

/**
 * Structured result from OutboundDispatcherService.dispatch().
 *
 * PUSH DELIVERY POLICY: AT-MOST-ONCE
 * ─────────────────────────────────────────────────────────────────────────
 * This dispatcher implements AT-MOST-ONCE push delivery. The sequence is:
 *   1. Insert action_idempotency row (push guard)
 *   2. HTTP push call
 *
 * If the process crashes between steps 1 and 2, the push is permanently
 * skipped on retry (action_idempotency hit → DELIVERED_PARTIAL).
 *
 * This is an intentional trade-off:
 *   ✅ chat_history is durable (RPC-committed before push)
 *   ✅ Duplicate pushes are prevented
 *   ✅ App-open hydration can recover the message
 *   ❌ A push may be lost in the crash window
 *
 * Do NOT describe this as "guaranteed delivery". If eventual push
 * delivery is required, redesign around a durable outbox provider.
 * ─────────────────────────────────────────────────────────────────────────
 */
export interface DispatchResult {
  /** Terminal dispatch status. */
  status: DispatchStatus;
  /** Structured reason code. Always set for SUPPRESSED and FAILED_*. */
  reason?: DispatchReason;
  /** Human-readable detail for logging (not for programmatic branching). */
  detail?: string;
  /** The outbound_intents row ID, if an intent was created. */
  intentId?: string;
  /** True if a transient retry is meaningful. */
  retryable: boolean;
  /** True if the lifecycle is permanently complete (no retry needed). */
  terminal: boolean;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function delivered(intentId: string): DispatchResult {
  return { status: 'DELIVERED', intentId, retryable: false, terminal: true };
}
function deliveredPartial(intentId: string, detail?: string): DispatchResult {
  return { status: 'DELIVERED_PARTIAL', intentId, detail, retryable: false, terminal: true };
}
function notificationSkipped(intentId: string, detail?: string): DispatchResult {
  return { status: 'NOTIFICATION_SKIPPED', intentId, detail, retryable: false, terminal: true };
}
function suppressed(intentId: string | undefined, reason: DispatchSuppressReason, detail?: string): DispatchResult {
  return { status: 'SUPPRESSED', reason, detail, intentId, retryable: true, terminal: false };
}
function failedTransient(intentId?: string, detail?: string): DispatchResult {
  return { status: 'FAILED_TRANSIENT', reason: 'UNHANDLED', detail, intentId, retryable: true, terminal: false };
}
function failedTerminal(intentId: string | undefined, reason: DispatchFailureReason, detail?: string): DispatchResult {
  return { status: 'FAILED_TERMINAL', reason, detail, intentId, retryable: false, terminal: true };
}

export interface OutboundIntentPayload {
  userId: string;
  sourceEngine: OutboundSource;
  intentType: string;
  logicalKey: string;
  idempotencyKey: string;
  context: any;
  generationStrategy: string;
  proposedMessage?: string;
  skipQuietHoursCheck?: boolean;
  /** When true, the gate skips the minimum-gap / ignored-count check.
   *  Set for user-requested reminders; leave false for system-generated outreach. */
  skipMinGapCheck?: boolean;
  outreachId?: string;
  /** Optional priority hint (higher = more important). Used for logging and future scheduling. */
  priority?: number;
  /** Semantic category of what Nova intends to do. */
  proposedAction?: 'MESSAGE' | 'REMINDER' | 'QUESTION' | 'CHECK_IN';
}

export type GenerationStrategy = (context: any) => Promise<string>;

/**
 * OutboundDispatcherService — canonical outbound lifecycle manager.
 *
 * PUSH DELIVERY POLICY: AT-MOST-ONCE (see DispatchResult jsdoc for full contract)
 */
export class OutboundDispatcherService {
  private strategies = new Map<string, GenerationStrategy>();

  constructor() {
    this.strategies.set('none', async () => {
      throw new Error('Strategy "none" should use proposedMessage');
    });
  }

  public registerStrategy(name: string, strategy: GenerationStrategy) {
    this.strategies.set(name, strategy);
  }

  /**
   * Dispatch an outbound intent following the canonical crash-safe lifecycle.
   */
  public async dispatch(payload: OutboundIntentPayload): Promise<DispatchResult> {
    const { userId, idempotencyKey, logicalKey, sourceEngine, intentType, context, generationStrategy, proposedMessage, outreachId: providedOutreachId } = payload;
    let intentId: string | undefined;

    // ── 0. Account Deletion Check ──────────────────────────────────────────
    if (await this.isTombstoned(userId)) {
      logger.warn('[OutboundDispatcher] Aborting dispatch: Account is tombstoned', { userId, idempotencyKey });
      return failedTerminal(undefined, 'ACCOUNT_TOMBSTONED', 'Account tombstoned before intent creation');
    }

    // ── 1. CREATE Intent ───────────────────────────────────────────────────
    try {
      const { data: created, error: createErr } = await supabaseAdmin
        .from('outbound_intents')
        .insert({
          user_id: userId,
          source_engine: sourceEngine,
          intent_type: intentType,
          logical_key: logicalKey,
          idempotency_key: idempotencyKey,
          context,
          generation_strategy: generationStrategy,
          proposed_message: proposedMessage || null,
          outreach_id: providedOutreachId || null,
          status: 'CREATED'
        })
        .select('id, status, outreach_id, chat_message_id')
        .single();

      if (createErr) {
        if (createErr.code === '23505') {
          const { data: existing } = await supabaseAdmin
            .from('outbound_intents')
            .select('id, status, outreach_id, chat_message_id')
            .eq('user_id', userId)
            .eq('idempotency_key', idempotencyKey)
            .single();

          if (!existing) {
             logger.error('[OutboundDispatcher] Race condition fetching existing intent', { userId, idempotencyKey });
             return failedTerminal(undefined, 'INTENT_RACE', 'Race condition: existing intent not found after conflict');
          }
          intentId = existing.id;

          if (existing.status === 'FAILED_TRANSIENT') {
            logger.info('[OutboundDispatcher] Resetting FAILED_TRANSIENT intent for retry', { intentId, existingOutreachId: existing.outreach_id });
            if (existing.outreach_id) {
              await proactiveGate.release(existing.outreach_id);
            }
            await supabaseAdmin
              .from('outbound_intents')
              .update({ status: 'CREATED', failure_reason: null, outreach_id: null, updated_at: new Date().toISOString() })
              .eq('id', existing.id);
            existing.status = 'CREATED';
            existing.outreach_id = null;
          }

          logger.info('[OutboundDispatcher] Resuming existing intent', { intentId, status: existing.status });
          return await this.resumeIntent(existing, payload);
        } else {
          throw createErr;
        }
      }
      intentId = created.id;
      return await this.resumeIntent(created, payload);
    } catch (e: any) {
      logger.error('[OutboundDispatcher] Failed to create intent', { error: e.message, userId, idempotencyKey });
      return failedTransient(intentId, e.message);
    }
  }

  private async isTombstoned(userId: string): Promise<boolean> {
    const { data } = await supabaseAdmin.from('account_tombstones').select('user_id').eq('user_id', userId).maybeSingle();
    return !!data;
  }

  /**
   * Resume processing an intent from its current state.
   * This method handles the state machine and retries idempotently.
   */
  private async resumeIntent(intent: { id: string, status: string, outreach_id: string | null, chat_message_id: string | null }, payload: OutboundIntentPayload): Promise<DispatchResult> {
    let currentStatus = intent.status;
    let outreachId = intent.outreach_id;

    try {
      // ── 2. GATE ────────────────────────────────────────────────────────────
      if (currentStatus === 'CREATED') {
        if (!outreachId) {
          let tzOffsetMinutes = 330; // default to IST (+5:30)
          try {
            const { data: userProfile } = await supabaseAdmin
              .from('profiles')
              .select('timezone_offset, timezone, country')
              .eq('id', payload.userId)
              .maybeSingle();
            if (userProfile) {
              const { resolveUserTzOffsetHours } = await import('./ReminderEngine');
              tzOffsetMinutes = Math.round(resolveUserTzOffsetHours(userProfile) * 60);
            }
          } catch {
            // fallback to default
          }

          const gateRes = await proactiveGate.acquire(payload.userId, {
            outreachType: payload.intentType,
            logicalKey: payload.logicalKey,
            skipQuietHoursCheck: payload.skipQuietHoursCheck || false,
            skipMinGapCheck: payload.skipMinGapCheck || false,
            timezoneOffsetMinutes: tzOffsetMinutes,
          });

          if (!gateRes.allowed) {
            const blockedBy = gateRes.blockedBy || 'POLICY';
            // Map gate block reason to structured DispatchSuppressReason
            const suppressReason: DispatchSuppressReason =
              blockedBy === 'DUPLICATE'    ? 'DUPLICATE'
              : blockedBy === 'QUIET_HOURS' ? 'QUIET_HOURS'
              : blockedBy === 'BURDEN'      ? 'BURDEN'
              : blockedBy === 'MIN_GAP'     ? 'MIN_GAP'
              : 'POLICY';
            await this.updateStatus(intent.id, 'SUPPRESSED', { failure_reason: blockedBy });
            logger.info('[OutboundDispatcher] Intent suppressed by gate', { intentId: intent.id, blockedBy });
            return suppressed(intent.id, suppressReason, blockedBy);
          }

          outreachId = gateRes.outreachId;
        }

        await supabaseAdmin.from('outbound_intents').update({ outreach_id: outreachId, status: 'GATED' }).eq('id', intent.id);
        currentStatus = 'GATED';
      }

      // ── 3. GENERATION ──────────────────────────────────────────────────────
      let finalMessage = payload.proposedMessage;

      if (currentStatus === 'GATED') {
        await this.updateStatus(intent.id, 'DISPATCHING');
        currentStatus = 'DISPATCHING';
      }

      if (currentStatus === 'DISPATCHING') {
        if (payload.generationStrategy !== 'none') {
          const strategy = this.strategies.get(payload.generationStrategy);
          if (!strategy) {
            await this.handleTerminalFailure(intent.id, outreachId, `Unknown generation strategy: ${payload.generationStrategy}`);
            return failedTerminal(intent.id, 'UNKNOWN_STRATEGY', `Unknown strategy: ${payload.generationStrategy}`);
          }
          try {
            finalMessage = await strategy(payload.context);
          } catch (genErr: any) {
            await this.updateStatus(intent.id, 'FAILED_TRANSIENT', { failure_reason: genErr.message });
            if (outreachId) await proactiveGate.release(outreachId);
            throw genErr; // Let the queue retry
          }
        }
        
        if (!finalMessage) {
           await this.handleTerminalFailure(intent.id, outreachId, 'Generation produced empty message');
           return failedTerminal(intent.id, 'EMPTY_MESSAGE', 'Generation produced empty message');
        }
      }

      // ── 4. PERSISTENCE ─────────────────────────────────────────────────────
      if (currentStatus === 'DISPATCHING') {
        // We need a conversation ID to persist
        const { data: latestChat } = await supabaseAdmin
          .from('chat_history')
          .select('conversation_id')
          .eq('user_id', payload.userId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        const conversationId = latestChat?.conversation_id || crypto.randomUUID();

        const chatPayload = {
          user_id: payload.userId,
          conversation_id: conversationId,
          role: 'assistant',
          content: finalMessage,
          meta: {
            hasThoughts: false, // We omit nova_thoughts as per architectural correction 3
            situationBrief: `Proactive message triggered by ${payload.sourceEngine}`
          },
          source_type: payload.intentType === 'followup' ? 'followup'
                     : payload.intentType === 'reminder'  ? 'reminder'
                     : 'nace_outreach',
          outreach_log_id: outreachId
        };

        const { error: rpcErr } = await supabaseAdmin.rpc('rpc_commit_outbound_intent', {
          p_intent_id: intent.id,
          p_chat_history_payload: chatPayload
        });

        if (rpcErr) {
          logger.error('[OutboundDispatcher] RPC commit failed', { error: rpcErr.message, intentId: intent.id });
          await this.updateStatus(intent.id, 'FAILED_TRANSIENT', { failure_reason: rpcErr.message });
          throw new Error(`RPC commit failed: ${rpcErr.message}`);
        }

        currentStatus = 'PERSISTED';
      }

      // ── 4.5. GATE RECONCILIATION & NOTIFICATION MARKER ──────────────────────
      if (currentStatus === 'PERSISTED') {
         // Fetch the actual message from chat_history since it was already persisted
         let messageToCommit = finalMessage;
         if (!messageToCommit) {
            const { data: chatRow } = await supabaseAdmin.from('chat_history').select('content').eq('outreach_log_id', outreachId).limit(1).single();
            messageToCommit = chatRow?.content || '[recovered message]';
         }

         if (outreachId) {
             // Reconcile the existing Gate reservation (idempotent)
             await proactiveGate.commit(outreachId, messageToCommit!);
          }

         // Mark intent as NOTIFICATION_ATTEMPTED before HTTP call
         await this.updateStatus(intent.id, 'NOTIFICATION_ATTEMPTED');
         currentStatus = 'NOTIFICATION_ATTEMPTED';
      }

      // ── 5. NOTIFICATION DELIVERY (AT-MOST-ONCE) ────────────────────────────
      if (currentStatus === 'NOTIFICATION_ATTEMPTED') {
        if (await this.isTombstoned(payload.userId)) {
           await this.updateStatus(intent.id, 'FAILED_TERMINAL', { failure_reason: 'Account tombstoned before push' });
           return failedTerminal(intent.id, 'ACCOUNT_TOMBSTONED', 'Account tombstoned before push');
        }

        // Fetch the push token and the exact message
        let actualMessage = finalMessage;
        let conversationId = '';
        if (!actualMessage) {
            const { data: chatRow } = await supabaseAdmin.from('chat_history').select('content, conversation_id').eq('outreach_log_id', outreachId).limit(1).maybeSingle();
            actualMessage = chatRow?.content || 'Nova has a new message for you.';
            conversationId = chatRow?.conversation_id || '';
        }

        const { data: profile } = await supabaseAdmin.from('profiles').select('push_token').eq('id', payload.userId).maybeSingle();
        
        if (!profile?.push_token) {
           await this.updateStatus(intent.id, 'NOTIFICATION_SKIPPED', { failure_reason: 'No push token' });
           return notificationSkipped(intent.id, 'No push token');
        }

        // We use the idempotency key in the action_idempotency table to prevent 
        // duplicate HTTP calls if the process crashes after this block.
        const idempotencyKeyForPush = `push:${payload.idempotencyKey}`;
        const { error: idempErr } = await supabaseAdmin
          .from('action_idempotency')
          .insert({ user_id: payload.userId, idempotency_key: idempotencyKeyForPush });

        if (idempErr) {
          if (idempErr.code === '23505') {
            // AT-MOST-ONCE DELIVERY — crash-window behavior:
            // The action_idempotency row was inserted in a previous attempt that crashed
            // before the HTTP push completed. Per the AT-MOST-ONCE policy, the push
            // is permanently skipped. chat_history is durable; app-open hydration recovers.
            logger.info('[OutboundDispatcher] At-most-once push guard hit: previous attempt crashed in push window', { intentId: intent.id });
            await this.updateStatus(intent.id, 'DELIVERED_PARTIAL', { failure_reason: 'Push skipped: at-most-once crash window' });
            return deliveredPartial(intent.id, 'at-most-once crash window: push skipped, chat durable');
          }
          throw idempErr;
        }

        // Execute external HTTP call
        try {
          await sendNovaReplyNotification(profile.push_token, actualMessage!, conversationId);
          await this.updateStatus(intent.id, 'DELIVERED');
          currentStatus = 'DELIVERED';
        } catch (pushErr: any) {
          logger.warn('[OutboundDispatcher] External push failed, marking DELIVERED_PARTIAL', { intentId: intent.id, error: pushErr.message });
          await this.updateStatus(intent.id, 'DELIVERED_PARTIAL', { failure_reason: `Push error: ${pushErr.message}` });
          currentStatus = 'DELIVERED_PARTIAL';
        }
      }

      // Return structured result based on final status
      if (currentStatus === 'DELIVERED') return delivered(intent.id);
      if (currentStatus === 'DELIVERED_PARTIAL') return deliveredPartial(intent.id);
      if (currentStatus === 'NOTIFICATION_SKIPPED') return notificationSkipped(intent.id);
      return failedTransient(intent.id, `Unexpected terminal status: ${currentStatus}`);
    } catch (err: any) {
      logger.error('[OutboundDispatcher] Unhandled error during intent resume', { error: err.message, intentId: intent.id });
      throw err; // Allow job to retry if it's transient
    }
  }

  private async updateStatus(intentId: string, status: string, extra?: { failure_reason?: string }) {
    await supabaseAdmin
      .from('outbound_intents')
      .update({ status, ...extra, updated_at: new Date().toISOString() })
      .eq('id', intentId);
  }

  private async handleTerminalFailure(intentId: string, outreachId: string | null, reason: string) {
    logger.error(`[OutboundDispatcher] Terminal failure: ${reason}`, { intentId });
    await this.updateStatus(intentId, 'FAILED_TERMINAL', { failure_reason: reason });
    if (outreachId) {
      await proactiveGate.release(outreachId);
    }
  }
}

export const outboundDispatcherService = new OutboundDispatcherService();
