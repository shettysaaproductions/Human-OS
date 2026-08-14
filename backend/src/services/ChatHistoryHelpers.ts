import { supabaseAdmin } from '../lib/supabase';
import { logger } from '../lib/logger';

/**
 * Saves a proactive or fallback assistant message to chat_history,
 * including a generated meta object and a row in nova_thoughts.
 * This ensures the frontend correctly displays the 'Nova's Subconscious' dropdown.
 */
export async function saveAssistantMessage(
  userId: string,
  conversationId: string,
  content: string,
  engineName: string,
  replyToId?: string
): Promise<void> {
  try {
    const meta = {
      hasThoughts: true,
      situationBrief: `Proactive message triggered by ${engineName}`,
      subconsciousActions: [],
      options: []
    };

    const rowData: any = {
      user_id: userId,
      conversation_id: conversationId,
      role: 'assistant',
      content,
      meta
    };

    if (replyToId) {
      rowData.reply_to_id = replyToId;
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
