/**
 * LifeThreadConversationWeaver.ts — Phase 3D-D Conversational LifeThread Cultivation
 *
 * Architectural Invariants:
 * 1. NATURAL CONTINUITY OVER REMINDERS: Surfaces relevant LifeThreads naturally during conversation
 *    without acting as a project manager, nag, or reminder bot.
 * 2. CURRENT USER TURN PRIORITY: User's direct topic or question ALWAYS takes precedence over stored goals.
 * 3. SENSITIVE CONTEXT PROTECTION: Suppresses goal weaving during grief, illness, family crisis, or distress.
 * 4. USER AGENCY RESPECT: Immediately honors STOP (permanent suppression), LATER (deferral), DONE (completion proposal),
 *    and REJECT.
 * 5. PASSIVE COMPLIANCE DEFENSE: "okay" / "theek hai" is NOT interpreted as user commitment.
 * 6. ZERO UNNECESSARY LLM CALLS: Deterministic matching first; 0 LLM calls on unrelated conversations.
 * 7. BOUNDED CONTEXT PACKET: Bounded, clean context for Nova/NACE; zero internal diagnostics or untrusted memories.
 */

import { logger } from '../lib/logger';
import {
  LifeThreadRow,
  lifeThreadRepository,
} from './lifeThreadRepository';
import {
  ConversationalWeavingPacket,
  LifeThreadWeavingDecision,
  UserConversationalResponseType,
} from '../types/lifeThreadCultivation';

export interface WeavingContext {
  userId: string;
  userTurnText: string;
  recentChatTurnIds?: string[];
  now?: Date;
  activeLifeThreads?: LifeThreadRow[];
  lastBridgedThreadId?: string;
  lastBridgedAt?: string;
}

export class LifeThreadConversationWeaver {
  /**
   * Classifies a user's natural conversational response to a LifeThread bridge or suggestion.
   */
  classifyUserResponse(userText: string): {
    type: UserConversationalResponseType;
    confidence: number;
    hasExplicitCommitment: boolean;
    rawText: string;
  } {
    const trimmed = userText.trim();
    const lower = trimmed.toLowerCase();

    // 1. STOP Detection (Permanent suppression for this thread)
    if (
      lower.includes('stop reminding') ||
      lower.includes("don't remind me") ||
      lower.includes('dont remind me') ||
      lower.includes('stop asking') ||
      lower.includes('drop this topic') ||
      lower.includes('forget this goal') ||
      lower.includes('cancel') ||
      lower.includes('not doing this anymore') ||
      lower.includes('do not want to do this anymore') ||
      lower.includes("don't want to do this anymore") ||
      lower.includes('mat poocho') ||
      lower.includes('band karo yeh')
    ) {
      return { type: 'STOP', confidence: 0.95, hasExplicitCommitment: false, rawText: trimmed };
    }

    // 2. LATER Detection (Deferral window)
    if (
      lower.includes('later') ||
      lower.includes('not now') ||
      lower.includes('baad mein') ||
      lower.includes('baad me') ||
      lower.includes('remind me tomorrow') ||
      lower.includes('kal dekhte hain') ||
      lower.includes('kal karenge') ||
      lower === 'baadme'
    ) {
      return { type: 'LATER', confidence: 0.9, hasExplicitCommitment: false, rawText: trimmed };
    }

    // 3. DONE Detection (Completion proposed)
    if (
      lower.includes('already done') ||
      lower.includes('already finished') ||
      lower.includes('finished it') ||
      lower.includes('completed this') ||
      lower.includes('complete ho gaya') ||
      lower.includes('ho gaya yeh') ||
      lower.includes('kar liya')
    ) {
      return { type: 'DONE', confidence: 0.95, hasExplicitCommitment: false, rawText: trimmed };
    }

    // 4. REJECT Detection
    if (
      lower.includes('no, not interested') ||
      lower.includes("don't want to do this") ||
      lower.includes('nahin karna') ||
      lower.includes('nahi karna') ||
      lower === 'no' ||
      lower === 'nahi'
    ) {
      return { type: 'REJECT', confidence: 0.9, hasExplicitCommitment: false, rawText: trimmed };
    }

    // 5. ACCEPT with Explicit Concrete Commitment
    const hasCommitmentPhrasing =
      lower.includes('i will do') ||
      lower.includes("i'll do") ||
      lower.includes('tonight') ||
      lower.includes('today evening') ||
      lower.includes('tomorrow morning') ||
      lower.includes('starting right now') ||
      lower.includes('aaj raat ko karunga') ||
      lower.includes('abhi karta hoon');

    if (hasCommitmentPhrasing) {
      return { type: 'ACCEPT', confidence: 0.9, hasExplicitCommitment: true, rawText: trimmed };
    }

    // 6. PASSIVE COMPLIANCE ("okay", "theek hai", "hmm")
    const passiveWords = ['okay', 'ok', 'theek hai', 'thik hai', 'hmm', 'sure', 'ha', 'haan', 'acha', 'accha'];
    const isPurePassive = passiveWords.some(w => lower === w || lower === `${w}.` || lower === `${w}!`);

    if (isPurePassive) {
      return { type: 'PASSIVE_COMPLIANCE', confidence: 0.85, hasExplicitCommitment: false, rawText: trimmed };
    }

    // 7. General Acceptance without concrete commitment
    if (lower.includes("let's do it") || lower.includes('sounds good') || lower.includes('chalo karte hain')) {
      return { type: 'ACCEPT', confidence: 0.75, hasExplicitCommitment: false, rawText: trimmed };
    }

    return { type: 'UNKNOWN', confidence: 0.3, hasExplicitCommitment: false, rawText: trimmed };
  }

  /**
   * Checks if the user's current utterance indicates emotional distress, grief, medical emergency, or conflict.
   * If true, ALL goal-weaving is immediately suppressed.
   */
  isSensitiveContext(text: string): boolean {
    if (!text) return false;
    const lower = text.toLowerCase();
    const sensitivePatterns = [
      /\b(hospital|emergency|admitted|doctor|surgery|illness|severe pain|bleeding)\b/i,
      /\b(passed away|died|death|funeral|grief|mourning|rip)\b/i,
      /\b(depressed|suicid|panic attack|breakdown|crying uncontrollably)\b/i,
      /\b(fired|layoff|lost my job|bankrupt|eviction)\b/i,
      /\b(police|court|arrested|lawsuit)\b/i,
    ];

    return sensitivePatterns.some(pat => pat.test(lower));
  }

  /**
   * Checks if user turn is asking a direct, unrelated informational question.
   */
  isDirectUnrelatedQuestion(text: string): boolean {
    if (!text) return false;
    const lower = text.toLowerCase();
    // Common knowledge / weather / general assistant questions
    if (
      lower.startsWith('what is the capital') ||
      lower.startsWith("what's the weather") ||
      lower.startsWith('weather in') ||
      lower.startsWith('how far is') ||
      lower.startsWith('who is the president') ||
      lower.startsWith('define ') ||
      lower.startsWith('translate ')
    ) {
      return true;
    }
    return false;
  }

  /**
   * Evaluates whether an active LifeThread should be naturally woven into current conversation.
   * Deterministic first; returns bounded context packet.
   */
  async evaluateConversationalWeaving(
    threads: LifeThreadRow[],
    ctx: WeavingContext
  ): Promise<LifeThreadWeavingDecision> {
    const now = ctx.now || new Date();
    const nowIso = now.toISOString();
    const userText = ctx.userTurnText;

    // ── 1. Sensitive Context Check ──────────────────────────────────────────
    if (this.isSensitiveContext(userText)) {
      return {
        userId: ctx.userId,
        shouldWeave: false,
        suppressionReason: 'Sensitive context detected (grief/medical/distress); goal weaving suppressed',
        evaluatedAt: nowIso,
      };
    }

    // ── 2. Direct Unrelated Question Check ───────────────────────────────────
    if (this.isDirectUnrelatedQuestion(userText)) {
      return {
        userId: ctx.userId,
        shouldWeave: false,
        suppressionReason: 'Direct informational question from user; prioritizing direct reply',
        evaluatedAt: nowIso,
      };
    }

    // ── 3. Find Matching Relevant LifeThread ────────────────────────────────
    const userTokens = this.extractTokens(userText);
    let matchedThread: LifeThreadRow | null = null;
    let matchConfidence: 'HIGH' | 'MEDIUM' = 'MEDIUM';
    let matchReason = '';

    for (const thread of threads) {
      // Skip terminal threads
      if (thread.state === 'completed' || thread.state === 'abandoned' || thread.state === 'superseded') {
        continue;
      }

      // Check deferral window (from "later")
      if (thread.next_relevant_time && new Date(thread.next_relevant_time).getTime() > now.getTime()) {
        continue;
      }

      // Dormant or Stalled threads require explicit user keywords to wake
      const isDormantOrStalled = thread.cultivation_stage === 'DORMANT' || thread.cultivation_stage === 'STALLED_OR_UNCERTAIN';

      const topicTokens = this.extractTokens(thread.topic);
      const canonicalTokens = thread.canonical_key ? thread.canonical_key.split('_') : [];
      const allThreadKeywords = Array.from(new Set([...topicTokens, ...canonicalTokens]));

      const matchingTokens = allThreadKeywords.filter(k => userTokens.includes(k));

      if (matchingTokens.length >= 2 || (matchingTokens.length === 1 && matchingTokens[0].length > 4)) {
        // High confidence match
        matchedThread = thread;
        matchConfidence = 'HIGH';
        matchReason = `User turn explicitly referenced thread keywords: [${matchingTokens.join(', ')}]`;
        break;
      } else if (matchingTokens.length === 1 && !isDormantOrStalled) {
        // Moderate match on active thread
        matchedThread = thread;
        matchConfidence = 'MEDIUM';
        matchReason = `User turn matched single keyword [${matchingTokens[0]}] on active thread`;
        break;
      }
    }

    if (!matchedThread) {
      return {
        userId: ctx.userId,
        shouldWeave: false,
        suppressionReason: 'No relevant LifeThread matches current user turn topic',
        evaluatedAt: nowIso,
      };
    }

    // ── 4. Duplicate Bridge Suppression Check ───────────────────────────────
    if (ctx.lastBridgedThreadId === matchedThread.id && ctx.lastBridgedAt) {
      const timeSinceLastBridgeMs = now.getTime() - new Date(ctx.lastBridgedAt).getTime();
      if (timeSinceLastBridgeMs < 10 * 60 * 1000) { // 10 minutes
        return {
          userId: ctx.userId,
          shouldWeave: false,
          suppressionReason: `Duplicate bridge suppressed for thread "${matchedThread.topic}" within 10m window`,
          evaluatedAt: nowIso,
        };
      }
    }

    // ── 5. Construct Bounded Natural Bridge & Weaving Packet ────────────────
    const naturalBridge = this.generateNaturalBridge(matchedThread);
    const activeBlockers = (matchedThread.blockers || []).filter(b => !b.resolved_at);
    const blockerSummary = activeBlockers.length > 0 ? activeBlockers[0].description : null;

    const packet: ConversationalWeavingPacket = {
      threadId: matchedThread.id,
      topic: matchedThread.topic,
      canonicalKey: matchedThread.canonical_key,
      cultivationStage: matchedThread.cultivation_stage || 'DISCOVERY',
      naturalBridge,
      proposedNextUsefulStep: matchedThread.next_useful_step || null,
      activeBlockerSummary: blockerSummary,
      confidence: matchConfidence,
      relevanceReason: matchReason,
    };

    return {
      userId: ctx.userId,
      shouldWeave: true,
      packet,
      evaluatedAt: nowIso,
    };
  }

  /**
   * Processes the user's conversational response and executes appropriate state updates via repository.
   */
  async processConversationalResponse(
    userId: string,
    threadId: string,
    userText: string
  ): Promise<LifeThreadWeavingDecision> {
    const nowIso = new Date().toISOString();
    const classification = this.classifyUserResponse(userText);

    try {
      const thread = await lifeThreadRepository.getThreadById(userId, threadId);
      if (!thread) {
        return {
          userId,
          shouldWeave: false,
          suppressionReason: 'LifeThread not found',
          classifiedUserResponse: classification,
          evaluatedAt: nowIso,
        };
      }

      // ── STOP: Abandon & suppress thread ───────────────────────────────────
      if (classification.type === 'STOP') {
        await lifeThreadRepository.createOrUpdateThread(
          userId,
          {
            threadId: thread.id,
            topic: thread.topic,
            state: 'abandoned',
            cultivationStage: 'DORMANT',
          },
          {
            sourceAuthority: 'user_explicit',
            evidenceProvenance: 'USER_EXPLICIT',
            reason: 'User explicitly commanded STOP on life thread',
          }
        );
        logger.info('[LifeThreadConversationWeaver] Thread permanently suppressed on STOP', {
          userId,
          threadId,
        });
      }

      // ── LATER: Set deferral window (24h) ───────────────────────────────────
      else if (classification.type === 'LATER') {
        const deferUntil = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
        await lifeThreadRepository.createOrUpdateThread(
          userId,
          {
            threadId: thread.id,
            topic: thread.topic,
            nextRelevantTime: deferUntil,
          },
          {
            sourceAuthority: 'user_explicit',
            evidenceProvenance: 'USER_EXPLICIT',
            reason: 'User requested LATER; deferred for 24 hours',
          }
        );
        logger.info('[LifeThreadConversationWeaver] Thread deferred on LATER', {
          userId,
          threadId,
          deferUntil,
        });
      }

      // ── DONE: Propose completion ──────────────────────────────────────────
      else if (classification.type === 'DONE') {
        await lifeThreadRepository.createOrUpdateThread(
          userId,
          {
            threadId: thread.id,
            topic: thread.topic,
            cultivationStage: 'COMPLETION_PROPOSED',
          },
          {
            sourceAuthority: 'user_explicit',
            evidenceProvenance: 'USER_EXPLICIT',
            reason: 'User stated DONE; transitioned to COMPLETION_PROPOSED awaiting confirmation',
          }
        );
      }

      // ── ACCEPT with Concrete Commitment ──────────────────────────────────
      else if (classification.type === 'ACCEPT' && classification.hasExplicitCommitment) {
        await lifeThreadRepository.createOrUpdateThread(
          userId,
          {
            threadId: thread.id,
            topic: thread.topic,
            cultivationStage: 'IN_PROGRESS',
            state: 'active',
          },
          {
            sourceAuthority: 'user_explicit',
            evidenceProvenance: 'USER_EXPLICIT',
            reason: `User explicitly committed in conversation: "${userText}"`,
          }
        );
      }

      // ── PASSIVE COMPLIANCE ("okay"): ZERO state mutation ──────────────────
      else if (classification.type === 'PASSIVE_COMPLIANCE') {
        logger.debug('[LifeThreadConversationWeaver] Passive compliance received; zero state mutation', {
          userId,
          threadId,
        });
      }
    } catch (err: any) {
      logger.error('[LifeThreadConversationWeaver] Response processing error', {
        userId,
        threadId,
        error: err.message,
      });
    }

    return {
      userId,
      shouldWeave: false,
      classifiedUserResponse: classification,
      evaluatedAt: nowIso,
    };
  }

  // ── Helper Formatter & Tokenizer ───────────────────────────────────────────

  private generateNaturalBridge(thread: LifeThreadRow): string {
    const nextStep = thread.next_useful_step;
    if (nextStep && nextStep.title) {
      return `Last time we were looking at ${nextStep.title}. Want to continue from there?`;
    }
    return `Want to continue with ${thread.topic}?`;
  }

  private extractTokens(text?: string): string[] {
    if (!text) return [];
    const stopWords = new Set([
      'the', 'is', 'at', 'which', 'on', 'a', 'an', 'and', 'or', 'to', 'in', 'for', 'with', 'about',
      'i', 'me', 'my', 'you', 'your', 'we', 'our', 'what', 'how', 'when', 'where', 'why',
      'hai', 'ka', 'ki', 'ke', 'ko', 'mein', 'se', 'yeh', 'woh', 'karna', 'karo'
    ]);

    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 2 && !stopWords.has(w));
  }
}

export const lifeThreadConversationWeaver = new LifeThreadConversationWeaver();
