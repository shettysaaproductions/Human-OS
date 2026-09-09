/**
 * WatchtowerReflectionService.ts — Watchtower Post-Reply Reflection & Auto-Correction Engine
 *
 * ARCHITECTURAL ROLE:
 * 1. Post-Reply Reflection: Reads Nova's latest generated reply, analyzes it against user memory,
 *    current situation, age/common-sense plausibility, and conversational flow.
 * 2. Self-Correction & Dot-Connecting: Catches entity confusion (e.g. attributing adult hobbies/kits
 *    to an infant vs wife), typos, and robotic leaks, producing an improved, natural WhatsApp-style response.
 * 3. Message Versioning: Preserves historical drafts in chat_history.meta.versions so users can
 *    tap the bubble and inspect what was originally drafted vs refined, or branch alternative responses.
 * 4. User Message Lock: Strictly operates ONLY on Nova's latest reply. If the user sends a new message,
 *    any pending or in-flight reflection immediately aborts.
 * 5. Human Situational Awareness: Monitors seen-no-reply (1 min), typing indicator (2 min delay),
 *    and situational commute/interruption states (5 min).
 */

import { supabaseAdmin } from '../lib/supabase';
import { logger } from '../lib/logger';
import { complete } from '../lib/nvidia';
import { reminderIntentDetector } from './ReminderIntentDetector';

export interface MessageVersionEntry {
  version: number;
  content: string;
  timestamp: string;
  flaw?: string;
  flaw_type?: string;
  reason?: string;
}

export interface ReflectionScheduleParams {
  userId: string;
  conversationId: string;
  messageId: string;
  content: string;
  userMessage: string;
  recentContext?: string;
  memories?: any[];
}

interface ActiveReflectionTask {
  userId: string;
  conversationId: string;
  messageId: string;
  scheduledAt: number;
  abortController: AbortController;
  timer: NodeJS.Timeout;
}

export class WatchtowerReflectionService {
  private static instance: WatchtowerReflectionService;
  private activeReflections: Map<string, ActiveReflectionTask> = new Map();

  static getInstance(): WatchtowerReflectionService {
    if (!WatchtowerReflectionService.instance) {
      WatchtowerReflectionService.instance = new WatchtowerReflectionService();
    }
    return WatchtowerReflectionService.instance;
  }

  /**
   * Schedule a reflection on Nova's latest sent reply.
   * Cancels any prior pending reflection for this user.
   */
  scheduleReflection(params: ReflectionScheduleParams): void {
    const { userId, conversationId, messageId } = params;
    if (!userId || !messageId) return;

    // Cancel any existing task for this user
    this.cancelPendingReflection(userId, conversationId);

    const abortController = new AbortController();
    const scheduledAt = Date.now();

    // Brief delay (750ms) to allow DB persistence and UI delivery before critique
    const timer = setTimeout(async () => {
      try {
        await this.runReflection(params, abortController.signal, scheduledAt);
      } catch (err) {
        if (!abortController.signal.aborted) {
          logger.error('[WATCHTOWER REFLECTION] Error running reflection', {
            userId,
            messageId,
            error: err instanceof Error ? err.message : String(err)
          });
        }
      } finally {
        const current = this.activeReflections.get(userId);
        if (current && current.messageId === messageId) {
          this.activeReflections.delete(userId);
        }
      }
    }, 750);

    this.activeReflections.set(userId, {
      userId,
      conversationId,
      messageId,
      scheduledAt,
      abortController,
      timer
    });

    logger.info('[WATCHTOWER REFLECTION] Scheduled reflection for message', {
      userId,
      messageId,
      conversationId
    });
  }

  /**
   * Cancel any pending reflection for the user immediately.
   * Mandatory invariant: called the moment the user sends a new message.
   */
  cancelPendingReflection(userId: string, _conversationId?: string): void {
    const existing = this.activeReflections.get(userId);
    if (existing) {
      logger.info('[WATCHTOWER REFLECTION] Cancelling active reflection due to user activity', {
        userId,
        messageId: existing.messageId
      });
      existing.abortController.abort();
      clearTimeout(existing.timer);
      this.activeReflections.delete(userId);
    }
  }

  /**
   * Core critique & self-correction execution
   */
  private async runReflection(
    params: ReflectionScheduleParams,
    signal: AbortSignal,
    scheduledAt: number
  ): Promise<void> {
    const { userId, conversationId, messageId, content, userMessage } = params;

    if (signal.aborted) return;

    // 1. Fetch user memories (family, wife, children, ages, schedule)
    let memorySummary = '';
    try {
      const [canonicalRes, workingRes] = await Promise.all([
        supabaseAdmin
          .from('memories')
          .select('key, value, memory_type')
          .eq('user_id', userId)
          .is('archived_at', null)
          .limit(40),
        supabaseAdmin
          .from('working_memory')
          .select('key, value')
          .eq('user_id', userId)
          .limit(20)
      ]);

      const canonicalList = (canonicalRes.data || [])
        .map((m: any) => `- ${m.key}: ${m.value} (${m.memory_type || 'general'})`);
      const workingList = (workingRes.data || [])
        .map((w: any) => `- [working] ${w.key}: ${w.value}`);

      memorySummary = [...canonicalList, ...workingList].join('\n');
    } catch {
      memorySummary = 'No memory retrieved.';
    }

    if (signal.aborted) return;

    // 2. Fetch last 4 chat messages for immediate conversational grounding
    let recentChat = params.recentContext || '';
    if (!recentChat) {
      const { data: recentRows } = await supabaseAdmin
        .from('chat_history')
        .select('role, content')
        .eq('user_id', userId)
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: false })
        .limit(6);

      if (recentRows && recentRows.length > 0) {
        recentChat = recentRows
          .reverse()
          .map((r: any) => `${r.role === 'user' ? 'User' : 'Nova'}: ${r.content}`)
          .join('\n');
      }
    }

    if (signal.aborted) return;

    // 3. Critique Prompt
    const systemPrompt = `You are the Watchtower Post-Reply Reflection Engine for Nova.
Nova is an AI best friend who texts on WhatsApp.
Your job is to critically review Nova's latest sent reply for major blunders, logical fallacies, entity confusion, typos, or missed dots.

CRITICAL CHECKS:
1. ENTITY ATTRIBUTION & AGE PLAUSIBILITY (FATAL FLAW):
   - Did Nova attribute an adult activity, tool, course, or hobby to an infant/child?
     (e.g., attributing nail art kit, cooking, or self-learning to a 6-month-old infant Shreshth instead of wife Sakshi).
   - Did Nova resolve pronouns ("usse", "usne", "woh") to the wrong person in context?
2. TYPOS & GRAMMAR SLIPS:
   - Obvious typos (e.g. "rata" instead of "raat", weird translations, broken Hinglish).
3. LEAKED TAGS OR SYSTEM ARTIFACTS:
   - Leaked [Replying to: "..."], tool tags, XML, or bullet points in casual WhatsApp chat.
4. MONOLITHIC WALL OF TEXT:
   - If Nova dumped a 7-line single monolithic paragraph when a WhatsApp chat needs short, conversational bubbles (1-2 sentences).
5. MISSED DOT CONNECTIONS:
   - Failing to connect an obvious fact (e.g., user is currently on the metro, or specifically answering about a spouse).
6. MISSED REMINDER OR TEMPORAL CONFUSION (CRITICAL):
   - Did the user ask to set a reminder or alarm (e.g., "yaad dilao", "remind me", "kal 1 bje", "subah remind karo")?
   - Did Nova misunderstand this as a past event (e.g., saying "tumne kal reminder diya tha", "main tumhare reminder ko yaad kar raha hoon" instead of confirming it is scheduled for the future)?
   - Did Nova fail to confirm the future reminder?
   - If so, mark flaw_type: "missed_reminder" and provide corrected_content warmly confirming the reminder for the requested date and time in natural WhatsApp Hinglish (1-2 sentences).

OUTPUT FORMAT:
Respond with ONLY valid JSON:
{
  "has_flaw": boolean,
  "flaw_type": "entity_confusion" | "age_implausibility" | "typo" | "robotic_leak" | "monolithic_wall" | "missed_dots" | "missed_reminder" | "none",
  "explanation": "Clear 1-sentence reason why Nova's reply was flawed or why it is good",
  "corrected_content": "The corrected, warm, natural Hinglish reply formatted like WhatsApp text (1-2 sentences) if has_flaw is true, else null"
}`;

    const userPrompt = `User's Latest Message:
"${userMessage}"

Recent Conversation Context:
${recentChat}

User's Known Memories & Facts:
${memorySummary}

Nova's Sent Reply:
"${content}"

Critique this reply. If there is entity confusion, missed reminders, past-tense hallucination on a future reminder, or typos/leaks, provide the corrected natural Hinglish version.`;

    // Second-layer Reminder Safety Net
    let scheduledByWatchtower: any = null;
    if (reminderIntentDetector.hasReminderIntent(userMessage)) {
      try {
        const checkResult = await reminderIntentDetector.detectAndSchedule(userId, userMessage);
        if (checkResult.scheduled) {
          scheduledByWatchtower = checkResult;
          logger.info('[WATCHTOWER REFLECTION] Second-layer safety net scheduled reminder in DB', {
            userId,
            task: checkResult.task,
            time: checkResult.formattedTime
          });
        }
      } catch (err: any) {
        logger.warn('[WATCHTOWER REFLECTION] Reminder safety net check failed', { error: err?.message });
      }
    }

    try {
      const responseText = await complete(
        'LEARNING',
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        { temperature: 0.1, maxTokens: 600 }
      );

      if (signal.aborted) return;

      // Extract JSON from response
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        logger.warn('[WATCHTOWER REFLECTION] Could not parse JSON from reflection critique', { responseText });
        return;
      }

      const critique = JSON.parse(jsonMatch[0]);

      // Override if Nova hallucinated past tense on a reminder request
      const lowerContent = (content || '').toLowerCase();
      const hasPastTemporalHallucination = /\b(?:reminder\s*diya\s*tha|diya\s*tha|yaad\s*kar\s*raha\s*hoon)\b/i.test(lowerContent);
      if (scheduledByWatchtower && hasPastTemporalHallucination && (!critique.has_flaw || critique.flaw_type !== 'missed_reminder')) {
        critique.has_flaw = true;
        critique.flaw_type = 'missed_reminder';
        critique.explanation = 'Nova hallucinated that the user gave a reminder in the past instead of confirming the future reminder.';
        critique.corrected_content = `Haan bilkul! 😊 Maine ${scheduledByWatchtower.formattedTime || 'kal'} ka reminder set kar diya hai — ${scheduledByWatchtower.task || 'tumhare kaam'} ke liye. Main tumhe barabar yaad dila dungi!`;
      }

      if (!critique.has_flaw || !critique.corrected_content) {
        logger.info('[WATCHTOWER REFLECTION] Reply verified clean — no flaws detected', {
          userId,
          messageId,
          explanation: critique.explanation
        });
        return;
      }

      // 4. TOCTOU CHECK: Has the user dropped a newer message while reflection was running?
      const { data: newerUserMsg } = await supabaseAdmin
        .from('chat_history')
        .select('id')
        .eq('user_id', userId)
        .eq('conversation_id', conversationId)
        .eq('role', 'user')
        .gt('created_at', new Date(scheduledAt).toISOString())
        .limit(1)
        .maybeSingle();

      if (newerUserMsg || signal.aborted) {
        logger.info('[WATCHTOWER REFLECTION] User sent a new message during reflection — ABORTING correction', {
          userId,
          messageId,
          newerUserMessageId: newerUserMsg?.id
        });
        return;
      }

      // 5. Fetch current message record from chat_history
      const { data: messageRow, error: fetchErr } = await supabaseAdmin
        .from('chat_history')
        .select('id, content, created_at, meta')
        .eq('id', messageId)
        .maybeSingle();

      if (fetchErr || !messageRow) {
        logger.warn('[WATCHTOWER REFLECTION] Target message not found in chat_history', { messageId, error: fetchErr });
        return;
      }

      // Prepare versions array
      const existingMeta = (messageRow.meta as any) || {};
      const versions: MessageVersionEntry[] = existingMeta.versions || [
        {
          version: 1,
          content: messageRow.content,
          timestamp: messageRow.created_at,
          flaw: critique.explanation,
          flaw_type: critique.flaw_type,
          reason: 'Initial generation'
        }
      ];

      const newVersion: MessageVersionEntry = {
        version: versions.length + 1,
        content: critique.corrected_content.trim(),
        timestamp: new Date().toISOString(),
        flaw: undefined,
        flaw_type: undefined,
        reason: `Watchtower auto-refinement: ${critique.flaw_type} (${critique.explanation})`
      };
      versions.push(newVersion);

      const updatedMeta = {
        ...existingMeta,
        is_corrected: true,
        active_version_index: versions.length - 1,
        versions,
        last_reflection_at: new Date().toISOString(),
        reflection_flaw_detected: critique.flaw_type,
        reflection_explanation: critique.explanation
      };

      // 6. Update chat_history with the refined content and version metadata
      const { error: updateErr } = await supabaseAdmin
        .from('chat_history')
        .update({
          content: critique.corrected_content.trim(),
          meta: updatedMeta
        })
        .eq('id', messageId);

      if (updateErr) {
        logger.error('[WATCHTOWER REFLECTION] Failed to update chat_history with corrected version', {
          messageId,
          error: updateErr.message
        });
        return;
      }

      logger.info('[WATCHTOWER REFLECTION] Successfully auto-corrected Nova reply!', {
        userId,
        messageId,
        flawType: critique.flaw_type,
        originalSnippet: messageRow.content.substring(0, 60),
        correctedSnippet: critique.corrected_content.substring(0, 60)
      });

      // 7. Log correction to audit log for founder review
      try {
        await supabaseAdmin.from('nova_corrections_log').insert({
          user_id: userId,
          original_nova_message: messageRow.content.substring(0, 2000),
          user_correction: `[Watchtower Auto-Reflection] ${critique.flaw_type}: ${critique.explanation}`,
          detected_flaw_type: critique.flaw_type,
          generated_patch: critique.corrected_content.substring(0, 2000),
          patch_applied: true
        });
      } catch (logErr) {
        logger.warn('[WATCHTOWER REFLECTION] Failed to log to nova_corrections_log', { error: logErr });
      }

    } catch (err) {
      if (!signal.aborted) {
        logger.error('[WATCHTOWER REFLECTION] Reflection critique call failed', {
          userId,
          messageId,
          error: err instanceof Error ? err.message : String(err)
        });
      }
    }
  }

  /**
   * Switch the active version of an assistant message (e.g. user toggles back to original v1).
   */
  async switchMessageVersion(userId: string, messageId: string, versionIndex: number): Promise<{ success: boolean; activeContent?: string; error?: string }> {
    try {
      const { data: row, error: fetchErr } = await supabaseAdmin
        .from('chat_history')
        .select('id, meta')
        .eq('id', messageId)
        .eq('user_id', userId)
        .maybeSingle();

      if (fetchErr || !row) {
        return { success: false, error: 'Message not found' };
      }

      const meta = (row.meta as any) || {};
      const versions: MessageVersionEntry[] = meta.versions || [];

      if (!versions[versionIndex]) {
        return { success: false, error: 'Version index out of bounds' };
      }

      const targetVersion = versions[versionIndex];
      const updatedMeta = {
        ...meta,
        active_version_index: versionIndex
      };

      const { error: updateErr } = await supabaseAdmin
        .from('chat_history')
        .update({
          content: targetVersion.content,
          meta: updatedMeta
        })
        .eq('id', messageId);

      if (updateErr) {
        return { success: false, error: updateErr.message };
      }

      return { success: true, activeContent: targetVersion.content };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /**
   * Situational follow-up checker:
   * - 1 min: Seen but no reply, conversation was active -> organic follow-up
   * - 2 min: If user is typing -> hold off
   * - 5 min: Middle-of-conversation commute / transit check
   */
  async checkSituationalFollowUp(userId: string, conversationId: string): Promise<{ shouldFollowUp: boolean; reason?: string; suggestedTopic?: string }> {
    try {
      const { data: lastMsg } = await supabaseAdmin
        .from('chat_history')
        .select('id, role, content, created_at, is_read, read_at')
        .eq('user_id', userId)
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!lastMsg || lastMsg.role !== 'assistant') {
        return { shouldFollowUp: false };
      }

      const now = Date.now();
      const createdAtMs = new Date(lastMsg.created_at).getTime();
      const elapsedMinutes = (now - createdAtMs) / 60000;

      // 1. Seen but not replied within 1 minute
      if (lastMsg.is_read && lastMsg.read_at) {
        const readAtMs = new Date(lastMsg.read_at).getTime();
        const seenElapsedSec = (now - readAtMs) / 1000;
        if (seenElapsedSec >= 60 && seenElapsedSec <= 180) {
          return {
            shouldFollowUp: true,
            reason: 'seen_unreplied_1min',
            suggestedTopic: 'organic_followup'
          };
        }
      }

      // 2. Middle-of-conversation commute / transit check (5 minutes)
      if (elapsedMinutes >= 5 && elapsedMinutes <= 15) {
        const contentLower = lastMsg.content.toLowerCase();
        if (contentLower.includes('metro') || contentLower.includes('traffic') || contentLower.includes('nikal')) {
          return {
            shouldFollowUp: true,
            reason: 'transit_commute_interruption',
            suggestedTopic: 'arrival_checkin'
          };
        }
      }

      return { shouldFollowUp: false };
    } catch {
      return { shouldFollowUp: false };
    }
  }
}

export const watchtowerReflectionService = WatchtowerReflectionService.getInstance();
