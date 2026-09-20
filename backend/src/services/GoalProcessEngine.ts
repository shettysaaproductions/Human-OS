/**
 * GoalProcessEngine.ts — Autonomous Goal & Reminder Lifecycle Process Engine
 *
 * Core Principle:
 * "A reminder is NOT a notification.
 *  A reminder is an autonomous commitment to help the user complete or acknowledge a task."
 *
 * Persistent Lifecycle State Machine:
 *  CREATED
 *    ↓
 *  SCHEDULED
 *    ↓
 *  DUE
 *    ↓
 *  CONTACTING
 *    ↓
 *  AWAITING_ACKNOWLEDGEMENT
 *    ↓
 *  FOLLOW_UP  ──(unacknowledged & high urgency)──→ ESCALATED (Initiates Call)
 *    ↓
 *  ACKNOWLEDGED / COMPLETED / CANCELLED / RESOLVED
 *
 * Features:
 *  1. Intelligent Communication Channel Selection (Explicit vs Autonomous Urgency: Call vs Message)
 *  2. Semantic Duplicate Detection & Natural In-Place Modification (Time, Recurrence, Channel)
 *  3. Postponement without duplication (User: "Not yet, remind me at 9" -> updates existing reminder)
 *  4. Bounded Anti-Spam Safety & Idempotency
 */

import { supabaseAdmin } from '../lib/supabase';
import { logger } from '../lib/logger';

export type GoalProcessLifecycleState =
  | 'CREATED'
  | 'SCHEDULED'
  | 'DUE'
  | 'CONTACTING'
  | 'AWAITING_ACKNOWLEDGEMENT'
  | 'FOLLOW_UP'
  | 'ESCALATED'
  | 'ACKNOWLEDGED'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'RESOLVED';

export type CommunicationChannel = 'message' | 'call' | 'auto';

export interface ProcessMetadata {
  lifecycleState: GoalProcessLifecycleState;
  communicationMode: CommunicationChannel;
  followUpCount: number;
  maxEscalations: number;
  lastContactAt?: string;
  acknowledgedAt?: string;
  escalatedAt?: string;
  originalGoalId?: string;
  urgencyReason?: string;
  history?: Array<{ state: GoalProcessLifecycleState; timestamp: string; note?: string }>;
}

export interface ExistingReminderCheckResult {
  isDuplicate: boolean;
  isModification: boolean;
  action?: 'time_updated' | 'recurrence_updated' | 'channel_updated' | 'reused' | 'none';
  reminder?: any;
  message?: string;
}

export class GoalProcessEngine {
  private static instance: GoalProcessEngine;

  static getInstance(): GoalProcessEngine {
    if (!GoalProcessEngine.instance) {
      GoalProcessEngine.instance = new GoalProcessEngine();
    }
    return GoalProcessEngine.instance;
  }

  // ── 1. Intelligent Communication Channel & Urgency Selection ────────────────

  /**
   * Intelligently selects whether to notify via text message or initiate a voice call.
   * Considers explicit user wording and contextual task urgency.
   */
  determineCommunicationChannel(
    taskText: string,
    explicitPreference?: CommunicationChannel
  ): { channel: CommunicationChannel; isUrgent: boolean; reason: string } {
    if (explicitPreference && explicitPreference !== 'auto') {
      return {
        channel: explicitPreference,
        isUrgent: explicitPreference === 'call',
        reason: `Explicit channel preference: ${explicitPreference}`
      };
    }

    const lower = (taskText || '').toLowerCase();

    // 1. Explicit user instruction for a call
    const explicitCall = /\b(?:(?:please\s+)?(?:call|phone|ring)\s+(?:me|us)(?:\s+back)?|call\s+me\s+(?:at|in|on|tomorrow|kal)|mujhe\s*(?:ek\s*)?call\s*(?:karna|karo|kar\s*dena|lagana)|phone\s*(?:karna|karo|kar\s*dena)\s*mujhe|(?:call|phone)\s*karke\s*(?:yaad|bolna|batana|bol|remind)?|calling\s*me|remind\s+(?:me\s+)?by\s+calling(?:\s+me)?|remind\s+(?:me\s+)?via\s+call|call\s+pe\s+remind|call\s+reminder)\b/i.test(lower);
    if (explicitCall) {
      return {
        channel: 'call',
        isUrgent: true,
        reason: 'User explicitly requested a voice call'
      };
    }

    // 2. Explicit user instruction for text message only
    const explicitMessage = /\b(?:just\s+(?:message|text|whatsapp|dm)\s+me|only\s+(?:message|text)|sirf\s+(?:message|text)\s*karna|message\s*hi\s*karna|don'?t\s+call|call\s*mat\s*karna)\b/i.test(lower);
    if (explicitMessage) {
      return {
        channel: 'message',
        isUrgent: false,
        reason: 'User explicitly requested text message only'
      };
    }

    // 3. Autonomous High-Urgency Tasks: Waking up, airport flights, emergency appointments
    const wakeUpPattern = /\b(?:wake\s+(?:me|us)?\s+up|uthna|uth\s*ke|utha\s*(?:dena|diyo|denaa)|jaga\s*(?:dena|diyo|denaa)|subah\s*\d{1,2}\s*baje\s*alarm|alarm)\b/i.test(lower);
    if (wakeUpPattern) {
      return {
        channel: 'call',
        isUrgent: true,
        reason: 'Wake-up alarm requires high-attention voice outreach rather than passive text'
      };
    }

    const highUrgencyPattern = /\b(?:flight|airport|boarding|interview|urgent\s*meeting|important\s*meeting|emergency(?:\s*meeting)?|doctor\s*appointment|surgery|critical\s*medicine|insulin|deadline\s*in\s*10\s*min)\b/i.test(lower);
    if (highUrgencyPattern) {
      return {
        channel: 'call',
        isUrgent: true,
        reason: 'High-stakes, time-critical event warrants active call reminder'
      };
    }

    // 4. Default: Casual informational reminder via message
    return {
      channel: 'message',
      isUrgent: false,
      reason: 'Standard informational task suitable for conversational message'
    };
  }

  // ── 2. Semantic Duplicate Detection & Natural In-Place Modification ─────────

  /**
   * Checks if an incoming reminder intention is:
   *  1. An exact duplicate
   *  2. A natural modification of an existing reminder (e.g. "Actually make that 9")
   *  3. A natural recurrence modification (e.g. "Make it every day except Sunday")
   *  4. A channel modification (e.g. "Actually don't call, just message me")
   */
  async evaluateExistingReminder(
    userId: string,
    newTaskText: string,
    targetTriggerAt: Date | null,
    recurrenceSpec?: { type?: string; interval?: number; activeDays?: string[] },
    channelPref?: CommunicationChannel
  ): Promise<ExistingReminderCheckResult> {
    try {
      const { data: activeReminders, error } = await supabaseAdmin
        .from('reminders')
        .select('*')
        .eq('user_id', userId)
        .in('status', ['active', 'scheduled']);

      if (error || !activeReminders || activeReminders.length === 0) {
        return { isDuplicate: false, isModification: false };
      }

      const lowerText = newTaskText.toLowerCase().trim();

      // Check for modification signals
      const isTimeChangeSignal = /\b(?:actually|make\s+that|instead|badal\s*ke|change\s*(?:it|time)?\s*to|shift\s*to)\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm|baje)?)\b/i.test(lowerText) ||
                                 /\b(\d{1,2}(?::\d{2})?\s*(?:am|pm|baje))\s*(?:pe\s*kardo|kar\s*do|bana\s*do)\b/i.test(lowerText);
      const isRecurrenceChangeSignal = /\b(?:make\s+it\s+every\s*day|roz\s*kardo|har\s*din|except|apart\s*from|only\s+(?:on\s+)?(?:mon|tue|wed|thu|fri|sat|sun))\b/i.test(lowerText);
      const isChannelChangeSignal = /\b(?:actually\s+(?:don'?t\s+call|call\s+me|just\s+message)|call\s*mat\s*karna|call\s*karna)\b/i.test(lowerText);

      // Clean tokens of target text
      const targetTokens = this.extractCoreTokens(newTaskText);

      // Rank existing reminders by token similarity
      let bestMatch: any = null;
      let highestScore = 0;

      for (const rem of activeReminders) {
        const existingTokens = this.extractCoreTokens(rem.text);
        const score = this.computeOverlap(targetTokens, existingTokens);
        if (score > highestScore) {
          highestScore = score;
          bestMatch = rem;
        }
      }

      // If user is saying "Actually make that 9" or a short modification phrase without restating the task,
      // pick the most recently updated or nearest upcoming reminder!
      if (!bestMatch && (isTimeChangeSignal || isRecurrenceChangeSignal || isChannelChangeSignal)) {
        bestMatch = activeReminders.sort((a, b) => new Date(b.updated_at || b.created_at).getTime() - new Date(a.updated_at || a.created_at).getTime())[0];
        highestScore = 0.8;
      }

      if (bestMatch && (highestScore >= 0.45 || isTimeChangeSignal || isRecurrenceChangeSignal || isChannelChangeSignal)) {
        const metadata = this.parseProcessMetadata(bestMatch.notes);
        const timeDiffMs = targetTriggerAt && bestMatch.trigger_at ? Math.abs(new Date(bestMatch.trigger_at).getTime() - targetTriggerAt.getTime()) : 0;
        const isCloseTime = targetTriggerAt && bestMatch.trigger_at && timeDiffMs <= 20 * 60 * 1000;

        // Scenario 0: Equivalent Duplicate Protection (Repeated request within equivalent time window without explicit change signal)
        if (isCloseTime && !isTimeChangeSignal && !isRecurrenceChangeSignal && (!channelPref || channelPref === metadata.communicationMode)) {
          return {
            isDuplicate: true,
            isModification: false,
            action: 'reused',
            reminder: bestMatch,
            message: `You already have this reminder scheduled for "${bestMatch.text}".`
          };
        }

        // Scenario A: Natural Time Modification ("Actually make that 9" or rescheduling)
        if (targetTriggerAt && (isTimeChangeSignal || timeDiffMs > 20 * 60 * 1000)) {
          logger.info('[GoalProcessEngine] In-place time modification of existing reminder', {
            reminderId: bestMatch.id,
            oldTime: bestMatch.trigger_at,
            newTime: targetTriggerAt.toISOString()
          });

          metadata.lifecycleState = 'SCHEDULED';
          metadata.history = metadata.history || [];
          metadata.history.push({
            state: 'SCHEDULED',
            timestamp: new Date().toISOString(),
            note: `Rescheduled from ${bestMatch.trigger_at} to ${targetTriggerAt.toISOString()}`
          });

          const { data: updated } = await supabaseAdmin
            .from('reminders')
            .update({
              trigger_at: targetTriggerAt.toISOString(),
              notes: JSON.stringify(metadata),
              updated_at: new Date().toISOString()
            })
            .eq('id', bestMatch.id)
            .select('*')
            .single();

          return {
            isDuplicate: false,
            isModification: true,
            action: 'time_updated',
            reminder: updated || bestMatch,
            message: `Updated reminder "${bestMatch.text}" to ${targetTriggerAt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}.`
          };
        }

        // Scenario B: Recurrence Modification ("Make it every day except Sunday")
        if (recurrenceSpec && recurrenceSpec.type) {
          logger.info('[GoalProcessEngine] In-place recurrence modification of existing reminder', {
            reminderId: bestMatch.id,
            recurrenceSpec
          });

          metadata.history = metadata.history || [];
          metadata.history.push({
            state: metadata.lifecycleState,
            timestamp: new Date().toISOString(),
            note: `Recurrence updated: ${recurrenceSpec.type} (${(recurrenceSpec.activeDays || []).join(', ')})`
          });

          const { data: updated } = await supabaseAdmin
            .from('reminders')
            .update({
              recurrence_type: recurrenceSpec.type,
              recurrence_interval: recurrenceSpec.interval || 1,
              active_days: recurrenceSpec.activeDays || null,
              notes: JSON.stringify(metadata),
              updated_at: new Date().toISOString()
            })
            .eq('id', bestMatch.id)
            .select('*')
            .single();

          return {
            isDuplicate: false,
            isModification: true,
            action: 'recurrence_updated',
            reminder: updated || bestMatch,
            message: `Updated recurrence for "${bestMatch.text}".`
          };
        }

        // Scenario C: Channel Modification ("Actually don't call, just message me")
        if (channelPref && channelPref !== metadata.communicationMode) {
          metadata.communicationMode = channelPref;
          metadata.history = metadata.history || [];
          metadata.history.push({
            state: metadata.lifecycleState,
            timestamp: new Date().toISOString(),
            note: `Communication channel switched to ${channelPref}`
          });

          const { data: updated } = await supabaseAdmin
            .from('reminders')
            .update({
              notes: JSON.stringify(metadata),
              updated_at: new Date().toISOString()
            })
            .eq('id', bestMatch.id)
            .select('*')
            .single();

          return {
            isDuplicate: false,
            isModification: true,
            action: 'channel_updated',
            reminder: updated || bestMatch,
            message: `Notification preference updated to ${channelPref} for "${bestMatch.text}".`
          };
        }

        // Scenario D: Exact Duplicate Protection (User repeated same request)
        return {
          isDuplicate: true,
          isModification: false,
          action: 'reused',
          reminder: bestMatch,
          message: `You already have this reminder scheduled for "${bestMatch.text}".`
        };
      }
    } catch (err: any) {
      logger.warn('[GoalProcessEngine] evaluateExistingReminder error (non-fatal)', { error: err?.message });
    }

    return { isDuplicate: false, isModification: false };
  }

  // ── 3. Persistent Lifecycle Transitions ──────────────────────────────────────

  /**
   * Advances the persistent lifecycle state of a reminder process.
   */
  async advanceLifecycle(
    reminderId: string,
    event: 'DISPATCHED_MESSAGE' | 'DISPATCHED_CALL' | 'USER_ACKNOWLEDGED' | 'USER_POSTPONED' | 'USER_CANCELLED' | 'FOLLOW_UP_TRIGGERED' | 'ESCALATED',
    payload?: { postponedTo?: Date; note?: string }
  ): Promise<{ success: boolean; newState: GoalProcessLifecycleState; reminder?: any }> {
    try {
      const { data: reminder, error } = await supabaseAdmin
        .from('reminders')
        .select('*')
        .eq('id', reminderId)
        .maybeSingle();

      if (error || !reminder) {
        return { success: false, newState: 'COMPLETED' };
      }

      const metadata = this.parseProcessMetadata(reminder.notes);
      let nextState: GoalProcessLifecycleState = metadata.lifecycleState;
      let newDbStatus = reminder.status;
      let newTriggerAt = reminder.trigger_at;

      const nowIso = new Date().toISOString();

      switch (event) {
        case 'DISPATCHED_MESSAGE':
          nextState = 'AWAITING_ACKNOWLEDGEMENT';
          metadata.lastContactAt = nowIso;
          break;

        case 'DISPATCHED_CALL':
          nextState = 'AWAITING_ACKNOWLEDGEMENT';
          metadata.lastContactAt = nowIso;
          break;

        case 'FOLLOW_UP_TRIGGERED':
          metadata.followUpCount = (metadata.followUpCount || 0) + 1;
          nextState = 'FOLLOW_UP';
          metadata.lastContactAt = nowIso;
          break;

        case 'ESCALATED':
          metadata.followUpCount = (metadata.followUpCount || 0) + 1;
          nextState = 'ESCALATED';
          metadata.escalatedAt = nowIso;
          metadata.communicationMode = 'call'; // Auto-escalate to call!
          break;

        case 'USER_ACKNOWLEDGED':
          nextState = 'COMPLETED';
          newDbStatus = 'completed';
          metadata.acknowledgedAt = nowIso;
          break;

        case 'USER_POSTPONED':
          nextState = 'SCHEDULED';
          newDbStatus = 'active';
          if (payload?.postponedTo) {
            newTriggerAt = payload.postponedTo.toISOString();
          }
          break;

        case 'USER_CANCELLED':
          nextState = 'CANCELLED';
          newDbStatus = 'cancelled';
          break;
      }

      metadata.lifecycleState = nextState;
      metadata.history = metadata.history || [];
      metadata.history.push({
        state: nextState,
        timestamp: nowIso,
        note: payload?.note || `Event: ${event}`
      });

      const { data: updated, error: updateErr } = await supabaseAdmin
        .from('reminders')
        .update({
          status: newDbStatus,
          trigger_at: newTriggerAt,
          notes: JSON.stringify(metadata),
          updated_at: nowIso
        })
        .eq('id', reminderId)
        .select('*')
        .single();

      if (updateErr) throw updateErr;

      logger.info('[GoalProcessEngine] Lifecycle state advanced', {
        reminderId,
        event,
        fromState: reminder.notes ? 'persisted' : 'initial',
        toState: nextState,
        status: newDbStatus
      });

      return { success: true, newState: nextState, reminder: updated };
    } catch (err: any) {
      logger.error('[GoalProcessEngine] Failed to advance lifecycle', { reminderId, event, error: err?.message });
      return { success: false, newState: 'AWAITING_ACKNOWLEDGEMENT' };
    }
  }

  // ── Helper Utilities ────────────────────────────────────────────────────────

  parseProcessMetadata(notesStr?: string | null): ProcessMetadata {
    if (notesStr) {
      try {
        const parsed = JSON.parse(notesStr);
        if (parsed && parsed.lifecycleState) {
          return parsed as ProcessMetadata;
        }
      } catch (_) {
        // Fallback to initial
      }
    }

    return {
      lifecycleState: 'SCHEDULED',
      communicationMode: 'auto',
      followUpCount: 0,
      maxEscalations: 3,
      history: []
    };
  }

  private extractCoreTokens(text?: string): string[] {
    return (text || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length >= 3 && !['remind', 'yaad', 'karna', 'karo', 'kar', 'mujhe', 'muje', 'call', 'message', 'please', 'tomorrow', 'kal'].includes(t));
  }

  private computeOverlap(a: string[], b: string[]): number {
    if (a.length === 0 || b.length === 0) return 0;
    const common = a.filter(t => b.includes(t));
    return (2 * common.length) / (a.length + b.length);
  }
}

export const goalProcessEngine = GoalProcessEngine.getInstance();
