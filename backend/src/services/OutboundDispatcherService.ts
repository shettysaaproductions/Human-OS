import { supabaseAdmin } from '../lib/supabase';
import { logger } from '../lib/logger';
import { proactiveGate } from './ProactiveGate';
import { sendNovaReplyNotification } from '../lib/pushNotifications';
import crypto from 'crypto';

export interface OutboundIntentPayload {
  userId: string;
  sourceEngine: string;
  intentType: string;
  logicalKey: string;
  idempotencyKey: string;
  context: any;
  generationStrategy: string;
  proposedMessage?: string;
  skipQuietHoursCheck?: boolean;
  outreachId?: string;
}

export type GenerationStrategy = (context: any) => Promise<string>;

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
  public async dispatch(payload: OutboundIntentPayload): Promise<string> {
    const { userId, idempotencyKey, logicalKey, sourceEngine, intentType, context, generationStrategy, proposedMessage, outreachId: providedOutreachId } = payload;
    let intentId: string;

    // ── 0. Account Deletion Check ──────────────────────────────────────────
    if (await this.isTombstoned(userId)) {
      logger.warn('[OutboundDispatcher] Aborting dispatch: Account is tombstoned', { userId, idempotencyKey });
      return 'FAILED_TERMINAL'; // Terminal failure
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
          // Idempotency constraint hit. We must fetch the existing intent to resume it.
          const { data: existing } = await supabaseAdmin
            .from('outbound_intents')
            .select('id, status, outreach_id, chat_message_id')
            .eq('user_id', userId)
            .eq('idempotency_key', idempotencyKey)
            .single();

          if (!existing) {
             logger.error('[OutboundDispatcher] Race condition fetching existing intent', { userId, idempotencyKey });
             return 'FAILED_TERMINAL';
          }
          intentId = existing.id;
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
      return 'FAILED_TRANSIENT';
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
  private async resumeIntent(intent: { id: string, status: string, outreach_id: string | null, chat_message_id: string | null }, payload: OutboundIntentPayload): Promise<string> {
    let currentStatus = intent.status;
    let outreachId = intent.outreach_id;

    try {
      // ── 2. GATE ────────────────────────────────────────────────────────────
      if (currentStatus === 'CREATED') {
        if (!outreachId) {
          const gateRes = await proactiveGate.acquire(payload.userId, {
            outreachType: payload.intentType,
            logicalKey: payload.logicalKey,
            skipQuietHoursCheck: payload.skipQuietHoursCheck || false,
            isUrgent: payload.intentType === 'reminder' || payload.skipQuietHoursCheck,
          });

          if (!gateRes.allowed) {
            await this.updateStatus(intent.id, 'SUPPRESSED', { failure_reason: gateRes.blockedBy });
            logger.info('[OutboundDispatcher] Intent suppressed by gate', { intentId: intent.id, blockedBy: gateRes.blockedBy });
            return 'SUPPRESSED';
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
            return 'FAILED_TERMINAL';
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
           return 'FAILED_TERMINAL';
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
          source_type: payload.intentType === 'followup' ? 'followup' : 'nace_outreach',
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
           return 'FAILED_TERMINAL';
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
           return 'NOTIFICATION_SKIPPED';
        }

        // We use the idempotency key in the action_idempotency table to prevent 
        // duplicate HTTP calls if the process crashes after this block.
        const idempotencyKeyForPush = `push:${payload.idempotencyKey}`;
        const { error: idempErr } = await supabaseAdmin
          .from('action_idempotency')
          .insert({ user_id: payload.userId, idempotency_key: idempotencyKeyForPush });

        if (idempErr) {
          if (idempErr.code === '23505') {
            // We already attempted this push in a previous crashed run.
            logger.info('[OutboundDispatcher] At-most-once push guard hit, skipping push', { intentId: intent.id });
            await this.updateStatus(intent.id, 'DELIVERED_PARTIAL', { failure_reason: 'Push skipped due to previous crash' });
            return 'DELIVERED_PARTIAL';
          }
          // If insert fails for other reasons, we abort. The intent stays in NOTIFICATION_ATTEMPTED.
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

      return currentStatus;
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
