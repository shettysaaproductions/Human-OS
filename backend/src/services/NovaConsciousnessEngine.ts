/**
 * NovaConsciousnessEngine — The Brain (Two-Tier Architecture)
 *
 * Runs every 15 minutes. Decides if Nova should autonomously reach out.
 * Tier 1: Small LLM (cost-efficient) evaluates context to decide 'shouldReach'.
 * Tier 2: Full LLM generates the deep, emotional, context-aware message.
 */

import { supabaseAdmin } from '../lib/supabase';
import { novaBrain } from './NovaBrainService';
import { logger } from '../lib/logger';
import { sendPushNotification } from '../lib/pushNotifications';
import { temporalAwarenessService } from './TemporalAwarenessService';
import crypto from 'crypto';

const MIN_GAP_MINUTES = 45; // Reduced from 90 to allow more fluid back-to-back if needed

export class NovaConsciousnessEngine {

  async pulse(): Promise<void> {
    try {
      // Find active users (last 7 days)
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const { data: activeUsers } = await supabaseAdmin
        .from('chat_history')
        .select('user_id')
        .eq('role', 'user')
        .gte('created_at', sevenDaysAgo);

      if (!activeUsers) return;
      const uniqueUserIds = [...new Set(activeUsers.map(u => u.user_id))];

      logger.info(`[NACE] Pulse started for ${uniqueUserIds.length} users`);

      for (const userId of uniqueUserIds) {
        try {
          await this._processUser(userId);
        } catch (userErr) {
          logger.warn('[NACE] Error processing user', { userId, error: userErr instanceof Error ? userErr.message : String(userErr) });
        }
      }
      logger.info('[NACE] Pulse completed');
    } catch (err) {
      logger.error('[NACE] Pulse failed', { error: err instanceof Error ? err.message : String(err) });
    }
  }

  private async _processUser(userId: string): Promise<void> {
    // 1. Fetch Profile & Temporal Context
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('push_token, preferred_name, timezone_offset')
      .eq('id', userId)
      .maybeSingle();

    if (!profile?.push_token) return;

    const tContext = await temporalAwarenessService.getContext(userId, profile.timezone_offset);

    // 2. Fetch Recent Outreach to enforce MIN_GAP
    const { data: recentOutreach } = await supabaseAdmin
      .from('nova_outreach_log')
      .select('created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (recentOutreach) {
      const minutesSinceLast = (Date.now() - new Date(recentOutreach.created_at).getTime()) / 60000;
      if (minutesSinceLast < MIN_GAP_MINUTES) {
        return; // Too soon
      }
    }

    // 3. Last user message gap
    const { data: lastUserMsg } = await supabaseAdmin
      .from('chat_history')
      .select('created_at, content')
      .eq('user_id', userId)
      .eq('role', 'user')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const gapMinutes = lastUserMsg ? (Date.now() - new Date(lastUserMsg.created_at).getTime()) / 60000 : 0;
    // If user was active within 60 minutes — don't interrupt. Skip entirely (save LLM cost).
    if (gapMinutes < 60) return;

    // 4. Pending Agenda
    const { data: pendingAgenda } = await supabaseAdmin
      .from('nova_agenda')
      .select('*')
      .eq('user_id', userId)
      .in('status', ['pending', 'active'])
      .lte('next_retry_at', new Date().toISOString())
      .order('next_retry_at', { ascending: true })
      .limit(1);

    const agendaItem = (pendingAgenda && pendingAgenda.length > 0) ? pendingAgenda[0] : null;

    // --- TIER 1: The Subconscious Decision (Fast, Cheap) ---
    // In production, chatCompletion could be configured to use a smaller model via options
    // e.g. chatCompletion(..., { model: 'llama-3-8b-instruct' })
    const tier1Context = `Time: ${tContext.timeOfDayLabel} (${tContext.hour}:00), Day: ${tContext.dayOfWeek}
Is Sleep Window: ${tContext.isSleepWindow}
User Gap: ${Math.round(gapMinutes / 60)} hours
Pending Agenda: ${agendaItem ? agendaItem.event_description : 'None'}`;

    let shouldReach = false;
    let triggerType = 'engagement';

    try {
      const decision = await novaBrain.evaluateConsciousnessTier1(tier1Context);
      shouldReach = decision.shouldReach;
      triggerType = decision.triggerType || 'engagement';
    } catch (e) {
      logger.warn('[NACE] Tier 1 failed, defaulting to logic-based fallback');
      // Fallback logic
      if (agendaItem && !tContext.isSleepWindow) shouldReach = true;
      else if (gapMinutes > 240 && !tContext.isSleepWindow && Math.random() > 0.5) shouldReach = true;
    }

    if (!shouldReach) return;

    // --- TIER 2: Generation (Full Model) ---
    const { data: recentMemories } = await supabaseAdmin
      .from('memories')
      .select('key, value, memory_type')
      .eq('user_id', userId)
      .eq('is_archived', false)
      .order('updated_at', { ascending: false })
      .limit(5);

    const memorySummary = (recentMemories || []).map(m => `[${m.memory_type}] ${m.key}: ${m.value}`).join('\n');
    
    // Fetch last 6 chat messages for TIER2 context (so outreach is grounded in real conversation)
    const { data: lastConversation } = await supabaseAdmin
      .from('chat_history')
      .select('role, content')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(6);
    const lastConvSnippet = (lastConversation || []).reverse()
      .map((m: any) => `${m.role === 'user' ? 'User' : 'Nova'}: ${m.content.substring(0, 150)}`)
      .join('\n');

    const tier2Context = `Name: ${profile.preferred_name || 'yaar'}
Time/Day: ${tContext.dayOfWeek}, ${tContext.timeOfDayLabel} (${tContext.hour}:00)
Silence Duration: ${Math.round(gapMinutes / 60)} hours
Trigger: ${triggerType}
Agenda Context: ${agendaItem ? agendaItem.follow_up_question : 'N/A'}
Recent Memories: ${memorySummary}

LAST CONVERSATION (what was actually said — reference this naturally):
${lastConvSnippet || 'No recent conversation.'}`;

    try {
      const generated = await novaBrain.evaluateConsciousnessTier2(tier2Context);

      if (generated.message) {
        await this._sendOutreach(userId, profile, generated.message, triggerType, generated.tone);
        if (agendaItem) {
          const newRetryCount = (agendaItem.retry_count || 0) + 1;
          if (newRetryCount >= (agendaItem.max_retries || 3)) {
            await supabaseAdmin.from('nova_agenda').update({ status: 'expired', updated_at: new Date().toISOString() }).eq('id', agendaItem.id);
          } else {
            // Calculate next retry time based on urgency
            let delayHours = 24; // Default to next day
            if (agendaItem.urgency === 'high') delayHours = 4;
            else if (agendaItem.urgency === 'medium') delayHours = 12;
            
            // Backoff logic: double the delay on each retry
            delayHours = delayHours * Math.pow(2, newRetryCount - 1);
            
            const nextRetryAt = new Date(Date.now() + delayHours * 60 * 60 * 1000).toISOString();
            await supabaseAdmin.from('nova_agenda').update({ 
              status: 'active', 
              retry_count: newRetryCount,
              next_retry_at: nextRetryAt,
              updated_at: new Date().toISOString() 
            }).eq('id', agendaItem.id);
          }
        }
      }
    } catch (e) {
      logger.warn('[NACE] Tier 2 generation failed', { error: e instanceof Error ? e.message : String(e) });
    }
  }

  private async _sendOutreach(userId: string, profile: any, message: string, type: string, tone: string) {
    const { data: latestChat } = await supabaseAdmin
      .from('chat_history')
      .select('conversation_id')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const conversationId = latestChat?.conversation_id || crypto.randomUUID();

    await supabaseAdmin.from('chat_history').insert({
      user_id: userId,
      conversation_id: conversationId,
      role: 'assistant',
      content: message,
    });

    if (profile.push_token) {
      await sendPushNotification([{
        to: profile.push_token,
        title: 'Nova',
        body: message,
        sound: 'default',
        channelId: 'nova_messages',
        priority: 'high',
        data: { type: 'nova_consciousness', conversationId },
      }]);
    }

    await supabaseAdmin.from('nova_outreach_log').insert({
      user_id: userId,
      outreach_type: type,
      message,
      reason: tone,
    });
  }

  async expireOldAgendaItems(): Promise<void> {
    // Delete pending/active items older than 7 days since their follow up after
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    await supabaseAdmin
      .from('nova_agenda')
      .update({ status: 'expired', updated_at: new Date().toISOString() })
      .in('status', ['pending', 'active'])
      .lt('follow_up_after', cutoff);
  }
}

export const novaConsciousnessEngine = new NovaConsciousnessEngine();
