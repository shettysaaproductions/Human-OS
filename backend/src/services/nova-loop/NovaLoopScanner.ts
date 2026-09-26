/**
 * NovaLoopScanner.ts — Incremental Conversation Evidence Scanner
 *
 * ARCHITECTURAL INVARIANTS:
 * 1. Ordered Dual-Cursor Safety: Cursor uses strictly (created_at, message_id) ordering.
 *    Messages sharing the exact same timestamp are NEVER skipped and NEVER re-processed.
 * 2. Context Window Overlap: Fetches preceding conversation context across checkpoint boundaries
 *    so multi-turn conversational amnesias are reliably surfaced even across batch cuts.
 * 3. Atomic Advancement: Checkpoints advance ONLY after the batch's evaluation findings
 *    and incidents are durably committed to the engineering ledger.
 * 4. Zero In-Flight Request Overhead: Runs completely offline/out-of-band.
 */

import { supabaseAdmin } from '../../lib/supabase';
import { logger } from '../../lib/logger';
import {
  NovaLoopCheckpoint,
  ObservableDialogueEvidence,
  ObservableTurnContext
} from './types';
import { conversationalEvaluator, EvaluationBlockedError } from './ConversationalEvaluator';
import { incidentManager, IncidentRecordResult } from './IncidentManager';
import { CapabilityUnavailableError } from '../../lib/cognitiveRouter';

export interface ScanBatchResult {
  stage: string;
  messagesProcessed: number;
  turnsEvaluated: number;
  incidentsFound: number;
  incidentDetails: IncidentRecordResult[];
  cursorAdvancedTo: {
    created_at: string;
    message_id: string | null;
  } | null;
  evaluationBlocked?: boolean;
  blockedReason?: string;
}

export class NovaLoopScanner {
  private static readonly DEFAULT_STAGE = 'conversational_audit';
  private static readonly DEFAULT_BATCH_SIZE = 50;
  private static readonly CONTEXT_OVERLAP_SIZE = 6;

  /**
   * Fetch or initialize cursor for stage.
   */
  async getCheckpoint(stage: string = NovaLoopScanner.DEFAULT_STAGE): Promise<NovaLoopCheckpoint> {
    const { data, error } = await supabaseAdmin
      .from('nova_loop_checkpoints')
      .select('*')
      .eq('stage', stage)
      .maybeSingle();

    if (error) {
      logger.error('[NovaLoopScanner] Failed to fetch checkpoint', { error: error.message, stage });
      throw error;
    }

    if (!data) {
      const initial: Partial<NovaLoopCheckpoint> = {
        stage,
        last_scanned_created_at: '1970-01-01T00:00:00Z',
        last_scanned_message_id: null,
        total_scanned_count: 0,
        incidents_found: 0,
      };
      const { data: created, error: createErr } = await supabaseAdmin
        .from('nova_loop_checkpoints')
        .insert(initial)
        .select()
        .single();

      if (createErr) throw createErr;
      return created;
    }

    return data;
  }

  /**
   * Execute an incremental scan batch.
   */
  async scanNextBatch(
    batchSize: number = NovaLoopScanner.DEFAULT_BATCH_SIZE,
    stage: string = NovaLoopScanner.DEFAULT_STAGE
  ): Promise<ScanBatchResult> {
    const checkpoint = await this.getCheckpoint(stage);
    const lastCreatedAt = checkpoint.last_scanned_created_at;
    const lastMsgId = checkpoint.last_scanned_message_id;

    // 1. Dual-cursor query: (created_at > lastCreatedAt) OR (created_at == lastCreatedAt AND id > lastMsgId)
    let query = supabaseAdmin
      .from('chat_history')
      .select('id, user_id, conversation_id, role, content, reply_to_id, reply_to_content, meta, created_at, source_type')
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .limit(batchSize);

    const isInitialEpoch = !lastCreatedAt || new Date(lastCreatedAt).getTime() <= 0;
    if (!isInitialEpoch) {
      if (lastMsgId) {
        query = query.or(`created_at.gt.${lastCreatedAt},and(created_at.eq.${lastCreatedAt},id.gt.${lastMsgId})`);
      } else {
        query = query.gt('created_at', lastCreatedAt);
      }
    }

    const { data: rows, error: fetchErr } = await query;
    if (fetchErr) {
      logger.error('[NovaLoopScanner] Error querying chat_history', { error: fetchErr.message });
      throw fetchErr;
    }

    if (!rows || rows.length === 0) {
      return {
        stage,
        messagesProcessed: 0,
        turnsEvaluated: 0,
        incidentsFound: 0,
        incidentDetails: [],
        cursorAdvancedTo: null
      };
    }

    const incidentResults: IncidentRecordResult[] = [];
    let turnsEvaluated = 0;
    let lastHandledIndex = -1;
    let evaluationBlocked = false;
    let blockedReason: string | undefined;

    // 2. Iterate through rows and identify conversational turns (User -> Assistant pairs)
    for (let i = 0; i < rows.length; i++) {
      const current = rows[i];

      // We evaluate Assistant replies against user prompt and context
      if (current.role === 'assistant') {
        turnsEvaluated++;

        // Find immediately preceding user turn for the SAME user and conversation in current batch
        let userTurn: { id: any; role: any; content: any; created_at: any; user_id?: string; conversation_id?: string } | null = null;
        for (let j = i - 1; j >= 0; j--) {
          if (rows[j].user_id === current.user_id && rows[j].conversation_id === current.conversation_id) {
            if (rows[j].role === 'user') {
              userTurn = rows[j];
            }
            break; // Stop at the nearest preceding turn for this conversation
          }
        }

        if (!userTurn) {
          const { data: priorUserMsg } = await supabaseAdmin
            .from('chat_history')
            .select('id, role, content, created_at, user_id, conversation_id')
            .eq('user_id', current.user_id)
            .eq('conversation_id', current.conversation_id)
            .eq('role', 'user')
            .lte('created_at', current.created_at)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

          if (priorUserMsg && priorUserMsg.id !== current.id) {
            userTurn = priorUserMsg;
          }
        }

        // If no user prompt exists for this assistant response across batch and history, skip evaluation
        // to prevent evaluating an orphaned reply or attributing an unrelated prompt.
        if (!userTurn) {
          lastHandledIndex = i;
          continue;
        }

        // Fetch surrounding context with boundary overlap (preceding N turns)
        const { data: contextTurns } = await supabaseAdmin
          .from('chat_history')
          .select('id, role, content, created_at, reply_to_id, reply_to_content')
          .eq('user_id', current.user_id)
          .eq('conversation_id', current.conversation_id)
          .lte('created_at', current.created_at)
          .order('created_at', { ascending: false })
          .limit(NovaLoopScanner.CONTEXT_OVERLAP_SIZE + 1);

        const filteredTurns = (contextTurns || []).filter(t => t.id !== current.id).slice(0, NovaLoopScanner.CONTEXT_OVERLAP_SIZE);
        const surroundingContext: ObservableTurnContext[] = filteredTurns.reverse().map(t => ({
          id: t.id,
          role: t.role as any,
          content: t.content || '',
          created_at: t.created_at,
          reply_to_id: t.reply_to_id,
          reply_to_content: t.reply_to_content
        }));

        const meta = (current.meta as any) || {};

        // Build strictly observable dialogue evidence (NO hidden internal thoughts)
        const evidence: ObservableDialogueEvidence = {
          userId: current.user_id,
          conversationId: current.conversation_id,
          userMessageId: userTurn?.id || 'synthetic_user_id',
          userMessage: userTurn?.content || '',
          userMessageTimestamp: userTurn?.created_at || current.created_at,
          assistantMessageId: current.id,
          assistantResponse: current.content || '',
          assistantResponseTimestamp: current.created_at,
          surroundingContext,
          suppliedContextSummary: meta.situationBrief ? { situationBrief: meta.situationBrief } : undefined,
          actionResults: meta.subconsciousActions || undefined,
          modelMetadata: {
            provider: meta.provider,
            model: meta.model,
          },
        };

        // 3. Evaluate dialogue turn independently
        try {
          const finding = await conversationalEvaluator.evaluateTurn(evidence);

          if (finding) {
            const recorded = await incidentManager.recordFinding(finding, evidence);
            incidentResults.push(recorded);
          }

          // Successfully handled turn
          lastHandledIndex = i;
        } catch (err: any) {
          const isBlocked = err instanceof EvaluationBlockedError || err instanceof CapabilityUnavailableError;
          logger.warn('[NovaLoopScanner] Evaluation blocked or failed; halting batch to protect checkpoint cursor', {
            rowId: current.id,
            role: current.role,
            created_at: current.created_at,
            isBlocked,
            error: err?.message
          });
          evaluationBlocked = true;
          blockedReason = err?.message || 'Evaluation blocked';
          break; // Stop immediately: do not evaluate or advance past this unhandled row!
        }
      }
    }

    // 4. Safe checkpoint advancement:
    // When evaluation is blocked, advance ONLY up to the last successfully handled row (if any).
    // If no rows were successfully handled, DO NOT advance checkpoint at all.
    // When the batch completed cleanly without evaluation blocks, advance across the full batch.
    const targetCommitRow = evaluationBlocked
      ? (lastHandledIndex >= 0 ? rows[lastHandledIndex] : null)
      : rows[rows.length - 1];

    if (!targetCommitRow) {
      logger.warn('[NovaLoopScanner] Batch evaluation halted with no rows committed; checkpoint remains at previous cursor', {
        stage,
        blockedReason,
        lastScannedCreatedAt: lastCreatedAt,
        lastScannedMessageId: lastMsgId
      });

      return {
        stage,
        messagesProcessed: 0,
        turnsEvaluated,
        incidentsFound: incidentResults.length,
        incidentDetails: incidentResults,
        cursorAdvancedTo: null,
        evaluationBlocked: true,
        blockedReason
      };
    }

    const messagesCommitted = evaluationBlocked ? (lastHandledIndex + 1) : rows.length;
    const newCreatedAt = targetCommitRow.created_at;
    const newMsgId = targetCommitRow.id;

    const { error: checkpointErr } = await supabaseAdmin
      .from('nova_loop_checkpoints')
      .update({
        last_scanned_created_at: newCreatedAt,
        last_scanned_message_id: newMsgId,
        total_scanned_count: (checkpoint.total_scanned_count || 0) + messagesCommitted,
        incidents_found: (checkpoint.incidents_found || 0) + incidentResults.length,
        updated_at: new Date().toISOString()
      })
      .eq('stage', stage);

    if (checkpointErr) {
      logger.error('[NovaLoopScanner] Failed to advance checkpoint', { error: checkpointErr.message });
      throw checkpointErr;
    }

    logger.info('[NovaLoopScanner] Batch scan complete', {
      stage,
      messagesProcessed: messagesCommitted,
      turnsEvaluated,
      incidentsFound: incidentResults.length,
      cursorAdvancedTo: { created_at: newCreatedAt, id: newMsgId },
      evaluationBlocked
    });

    return {
      stage,
      messagesProcessed: messagesCommitted,
      turnsEvaluated,
      incidentsFound: incidentResults.length,
      incidentDetails: incidentResults,
      cursorAdvancedTo: {
        created_at: newCreatedAt,
        message_id: newMsgId
      },
      ...(evaluationBlocked ? { evaluationBlocked: true, blockedReason } : {})
    };
  }
}

export const novaLoopScanner = new NovaLoopScanner();
