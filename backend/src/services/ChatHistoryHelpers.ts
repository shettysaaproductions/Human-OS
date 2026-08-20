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
