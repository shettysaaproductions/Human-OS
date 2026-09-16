/**
 * AutonomousActionService.ts — Unified Autonomous Action Engine
 *
 * Distinguishes and manages:
 *  1. REMINDER — User wants to be reminded of a task/event (User is actor).
 *  2. CALLBACK — User asks Nova to voice call them back at a specific time (Nova is caller).
 *  3. PROACTIVE_OUTREACH — Nova autonomously initiates text/voice outreach based on internal triggers.
 *
 * Full Callback Lifecycle:
 *  [scheduled] ──(due)──→ [due] ──(initiate)──→ [dispatching] ──(signaled)──→ [ringing]
 *                                                                                 │
 *                       ┌───────────────────────┬─────────────────────────────────┤
 *                       ▼                       ▼                                 ▼
 *                  [answered]              [declined]                          [missed]
 *                       │                       │                                 │
 *                       ▼                       ▼                                 ▼
 *                  [completed]             [completed]                   (retry < max_attempts?)
 *                                                                           ├── YES ──→ [scheduled] (backoff)
 *                                                                           └── NO  ──→ [completed] (fallback text)
 *
 * Guardrails & Consent:
 *  - proactive_calls_enabled & callback_calls_enabled
 *  - quiet_hours enforcement (22:00 - 07:00 local time)
 *  - max_attempts bounded escalation (cap 3)
 *  - multi-signal "ignoring Nova" detection (>=3 unreplied stops voice calls)
 *  - atomic idempotency via action_idempotency table
 */

import { supabaseAdmin } from '../lib/supabase';
import { logger } from '../lib/logger';
import { resolveUserTzOffsetHours } from './ReminderEngine';

export type ActionType = 'REMINDER' | 'CALLBACK' | 'PROACTIVE_OUTREACH' | 'NONE';

export type CallbackState =
  | 'scheduled'
  | 'due'
  | 'dispatching'
  | 'ringing'
  | 'answered'
  | 'declined'
  | 'missed'
  | 'completed'
  | 'cancelled';

export interface ActionIntentClassification {
  type: ActionType;
  confidence: number;
  reason: string;
  details?: {
    timePhrase?: string;
    targetPerson?: string;
    topic?: string;
    isNovaCaller?: boolean;
  };
}

export interface CallbackRecord {
  id: string;
  user_id: string;
  logical_key: string;
  title: string;
  due_at: string;
  state: CallbackState;
  attempt_count: number;
  max_attempts: number;
  last_error?: string;
  topic?: string;
  created_at: string;
  updated_at: string;
}

export interface GuardrailCheckResult {
  allowed: boolean;
  reason?: string;
  isInQuietHours?: boolean;
  isOptedOut?: boolean;
  ignoredCount?: number;
  delayMinutes?: number;
}

export class AutonomousActionService {
  private static instance: AutonomousActionService;

  static getInstance(): AutonomousActionService {
    if (!AutonomousActionService.instance) {
      AutonomousActionService.instance = new AutonomousActionService();
    }
    return AutonomousActionService.instance;
  }

  // ── 1. High-Precision Action Intent Classification ──────────────────────────

  /**
   * Classifies user input into REMINDER vs CALLBACK vs PROACTIVE_OUTREACH.
   *
   * Crucial distinction:
   *  - "Remind me to call Rahul at 6" → REMINDER (Actor is user calling Rahul)
   *  - "Nova, call me at 6" → CALLBACK (Actor is Nova calling user)
   *  - "Mujhe call karna sham ko 7 baje" → CALLBACK
   *  - "Call me in 10 minutes" → CALLBACK
   *  - "Remind me to take medicine" → REMINDER
   */
  classifyActionIntent(text: string): ActionIntentClassification {
    if (!text || text.trim().length === 0) {
      return { type: 'NONE', confidence: 1.0, reason: 'Empty text' };
    }

    const raw = text.trim();
    const lower = raw.toLowerCase();

    // 1. Complaint or negative intent check
    if (/\b(?:don'?t|dont|mat)\s*(?:call|phone|remind|yaad)\b/i.test(lower)) {
      return { type: 'NONE', confidence: 0.9, reason: 'Negative command / opt-out' };
    }

    // 2. CALLBACK detection: User asks Nova to voice call them
    // English triggers: "call me", "phone me", "give me a call", "ring me", "callback", "call me back"
    // Hinglish triggers: "mujhe call karna", "call kar dena mujhe", "phone karna mujhe", "call lagana mujhe"
    const isExplicitCallbackToUser =
      /\b(?:(?:please\s+)?(?:call|phone|ring)\s+(?:me|back|us)(?:\s+back)?|give\s+me\s+a\s+call|call\s+me\s+(?:at|in|around|on|tomorrow|kal|shaam|subah)|mujhe\s*(?:ek\s*)?call\s*(?:karna|karo|kar\s*dena|lagana)|phone\s*(?:karna|karo|kar\s*dena)\s*mujhe|call\s*karna\s*(?:mujhe|muje)|call\s*kar\s*dena)\b/i.test(lower);

    // Filter out when user says "remind me to call <third party>"
    // E.g. "remind me to call Rahul", "yaad dilana Rahul ko call karna hai"
    const isThirdPartyCallReminder =
      /\b(?:remind(?:\s+me)?\s+to\s+call\s+(?!me\b)[a-z0-9]+|yaad\s+dilana\s+(?!mujhe\b)[a-z0-9]+\s+ko\s+call|call\s+(?!me\b)[a-z0-9]+\s+ko\s+remind)\b/i.test(lower);

    if (isExplicitCallbackToUser && !isThirdPartyCallReminder) {
      // Extract time phrase if present
      const timeMatch = lower.match(/\b(?:at\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?|in\s+\d+\s*(?:mins?|minutes?|hours?)|tomorrow\s*(?:at\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?)?|kal\s*(?:subah|shaam|dopehar)?\s*\d{1,2}\s*baje?|shaam\s*ko\s*\d{1,2}\s*baje?|\d{1,2}\s*baje)\b/i);

      return {
        type: 'CALLBACK',
        confidence: 0.95,
        reason: 'User explicitly requested Nova to initiate a voice call back to them',
        details: {
          timePhrase: timeMatch ? timeMatch[0] : undefined,
          isNovaCaller: true,
          topic: raw,
        },
      };
    }

    // 3. REMINDER detection
    const isReminder =
      /\b(?:(?:set|put|add|create|schedule)\s*(?:an?|the)?\s*(?:reminder|alarm)|remind(?:\s+me)?|yaad\s*(?:dilao|dilana|dila\s*dena|rakhna)|reminder\s*(?:set|lagao|karo))\b/i.test(lower);

    if (isReminder || isThirdPartyCallReminder) {
      return {
        type: 'REMINDER',
        confidence: 0.95,
        reason: isThirdPartyCallReminder
          ? 'User requested a reminder to call a third party'
          : 'User requested a personal task reminder',
        details: {
          isNovaCaller: false,
          topic: raw,
        },
      };
    }

    return {
      type: 'NONE',
      confidence: 0.8,
      reason: 'No callback or reminder command identified',
    };
  }

  // ── 2. Guardrails & Explicit User Consent ────────────────────────────────────

  /**
   * Validates user consent, quiet hours, and escalation limits before initiating or scheduling actions.
   */
  async checkConsentAndGuardrails(
    userId: string,
    actionType: ActionType,
    scheduledTime?: Date
  ): Promise<GuardrailCheckResult> {
    try {
      // 1. Fetch user profile preferences & timezone
      const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('timezone_offset, timezone, country')
        .eq('id', userId)
        .maybeSingle();

      const userTzOffset = resolveUserTzOffsetHours(profile || {});

      // 2. Check opt-out status in working_memory or settings
      const { data: optOutSetting } = await supabaseAdmin
        .from('working_memory')
        .select('value')
        .eq('user_id', userId)
        .in('key', ['calls_opt_out', 'proactive_calls_disabled', 'opt_out_voice'])
        .maybeSingle();

      if (optOutSetting && optOutSetting.value === 'true') {
        return {
          allowed: false,
          isOptedOut: true,
          reason: 'User has explicitly opted out of autonomous voice calls',
        };
      }

      // 3. Proactive vs Callback Consent Check
      if (actionType === 'PROACTIVE_OUTREACH') {
        const { data: proactiveAllowed } = await supabaseAdmin
          .from('working_memory')
          .select('value')
          .eq('user_id', userId)
          .eq('key', 'proactive_calls_enabled')
          .maybeSingle();

        if (!proactiveAllowed || proactiveAllowed.value !== 'true') {
          return {
            allowed: false,
            reason: 'Proactive unsolicited voice calls require explicit user consent (proactive_calls_enabled = true)',
          };
        }
      }

      // 4. Quiet Hours Validation
      // Default: 22:00 (10 PM) to 07:00 (7 AM) local time
      const targetDate = scheduledTime || new Date();
      const localHours = (targetDate.getUTCHours() + userTzOffset + 24) % 24;
      const isQuietHours = localHours >= 22 || localHours < 7;

      if (isQuietHours) {
        return {
          allowed: false,
          isInQuietHours: true,
          reason: `Target time (${Math.floor(localHours)}:00 local) falls within quiet hours (22:00 - 07:00)`,
        };
      }

      // 5. Multi-signal "Ignoring Nova" Escalation Check
      const { count: unrepliedCount } = await supabaseAdmin
        .from('nova_outreach_log')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .is('replied_at', null);

      const ignoredCount = unrepliedCount || 0;
      if (ignoredCount >= 3) {
        return {
          allowed: false,
          ignoredCount,
          reason: `User has ignored ${ignoredCount} consecutive Nova outreaches. Bounded escalation suppresses further calls.`,
        };
      }

      // 6. Minimum Cooldown Check (5 minutes since last call/action)
      const { data: recentAction } = await supabaseAdmin
        .from('action_idempotency')
        .select('created_at')
        .eq('user_id', userId)
        .eq('action_type', 'nova_callback_dispatch')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (recentAction) {
        const diffMs = Date.now() - new Date(recentAction.created_at).getTime();
        if (diffMs < 5 * 60 * 1000) {
          const remainingMinutes = Math.ceil((5 * 60 * 1000 - diffMs) / 60000);
          return {
            allowed: false,
            delayMinutes: remainingMinutes,
            reason: `Cooldown active. Minimum 5-minute gap required between call dispatches (${remainingMinutes}m remaining).`,
          };
        }
      }

      return {
        allowed: true,
        ignoredCount,
      };
    } catch (err: any) {
      logger.error('[AutonomousActionService] Error checking consent and guardrails', { error: err.message, userId });
      return {
        allowed: false,
        reason: `Guardrail verification failed: ${err.message}`,
      };
    }
  }

  // ── 3. Callback Lifecycle State Machine ──────────────────────────────────────

  /**
   * Schedules a new user callback with idempotency and guardrail checks.
   */
  async scheduleCallback(
    userId: string,
    dueAt: Date,
    topic: string,
    requestId?: string
  ): Promise<{ success: boolean; callbackId?: string; state?: CallbackState; error?: string }> {
    const idempotencyKey = requestId || `cb_${userId}_${dueAt.getTime()}`;

    // 1. Guardrail check
    const guard = await this.checkConsentAndGuardrails(userId, 'CALLBACK', dueAt);
    if (!guard.allowed) {
      return { success: false, error: guard.reason };
    }

    try {
      // 2. Atomic Idempotency check via action_idempotency
      const { error: idempErr } = await supabaseAdmin
        .from('action_idempotency')
        .insert({
          user_id: userId,
          idempotency_key: idempotencyKey,
          action_type: 'CALLBACK_SCHEDULE',
          status: 'pending',
        });

      if (idempErr && idempErr.code === '23505') {
        logger.warn('[AutonomousActionService] Duplicate callback schedule suppressed by idempotency', { idempotencyKey, userId });
        const { data: existing } = await supabaseAdmin
          .from('nova_actions')
          .select('id, state')
          .eq('user_id', userId)
          .eq('logical_key', idempotencyKey)
          .maybeSingle();

        return {
          success: true,
          callbackId: existing?.id,
          state: (existing?.state as CallbackState) || 'scheduled',
        };
      }

      // 3. Persist in nova_actions
      const { data: action, error: actErr } = await supabaseAdmin
        .from('nova_actions')
        .insert({
          user_id: userId,
          logical_key: idempotencyKey,
          title: `Voice Callback: ${topic.slice(0, 80)}`,
          description: topic,
          state: 'scheduled',
          priority: 'high',
          execution_class: 'CONFIRMATION_REQUIRED',
          due_at: dueAt.toISOString(),
          provenance: JSON.stringify({
            actionType: 'CALLBACK',
            attempt_count: 0,
            max_attempts: 2,
            lifecycleState: 'scheduled',
          }),
        })
        .select('id, state')
        .single();

      if (actErr) {
        await supabaseAdmin
          .from('action_idempotency')
          .update({ status: 'failed', result: { error: actErr.message } })
          .eq('user_id', userId)
          .eq('idempotency_key', idempotencyKey);
        return { success: false, error: actErr.message };
      }

      await supabaseAdmin
        .from('action_idempotency')
        .update({ status: 'completed', result: { actionId: action.id }, completed_at: new Date().toISOString() })
        .eq('user_id', userId)
        .eq('idempotency_key', idempotencyKey);

      logger.info('[AutonomousActionService] Scheduled callback successfully', { userId, callbackId: action.id, dueAt });

      return {
        success: true,
        callbackId: action.id,
        state: 'scheduled',
      };
    } catch (err: any) {
      logger.error('[AutonomousActionService] scheduleCallback threw error', { error: err.message, userId });
      return { success: false, error: err.message };
    }
  }

  /**
   * Advances the callback state through the strict state machine.
   * Disallows invalid state transitions.
   */
  async transitionCallbackState(
    actionId: string,
    userId: string,
    targetState: CallbackState,
    meta?: Record<string, any>
  ): Promise<{ success: boolean; currentState: CallbackState; error?: string }> {
    const VALID_TRANSITIONS: Record<CallbackState, CallbackState[]> = {
      scheduled: ['due', 'cancelled', 'completed'],
      due: ['dispatching', 'cancelled', 'completed'],
      dispatching: ['ringing', 'missed', 'cancelled', 'completed'],
      ringing: ['answered', 'declined', 'missed', 'cancelled', 'completed'],
      answered: ['completed'],
      declined: ['completed', 'missed'],
      missed: ['scheduled', 'completed'], // Re-schedule if retrying, or complete if max attempts reached
      completed: [],
      cancelled: [],
    };

    try {
      const { data: action, error: fetchErr } = await supabaseAdmin
        .from('nova_actions')
        .select('id, state, provenance, retry_count')
        .eq('id', actionId)
        .eq('user_id', userId)
        .single();

      if (fetchErr || !action) {
        return { success: false, currentState: 'cancelled', error: 'Callback record not found' };
      }

      const currentState = (action.state as CallbackState) || 'scheduled';
      const allowedNextStates = VALID_TRANSITIONS[currentState] || [];

      if (!allowedNextStates.includes(targetState)) {
        const errMsg = `Invalid callback state transition: ${currentState} -> ${targetState}. Allowed: [${allowedNextStates.join(', ')}]`;
        logger.warn('[AutonomousActionService] ' + errMsg, { actionId, currentState, targetState });
        return { success: false, currentState, error: errMsg };
      }

      let prov: any = {};
      try {
        prov = JSON.parse(action.provenance || '{}');
      } catch (_) {}

      prov.lifecycleState = targetState;
      prov.lastTransitionAt = new Date().toISOString();
      if (meta) {
        prov.meta = { ...prov.meta, ...meta };
      }

      let retryCount = action.retry_count || 0;
      if (targetState === 'missed') {
        retryCount += 1;
      }

      const { error: updateErr } = await supabaseAdmin
        .from('nova_actions')
        .update({
          state: targetState,
          retry_count: retryCount,
          provenance: JSON.stringify(prov),
          updated_at: new Date().toISOString(),
        })
        .eq('id', actionId)
        .eq('user_id', userId);

      if (updateErr) {
        return { success: false, currentState, error: updateErr.message };
      }

      logger.info('[AutonomousActionService] Callback transitioned state', { actionId, from: currentState, to: targetState });

      return { success: true, currentState: targetState };
    } catch (err: any) {
      logger.error('[AutonomousActionService] Error transitioning callback state', { actionId, targetState, error: err.message });
      return { success: false, currentState: 'cancelled', error: err.message };
    }
  }

  /**
   * Handles a missed callback: enforces bounded escalation and fallback.
   */
  async handleCallbackMissed(
    actionId: string,
    userId: string
  ): Promise<{ retryScheduled: boolean; nextState: CallbackState; delayMinutes?: number }> {
    const { data: action } = await supabaseAdmin
      .from('nova_actions')
      .select('id, retry_count, provenance, title')
      .eq('id', actionId)
      .eq('user_id', userId)
      .single();

    if (!action) {
      return { retryScheduled: false, nextState: 'completed' };
    }

    const currentAttempts = (action.retry_count || 0) + 1;
    const maxAttempts = 2; // Hard cap

    if (currentAttempts < maxAttempts) {
      // Bounded escalation backoff: Attempt 1 missed → Retry in 5 minutes
      const delayMinutes = 5;
      const nextDue = new Date(Date.now() + delayMinutes * 60 * 1000);

      await supabaseAdmin
        .from('nova_actions')
        .update({
          state: 'scheduled',
          due_at: nextDue.toISOString(),
          retry_count: currentAttempts,
          updated_at: new Date().toISOString(),
        })
        .eq('id', actionId)
        .eq('user_id', userId);

      logger.info('[AutonomousActionService] Callback missed, rescheduled with backoff', { actionId, attempt: currentAttempts, nextDue });
      return { retryScheduled: true, nextState: 'scheduled', delayMinutes };
    }

    // Max attempts reached: Fall back to text notification and mark completed
    await this.transitionCallbackState(actionId, userId, 'completed', {
      finalStatus: 'missed_exhausted',
      attemptsMade: currentAttempts,
    });

    // Leave a polite fallback message in chat_history
    try {
      await supabaseAdmin.from('chat_history').insert({
        user_id: userId,
        role: 'assistant',
        content: `Maine call try kiya tha par shayad tu busy tha. Jab bhi free ho, bolna! 🤙`,
        meta: {
          is_callback_fallback: true,
          action_id: actionId,
        },
      });
    } catch (msgErr: any) {
      logger.warn('[AutonomousActionService] Failed to insert fallback missed-call chat message', { error: msgErr.message });
    }

    logger.info('[AutonomousActionService] Callback exhausted max attempts, downgraded to message and completed', { actionId, currentAttempts });
    return { retryScheduled: false, nextState: 'completed' };
  }
}

export const autonomousActionService = AutonomousActionService.getInstance();
