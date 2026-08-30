import { supabaseAdmin } from '../lib/supabase';
import { logger } from '../lib/logger';

/**
 * P0-C: Valid values for chat_history.source_type.
 * Identifies which system component generated an assistant message.
 * All historical rows (source_type = null) remain valid — NULL means
 * the source was not recorded (pre-P0 rows or unknown path).
 */
export type ChatSourceType =
  | 'conversational'   // Normal user-initiated reply (chat route)
  | 'nace_outreach'    // NACE 15-min autonomous outreach
  | 'session_start'    // session_start_cognition job
  | 'session_end'      // session_end_proactive_check job
  | 'followup'         // NovaFollowupService scheduled followup
  | 'reminder';        // ReminderEngine notification (future use)

/**
 * Options for autonomous / proactive message attribution (P0-C).
 * All fields are optional — callers set only what they have.
 */
export interface AssistantMessageOpts {
  /** P0-C: source component type */
  sourceType?: ChatSourceType;
  /** P0-C: ID of the nova_outreach_log row, if applicable */
  outreachLogId?: string;
}

/**
 * Saves a proactive or fallback assistant message to chat_history,
 * including a generated meta object and a row in nova_thoughts.
 * This ensures the frontend correctly displays the 'Nova's Subconscious' dropdown.
 *
 * P0-C: accepts optional sourceType and outreachLogId for attribution.
 */
export async function saveAssistantMessage(
  userId: string,
  conversationId: string,
  content: string,
  engineName: string,
  replyToId?: string,
  opts?: AssistantMessageOpts
): Promise<void> {
  try {
    const meta = {
      hasThoughts: true,
      situationBrief: `Proactive message triggered by ${engineName}`,
      subconsciousActions: [],
      options: []
    };

    // Hard strip any leaked XML/JSON (subconscious actions, NOVA tags, raw arrays)
    // that may have slipped into a proactive/background-generated message. This is
    // the last chokepoint before the DB — nothing internal should ever reach the UI.
    const sanitized = String(content)
      .replace(/<subconscious_actions>[\s\S]*?<\/subconscious_actions>/gi, '')
      .replace(/<NOVA_MSG>|<\/NOVA_MSG>/gi, '')
      .replace(/<NOVA_MESSAGE_BREAK>|<\/NOVA_MESSAGE_BREAK>/gi, '')
      .replace(/<reply>|<\/reply>/gi, '')
      .replace(/\{\s*"tool"\s*:[\s\S]*?\}\s*,\s*/g, '')
      .replace(/\[\s*(?:\{[^{}]*tool[^{}]*\}\s*,?\s*)+\]/g, '')
      .trim();

    const rowData: any = {
      user_id: userId,
      conversation_id: conversationId,
      role: 'assistant',
      content: sanitized,
      meta
    };

    if (replyToId) {
      rowData.reply_to_id = replyToId;
    }

    // P0-C: Set source attribution fields when provided
    if (opts?.sourceType) {
      rowData.source_type = opts.sourceType;
    }
    if (opts?.outreachLogId) {
      rowData.outreach_log_id = opts.outreachLogId;
    }

    const { data: savedMsg, error: insertErr } = await supabaseAdmin
      .from('chat_history')
      .insert(rowData)
      .select('id')
      .single();

    if (insertErr) {
      throw new Error(`chat_history insert failed: ${insertErr.message}`);
    }

    if (savedMsg?.id) {
      const thoughtsResult = await supabaseAdmin.from('nova_thoughts').insert({
        chat_message_id: savedMsg.id,
        user_id: userId,
        thoughts: [{
          engine: engineName,
          type: 'action',
          detail: 'Sent a proactive background message.'
        }]
      });

      if (thoughtsResult.error) {
        logger.error(`[ChatHistoryHelpers] FAILED to save thoughts to nova_thoughts for ${engineName}`, {
          userId,
          messageId: savedMsg.id,
          error: thoughtsResult.error.message
        });
      }
    }
  } catch (err) {
    logger.warn(`[ChatHistoryHelpers] Failed to persist message for ${engineName}`, { error: err });
    throw err;
  }
}
