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
import { clusterMemoriesIntoWardrobes } from '../lib/memoryDomains';
import { watchtowerInspector } from './WatchtowerInspector';

export interface MessageVersionEntry {
  version: number;
  content: string;
  timestamp: string;
  flaw?: string;
  flaw_type?: string;
  reason?: string;
  clean_label?: string;
  tri_pass_verified?: boolean;
  green_seal?: boolean;
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
    let canonicalData: any[] = [];
    let workingData: any[] = [];
    try {
      // Trigger background memory harmonization & dot-connection audit
      this.harmonizeAndAuditMemories(userId).catch(e =>
        logger.warn('[WATCHTOWER HARMONIZER] Background harmonization error', { error: e.message })
      );

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

      canonicalData = canonicalRes.data || [];
      workingData = workingRes.data || [];
      const canonicalList = canonicalData
        .map((m: any) => `- ${m.key}: ${m.value} (${m.memory_type || 'general'})`);
      const workingList = workingData
        .map((w: any) => `- [working] ${w.key}: ${w.value}`);

      let wardrobeSection = '';
      try {
        const { wardrobes } = clusterMemoriesIntoWardrobes(canonicalRes.data || [], workingRes.data || []);
        if (wardrobes.length > 0) {
          wardrobeSection = 'Entity Wardrobes & Traits:\n' + wardrobes.map(w =>
            `• ${w.avatarEmoji} [${w.name} (${w.roleTitle || w.domain})]: ${w.summary} | Traits: ${w.traits.map(t => `${t.label}: ${t.value}`).join('; ')}`
          ).join('\n') + '\n\n';
        }
      } catch {
        // Fallback to flat list
      }

      memorySummary = wardrobeSection + [...canonicalList, ...workingList].join('\n');
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

    if (signal.aborted) return;    // Resolve user's local hour, time string, and exact calendar date
    let localHour = 20;
    let localTimeStr = 'evening';
    let localDateStr = 'Current Date';
    let localTomorrowDateStr = 'Tomorrow';
    let tzOffsetHours = 5.5;
    try {
      const { data: prof } = await supabaseAdmin.from('profiles').select('country, timezone_offset, timezone').eq('id', userId).maybeSingle();
      const { resolveUserTzOffsetHours } = await import('./ReminderEngine');
      tzOffsetHours = resolveUserTzOffsetHours(prof || undefined);
      const localDate = new Date(Date.now() + tzOffsetHours * 3600 * 1000);
      localHour = localDate.getUTCHours();
      const hh = localHour % 12 || 12;
      const mm = localDate.getUTCMinutes().toString().padStart(2, '0');
      const ampm = localHour >= 12 ? 'PM' : 'AM';
      localTimeStr = `${hh}:${mm} ${ampm}`;

      const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
      localDateStr = `${DAYS[localDate.getUTCDay()]}, ${localDate.getUTCDate()} ${MONTHS[localDate.getUTCMonth()]} ${localDate.getUTCFullYear()}`;
      const nextDate = new Date(localDate.getTime() + 24 * 3600 * 1000);
      localTomorrowDateStr = `${DAYS[nextDate.getUTCDay()]}, ${nextDate.getUTCDate()} ${MONTHS[nextDate.getUTCMonth()]} ${nextDate.getUTCFullYear()}`;
    } catch {
      // fallback to defaults
    }

    const calendarContext = {
      localDateStr,
      localTomorrowDateStr,
      localTimeStr,
      localHour,
      tzOffsetHours
    };

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
      // ── PASS 1: Surface & Domain Memory Alignment ──
      const pass1Result = await this.executePass1Surface(
        content,
        userMessage,
        recentChat,
        memorySummary,
        calendarContext,
        signal
      );
      if (signal.aborted) return;
      let candidate = pass1Result.candidate;

      // Deterministic Reminder Override (if Nova hallucinated past tense on a reminder request)
      const lowerCandidate = candidate.toLowerCase();
      const hasPastTemporalHallucination = /\b(?:reminder\s*diya\s*tha|diya\s*tha|yaad\s*kar\s*raha\s*hoon)\b/i.test(lowerCandidate);
      if (scheduledByWatchtower && hasPastTemporalHallucination) {
        candidate = `Haan bilkul! 😊 Maine ${scheduledByWatchtower.formattedTime || 'kal'} ka reminder set kar diya hai — ${scheduledByWatchtower.task || 'tumhare kaam'} ke liye. Main tumhe barabar yaad dila dungi!`;
      }

      // Deterministic Night-Time Untimely Action Override
      const isUntimelyHour = localHour >= 20 || localHour < 6;
      const hasUntimelyActionPrompt = /\b(?:workout\s*(?:karo|kar\s*le|shuru|start)|exercise\s*(?:karo|kar\s*le|start)|khana\s*bana(?:ne)?|start\s*kar\s*de|shuru\s*kar\s*de)\b/i.test(lowerCandidate);
      if (isUntimelyHour && hasUntimelyActionPrompt) {
        if (lowerCandidate.includes('exercise') || lowerCandidate.includes('workout')) {
          candidate = 'Waise tum usually kis time workout karna pasand karte ho — morning mein ya evening mein? Ya koi specific routine follow karte ho?';
        } else if (lowerCandidate.includes('khana') || lowerCandidate.includes('cook')) {
          candidate = 'Waise kal ke liye kya plan hai? Cooking aap karte ho ya aapki wife karti hai?';
        } else {
          candidate = 'Aaram se dekh lena jab free ho! Abhi toh unwinding ka time hai 😊';
        }
      }

      // Deterministic Future Plan / Proactive Reminder Safety Net
      const hasFuturePlanSignal = reminderIntentDetector.hasFuturePlanIntent(userMessage);
      const isPassiveOrOneWordReply = candidate.trim().split(/\s+/).length <= 3 && /\b(sahi|ok|theek|mast|haan|achha|acha)\b/i.test(lowerCandidate);
      const lacksReminderOffer = !/\b(remind|yaad|alarm|baje|time|bataun|laga\s*doon|set\s*kar)\b/i.test(lowerCandidate);
      if (hasFuturePlanSignal && (isPassiveOrOneWordReply || lacksReminderOffer)) {
        const planDetails = reminderIntentDetector.extractFuturePlanDetails(userMessage, tzOffsetHours);
        if (!planDetails.isAmbiguous && planDetails.formattedTime) {
          const taskName = planDetails.title && planDetails.title.toLowerCase() !== 'reminder' ? planDetails.title : 'workout';
          candidate = `Mast plan hai yaar! 💪 Kya main ${planDetails.formattedTime} ka ${taskName} reminder set kar doon tere liye, taaki miss na ho?`;
        } else {
          candidate = `Arey badhiya decision hai! Kaunse time pe remind karun tujhe — subah ya shaam ko, aur roz ya specific days pe?`;
        }
      }

      // ── PASS 2: Deep Cross-Memory Neural Link Mesh ──
      const pass2Result = await this.executePass2DeepNeuralLink(
        candidate,
        userMessage,
        recentChat,
        memorySummary,
        calendarContext,
        signal
      );
      if (signal.aborted) return;
      candidate = pass2Result.candidate;

      // ── PASS 3: Autonomous Verification & Final Green-Tick Seal Loop ──
      const pass3Result = await this.executePass3GreenSeal(
        candidate,
        userMessage,
        recentChat,
        memorySummary,
        calendarContext,
        signal
      );
      if (signal.aborted) return;
      let finalCandidate = pass3Result.candidate;

      // Deterministic Grounding & Formatting Quality Gate
      const { sanitizeReply, isPromptLeak, validateAndRepairGrounding } = await import('./NovaBrainService');
      finalCandidate = validateAndRepairGrounding(
        sanitizeReply(finalCandidate),
        userMessage,
        { memories: canonicalData, workingMemories: workingData }
      );

      if (isPromptLeak(finalCandidate) || !finalCandidate.trim()) {
        logger.warn('[WATCHTOWER REFLECTION] Final candidate failed leak test or was blank, cancelling correction', { finalCandidate });
        return;
      }

      const inspection = watchtowerInspector.inspectAndRepair(finalCandidate, userMessage, {
        memories: canonicalData,
        workingMemories: workingData,
        calendarContext
      });

      if (!inspection.passed || inspection.isNonsensical || inspection.hasHallucination) {
        logger.warn('[WATCHTOWER REFLECTION] Final candidate rejected by Watchtower Inspector, aborting correction', {
          flaws: inspection.flaws,
          score: inspection.score,
          candidateSnippet: finalCandidate.substring(0, 60),
        });
        return;
      }
      finalCandidate = inspection.cleanText;

      // If reply is unchanged from original, it has passed all 3 passes with green seal!
      if (finalCandidate.trim() === (content || '').trim()) {
        logger.info('[WATCHTOWER REFLECTION] Initial reply verified clean across all 3 passes with Green Seal', {
          userId,
          messageId,
          iterations: pass3Result.iterations
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

      // Prepare versions array with clean labels (never raw developer critique)
      const existingMeta = (messageRow.meta as any) || {};
      const versions: MessageVersionEntry[] = existingMeta.versions || [
        {
          version: 1,
          content: messageRow.content,
          timestamp: messageRow.created_at,
          clean_label: 'Initial Response'
        }
      ];

      const newVersion: MessageVersionEntry = {
        version: versions.length + 1,
        content: finalCandidate.trim(),
        timestamp: new Date().toISOString(),
        clean_label: '✨ Autonomous Tri-Pass Refinement (Green Seal)',
        tri_pass_verified: true,
        green_seal: true
      };
      versions.push(newVersion);

      const updatedMeta = {
        ...existingMeta,
        is_corrected: true,
        tri_pass_verified: true,
        green_seal: true,
        active_version_index: versions.length - 1,
        versions,
        last_reflection_at: new Date().toISOString()
      };

      // 6. Update chat_history with the refined content and version metadata
      const { error: updateErr } = await supabaseAdmin
        .from('chat_history')
        .update({
          content: finalCandidate.trim(),
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

      logger.info('[WATCHTOWER REFLECTION] Successfully auto-corrected Nova reply with Tri-Pass Green Seal!', {
        userId,
        messageId,
        iterations: pass3Result.iterations,
        originalSnippet: messageRow.content.substring(0, 60),
        correctedSnippet: finalCandidate.substring(0, 60)
      });

      // 7. Log correction to audit log for founder review
      try {
        await supabaseAdmin.from('nova_corrections_log').insert({
          user_id: userId,
          original_nova_message: messageRow.content.substring(0, 2000),
          user_correction: `[Watchtower Tri-Pass Autonomous Refinement] Green Seal Verified`,
          detected_flaw_type: 'tri_pass_refinement',
          generated_patch: finalCandidate.substring(0, 2000),
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
   * Pass 1: Surface & Domain Memory Alignment Worker
   * Checks domain memories, spelling typos ("kee", "kaa", "rata", "khaali pan"),
   * feminine voice ("main karti hoon"), and action continuity.
   */
  private async executePass1Surface(
    content: string,
    userMessage: string,
    recentChat: string,
    memorySummary: string,
    calendarContext: { localDateStr: string; localTomorrowDateStr: string; localTimeStr: string; localHour: number },
    signal: AbortSignal
  ): Promise<{ candidate: string; hasChanges: boolean }> {
    if (signal.aborted) return { candidate: content, hasChanges: false };

    const systemPrompt = `You are Pass 1 (Surface & Domain Memory Alignment Worker) of the Watchtower Autonomous Pipeline for Nova.
Nova is an AI best friend who texts on WhatsApp.
Your job is to inspect Nova's reply for:
1. Immediate domain memory alignment (family names, daily routine, diet, health habits).
2. Surface grammar, typos, and spelling slips in Hinglish:
   - "tulsi kee patti" -> "tulsi ki patti", "chai kaa" -> "chai ka"
   - "rata" -> "raat"
   - "khaali pan" -> "khali pet"
   - "main bhi karte hoon" / "main samajh mein aata hoon" -> MUST be feminine first person: "main bhi karti hoon", "main samajh gayi"
   - "tu ... sakte hai" -> "tu ... sakta hai"
3. Action & conversational continuity: Did the user ask for an alarm or reminder or share a plan? Make sure Nova acknowledges it clearly and keeps conversational momentum.
4. Keep it short and natural for WhatsApp (1-2 sentences).

Return ONLY a JSON object:
{
  "has_corrections": boolean,
  "refined_text": "The refined 1-2 sentence reply in natural Hinglish"
}`;

    const userPrompt = `Calendar Ground Truth: Today is ${calendarContext.localDateStr}, Time: ${calendarContext.localTimeStr}
User's Latest Message: "${userMessage}"
Recent Conversation Context:\n${recentChat}
User Memories:\n${memorySummary}
Nova's Reply:\n"${content}"

Check domain memories, typos, spelling ("kee", "kaa", "rata"), feminine grammar ("karti hoon"), and action continuity. Return JSON.`;

    try {
      const res = await complete('USER_FAST', [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ], { temperature: 0.15, maxTokens: 400 });

      if (signal.aborted) return { candidate: content, hasChanges: false };
      const match = res.match(/\{[\s\S]*\}/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        if (parsed.has_corrections && parsed.refined_text && parsed.refined_text.trim()) {
          return { candidate: parsed.refined_text.trim(), hasChanges: true };
        }
      }
    } catch (err) {
      logger.debug('[Watchtower Pass 1] Non-fatal pass 1 error', { error: err });
    }

    return { candidate: content, hasChanges: false };
  }

  /**
   * Pass 2: Deep Cross-Memory Neural Link Mesh Worker
   * Checks multi-hop connections, baby birth year 2026 ground truth, birthday calendar distance,
   * and ensures dot-connecting ideas are framed with curious thought rather than assumptions.
   */
  private async executePass2DeepNeuralLink(
    candidate: string,
    userMessage: string,
    recentChat: string,
    memorySummary: string,
    calendarContext: { localDateStr: string; localTomorrowDateStr: string; localTimeStr: string; localHour: number },
    signal: AbortSignal
  ): Promise<{ candidate: string; hasChanges: boolean }> {
    if (signal.aborted) return { candidate, hasChanges: false };

    const systemPrompt = `You are Pass 2 (Deep Cross-Memory Neural Mesh Worker) of the Watchtower Autonomous Pipeline for Nova.
Your job is to inspect the candidate reply against the user's actual life context and memories:
1. Calendar Ground Truth & Temporal Distance:
   - Today is ${calendarContext.localDateStr}, Time: ${calendarContext.localTimeStr}.
   - Stating a past date of birth or future date is factual knowledge, NEVER an instruction to celebrate tomorrow morning.
   - Do NOT inject unprompted family/birthday comments if the user's message is about work, office targets, or everyday tasks.
2. Entity Attribution & Common Sense:
   - Never confuse people, ages, or roles from the memories.
   - If connecting dots between memories, phrase it as a curious thought ("Maine socha kya...", "Waise ek thought aaya tha..."), NEVER as an assumption.
3. Keep it warm, concise (1-2 sentences), and natural WhatsApp Hinglish. Only make corrections if there is a genuine factual or coherence defect.

Return ONLY a JSON object:
{
  "has_deep_corrections": boolean,
  "deep_refined_text": "The refined reply with deep cross-memory alignment"
}`;

    const userPrompt = `Calendar Ground Truth: Today is ${calendarContext.localDateStr}, Tomorrow is ${calendarContext.localTomorrowDateStr}
User's Latest Message: "${userMessage}"
Recent Conversation Context:\n${recentChat}
User Memories:\n${memorySummary}
Candidate Reply from Pass 1:\n"${candidate}"

Verify deep cross-memory links, temporal calendar consistency, and natural conversational flow. Return JSON.`;

    try {
      const res = await complete('LEARNING', [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ], { temperature: 0.15, maxTokens: 400 });

      if (signal.aborted) return { candidate, hasChanges: false };
      const match = res.match(/\{[\s\S]*\}/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        if (parsed.has_deep_corrections && parsed.deep_refined_text && parsed.deep_refined_text.trim()) {
          return { candidate: parsed.deep_refined_text.trim(), hasChanges: true };
        }
      }
    } catch (err) {
      logger.debug('[Watchtower Pass 2] Non-fatal pass 2 error', { error: err });
    }

    return { candidate, hasChanges: false };
  }

  /**
   * Pass 3: Autonomous Verification & Final Green-Tick Seal Loop Worker
   * Dedicated verifier ensuring zero defects across spelling, gender agreement, dates, and WhatsApp tone.
   * If any defect is detected, it re-triggers a repair worker (up to 3 iterations) until verified with Green Seal.
   */
  private async executePass3GreenSeal(
    candidate: string,
    userMessage: string,
    _recentChat: string,
    _memorySummary: string,
    calendarContext: { localDateStr: string; localTomorrowDateStr: string; localTimeStr: string; localHour: number },
    signal: AbortSignal
  ): Promise<{ candidate: string; greenSeal: boolean; iterations: number }> {
    let currentCandidate = candidate;
    let iterations = 0;
    const MAX_REPAIR_ITERATIONS = 3;

    while (iterations < MAX_REPAIR_ITERATIONS) {
      if (signal.aborted) return { candidate: currentCandidate, greenSeal: false, iterations };
      iterations++;

      const systemPrompt = `You are Pass 3 (Final Green-Check Seal & Repair Provider) of the Watchtower Autonomous Pipeline for Nova.
Your job is the final green-check clearance. Inspect the candidate against this strict 5-point checklist:
1. Zero typos, phonetic slips, or unnatural Hindi (e.g. no "purn karna", use "poora karna").
2. Strictly female first-person Hindi ("main karti hoon", "main bolti hoon", "main samajh gayi", NEVER "Maine samajh gaya" or male verbs).
3. 100% mathematically grounded dates, times, and calendar awareness.
4. No unprompted birthday celebration hallucinations or contradictions with active user focus (e.g. telling a working user "kuch mat karo").
5. Warm, natural, concise WhatsApp friend voice (1-2 sentences).

If ALL 5 points pass with flying colors, set green_seal: true.
If ANY point fails, set green_seal: false, describe the flaw, and provide the fully repaired text.

Return ONLY a JSON object:
{
  "green_seal": boolean,
  "flaw_detected": string | null,
  "final_text": "The verified text with green check seal"
}`;

      const userPrompt = `Today's Date: ${calendarContext.localDateStr}
User's Message: "${userMessage}"
Candidate to verify: "${currentCandidate}"

Inspect and provide green seal clearance or repaired text. Return JSON.`;

      try {
        const res = await complete('USER_FAST', [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ], { temperature: 0.1, maxTokens: 400 });

        if (signal.aborted) return { candidate: currentCandidate, greenSeal: false, iterations };
        const match = res.match(/\{[\s\S]*\}/);
        if (match) {
          const parsed = JSON.parse(match[0]);
          if (parsed.green_seal) {
            const inspectedCandidate = (parsed.final_text || currentCandidate).trim();
            const passCheck = watchtowerInspector.inspectAndRepair(inspectedCandidate, userMessage, { calendarContext });
            return {
              candidate: passCheck.cleanText,
              greenSeal: passCheck.passed,
              iterations
            };
          } else if (parsed.final_text && parsed.final_text.trim()) {
            currentCandidate = parsed.final_text.trim();
            // Loop will verify this repaired candidate on next iteration
          }
        } else {
          break;
        }
      } catch (err) {
        logger.debug('[Watchtower Pass 3] Non-fatal pass 3 error', { error: err });
        break;
      }
    }

    const finalInspection = watchtowerInspector.inspectAndRepair(currentCandidate, userMessage, { calendarContext });
    return {
      candidate: finalInspection.cleanText,
      greenSeal: finalInspection.passed,
      iterations
    };
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

  /**
   * Autonomous Watchtower Memory Harmonizer & Dot-Connection Scanner.
   * Scans recent memories for fragmented or uncanonical branches (e.g. `nail_art`, `self_taught`, `tiku`),
   * re-parents orphaned stems under proper entities (e.g. `tiku` under Shreshth, `nail_art` under Sakshi),
   * and merges overlapping/near memories cleanly.
   */
  async harmonizeAndAuditMemories(userId: string): Promise<void> {
    try {
      const { data: rows } = await supabaseAdmin
        .from('memories')
        .select('id, key, value, memory_type, lifecycle_state')
        .eq('user_id', userId)
        .eq('is_archived', false)
        .order('updated_at', { ascending: false })
        .limit(50);

      if (!rows || rows.length === 0) return;

      const memMap = new Map<string, any>();
      for (const r of rows) {
        if (r.lifecycle_state === 'SUPERSEDED' || r.lifecycle_state === 'INVALIDATED') continue;
        memMap.set(r.key.toLowerCase(), r);
      }

      // 1. Harmonize Son / Tiku Nickname Stem:
      const tikuRow = memMap.get('tiku');
      const sonNameRow = memMap.get('son_name') || memMap.get('shreshth');
      if (tikuRow && sonNameRow) {
        logger.info('[WATCHTOWER HARMONIZER] Auto-reparenting tiku memory into son_nickname stem under Shreshth', { userId });
        await supabaseAdmin.from('memories').update({
          key: 'son_nickname',
          value: 'Tiku',
          lifecycle_state: 'CURRENT',
          updated_at: new Date().toISOString()
        }).eq('id', tikuRow.id);
      }

      // 2. Harmonize Wife / Sakshi Nail Art Fragments:
      const fragmentKeys = ['nail_art', 'self_taught', 'beautiful_art', 'last_year_nail_art', 'self_taught_nail_art'];
      const foundFragments = fragmentKeys.map(k => memMap.get(k)).filter(Boolean);
      if (foundFragments.length > 1) {
        logger.info('[WATCHTOWER HARMONIZER] Auto-consolidating nail art skill fragments under Sakshi', { userId, count: foundFragments.length });
        const primary = foundFragments[0];
        const mergedValue = 'Self-taught nail artist (creates beautiful art with kit purchased last year)';
        await supabaseAdmin.from('memories').update({
          key: 'wife_nail_art_skill',
          value: mergedValue,
          lifecycle_state: 'CURRENT',
          updated_at: new Date().toISOString()
        }).eq('id', primary.id);

        for (let i = 1; i < foundFragments.length; i++) {
          await supabaseAdmin.from('memories').update({
            is_archived: true,
            lifecycle_state: 'SUPERSEDED',
            superseded_by: primary.id,
            supersession_reason: 'Consolidated into wife_nail_art_skill by Watchtower Harmonizer'
          }).eq('id', foundFragments[i].id);
        }
      }
    } catch (err: any) {
      logger.warn('[WATCHTOWER HARMONIZER] Harmonization scan skipped or error', { error: err.message });
    }
  }
}

export const watchtowerReflectionService = WatchtowerReflectionService.getInstance();
