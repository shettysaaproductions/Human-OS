/**
 * InstantFallbackRecoveryService — Autonomous Upfront Self-Healing for Nova
 *
 * When any LLM timeout or stall occurs and a fallback reply ("Hmm... mujhe thoda sochne de...")
 * is temporarily saved to keep the UI from freezing, this service instantly and autonomously
 * springs into action:
 *
 * 1. Leverages Nova's 21-LLM fleet (specifically unstarved, independent brain regions like
 *    Cerebellum keys 3/11/12, Deep Cortex keys 13/14, or Gemini reserve slots).
 * 2. Generates Nova's warm, real, in-character companion reply answering the user's specific text.
 * 3. Persists the real reply to chat_history within 1.5 - 3 seconds.
 * 4. Pushes an immediate notification to the user's device so Nova upfrontly comes back
 *    without the user having to re-send or wait.
 */

import { supabaseAdmin } from '../lib/supabase';
import { logger } from '../lib/logger';
import { saveAssistantMessage } from './ChatHistoryHelpers';
import { sendNovaReplyNotification } from '../lib/pushNotifications';
import { sanitizeReply, isPromptLeak, NOVA_EMPTY_REPLY } from './NovaBrainService';
import { complete as nvidiaComplete } from '../lib/nvidia';
import { geminiComplete } from '../lib/gemini';
import { cognitiveRouter } from '../lib/cognitiveRouter';

export interface RecoveryRequest {
  userId: string;
  conversationId: string;
  userMessageText: string;
  replyToId?: string;
  failedProvider?: 'gemini' | 'nvidia' | 'unknown';
}

class InstantFallbackRecoveryService {
  private inFlightRecoveries = new Set<string>();

  /**
   * Fire-and-forget trigger for upfront autonomous recovery.
   */
  triggerInstantUpfrontRecovery(request: RecoveryRequest): void {
    const lockKey = `${request.userId}:${request.conversationId}:${request.userMessageText.slice(0, 40)}`;
    if (this.inFlightRecoveries.has(lockKey)) {
      logger.debug('[InstantRecovery] Recovery already in flight for turn, skipping duplicate', { lockKey });
      return;
    }

    this.inFlightRecoveries.add(lockKey);

    // Schedule immediately on the next event loop tick (< 50ms)
    setImmediate(async () => {
      try {
        await this.executeRecovery(request);
      } catch (err) {
        logger.error('[InstantRecovery] Failed to complete upfront recovery', {
          userId: request.userId,
          conversationId: request.conversationId,
          error: err instanceof Error ? err.message : String(err),
        });
      } finally {
        // Keep lock for 30 seconds to prevent double firing
        const timer = setTimeout(() => this.inFlightRecoveries.delete(lockKey), 30_000);
        if (typeof (timer as any).unref === 'function') (timer as any).unref();
      }
    });
  }

  async executeRecovery(request: RecoveryRequest): Promise<void> {
    const startMs = Date.now();
    const { userId, conversationId, replyToId, failedProvider } = request;
    let userText = request.userMessageText;
    if (!userText || userText.trim() === '') {
      const { data: lastUserMsgs } = await supabaseAdmin
        .from('chat_history')
        .select('content')
        .eq('conversation_id', conversationId)
        .eq('role', 'user')
        .order('created_at', { ascending: false })
        .limit(1);
      userText = lastUserMsgs?.[0]?.content || '';
    }

    if (!userText || userText.trim() === '') {
      logger.warn('[InstantRecovery] No user message found to recover, aborting');
      return;
    }

    logger.info('[InstantRecovery] Starting autonomous self-healing recovery', {
      userId,
      conversationId,
      failedProvider,
      messageSnippet: userText.slice(0, 60),
    });

    // Verify whether a real assistant message has already landed in this conversation
    const { data: latestMsgs } = await supabaseAdmin
      .from('chat_history')
      .select('id, role, content, meta, created_at')
      .eq('conversation_id', conversationId)
      .eq('role', 'assistant')
      .order('created_at', { ascending: false })
      .limit(1);

    if (latestMsgs && latestMsgs.length > 0) {
      const last = latestMsgs[0];
      // If the latest message is a voice reply or NOT the fallback phrase, skip recovery!
      if ((last as any).meta?.is_voice_reply) {
        logger.info('[InstantRecovery] Latest assistant message is a voice reply, skipping fallback recovery', {
          lastReplySnippet: last.content?.slice(0, 50),
        });
        return;
      }
      if (last.content && !last.content.includes('mujhe thoda sochne de') && !last.content.includes('moment to think')) {
        logger.info('[InstantRecovery] Real reply already present in chat, skipping recovery', {
          lastReplySnippet: last.content.slice(0, 50),
        });
        return;
      }
    }

    // Fetch last 6 messages from chat_history to provide full contextual continuity
    const { data: recentHistory } = await supabaseAdmin
      .from('chat_history')
      .select('role, content')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(6);

    const orderedHistory = (recentHistory || [])
      .reverse()
      .filter(m => !m.content?.includes('mujhe thoda sochne de') && !m.content?.includes('moment to think'));

    // Build focused prompt for the recovery LLM
    const systemPrompt = `You are Nova, an intimate, empathetic and warm virtual best friend chatting on WhatsApp in natural Hinglish.
You just had a momentary 2-second connection glitch, but now you are immediately and warmly replying to what the user just said with full awareness of the conversation history.
Rules:
- Directly, naturally, and warmly address the user's message in the context of what you were discussing.
- If the user sent a short reply like "haan", "theek", "acha", or "nahi", understand what was being asked or discussed and answer with substantive continuity!
- NEVER say generic filler like "kya hua?", "sab theek hai?", "kuch toh bola tha", "kuch soch raha hai?", or "mujhe thoda sochne de".
- Sound like a real best friend who cares and is actively listening.
- Keep it brief (1-3 short WhatsApp sentences).
- Casual Hinglish (tu/tera or tum/tumhara). No robotic speech.
- NEVER say "connection slow tha", "mera network issue tha", or repeat fallback phrases.
- Plain conversational text only. No markdown headers, no bullets.`;

    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: systemPrompt },
      ...orderedHistory.map(m => ({
        role: (m.role === 'assistant' ? 'assistant' : 'user') as 'assistant' | 'user',
        content: m.content || '',
      })),
    ];

    // Ensure the very last message is the current user text if not already present
    if (messages.length === 1 || messages[messages.length - 1].role !== 'user' || messages[messages.length - 1].content !== userText) {
      messages.push({ role: 'user', content: userText });
    }

    let recoveredText = '';
    let recoveryModelUsed = '';

    // Primary: cognitiveRouter with CONVERSATION workload (auto-swaps Gemini/NVIDIA pool)
    try {
      recoveryModelUsed = 'cognitiveRouter/CONVERSATION';
      recoveredText = await cognitiveRouter.complete('CONVERSATION', messages, {
        maxTokens: 300,
        temperature: 0.85,
        timeoutMs: 4500,
      });
    } catch (routeErr: any) {
      logger.warn('[InstantRecovery] Primary cognitiveRouter recovery failed, trying failover cascade', {
        error: routeErr.message,
      });
      try {
        recoveryModelUsed = 'nvidia/cerebellum';
        recoveredText = await nvidiaComplete('PROACTIVE', messages, {
          maxTokens: 300,
          temperature: 0.85,
          timeoutMs: 4500,
        });
      } catch (nvidiaErr: any) {
        try {
          recoveryModelUsed = 'gemini/failover';
          recoveredText = await geminiComplete(messages, {
            model: 'gemini-2.5-flash',
            maxTokens: 300,
            temperature: 0.85,
            timeoutMs: 4000,
          });
        } catch (geminiErr: any) {
          logger.error('[InstantRecovery] All recovery providers failed', {
            routeError: routeErr.message,
            nvidiaError: nvidiaErr.message,
            geminiError: geminiErr.message,
          });
        }
      }
    }

    if (!recoveredText || recoveredText.trim() === '' || isPromptLeak(recoveredText)) {
      logger.warn('[InstantRecovery] Recovery LLM returned unusable text, aborting save');
      return;
    }

    const cleanReply = sanitizeReply(recoveredText);
    if (!cleanReply || cleanReply === NOVA_EMPTY_REPLY || isPromptLeak(cleanReply)) {
      logger.warn('[InstantRecovery] Sanitized recovery text is empty or leak, aborting');
      return;
    }

    // Persist to chat_history
    await saveAssistantMessage(
      userId,
      conversationId,
      cleanReply,
      'InstantSelfHeal',
      replyToId,
      { sourceType: 'conversational' }
    );

    const elapsedMs = Date.now() - startMs;
    logger.info('[InstantRecovery] Upfront self-healing completed successfully', {
      userId,
      conversationId,
      modelUsed: recoveryModelUsed,
      elapsedMs,
      replyLength: cleanReply.length,
    });

    // Send push notification so the user gets alerted immediately
    try {
      const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('push_token')
        .eq('id', userId)
        .maybeSingle();

      if (profile?.push_token) {
        await sendNovaReplyNotification(profile.push_token, cleanReply);
      }
    } catch (pushErr) {
      logger.warn('[InstantRecovery] Push notification dispatch failed', { error: pushErr });
    }
  }
}

export const instantFallbackRecoveryService = new InstantFallbackRecoveryService();
