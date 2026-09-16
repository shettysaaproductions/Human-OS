/**
 * VoiceResponseLifecycle.ts — Authoritative Lifecycle & Zero-Thinking Audio Gate for Nova
 *
 * Enforces strict response states:
 * RECEIVED -> UNDERSTANDING -> THINKING -> ACTING -> FINALIZING -> COMPLETED
 *
 * Invariants:
 * 1. ONLY state 'COMPLETED' may generate user-visible assistant audio or messages.
 * 2. Internal thinking, model scratch, status phrases, and fallback fillers
 *    ("Hmm, let me think...", "Mujhe sochne de...", "Ek minute...", "Main check karti hoon...")
 *    are NEVER synthesized as voice replies and NEVER persisted as assistant messages.
 * 3. Actions and tools (reminders, memory, branch relocation) execute silently in the background.
 * 4. Audio synthesis strictly consumes verified `finalResponse.text`.
 * 5. Exactly ONE assistant response is produced per user voice message (single finalization gate).
 */

import { logger } from '../lib/logger';

export type VoiceTurnState =
  | 'RECEIVED'
  | 'UNDERSTANDING'
  | 'THINKING'
  | 'ACTING'
  | 'FINALIZING'
  | 'COMPLETED'
  | 'FAILED';

export interface FinalTurnResponse {
  turnId: string;
  userId: string;
  conversationId: string;
  state: 'COMPLETED';
  finalText: string;
  finalAudioBase64?: string;
  finalAudioDuration?: number;
  finalizedAt: number;
}

export interface VoiceTurnContext {
  turnId: string;
  userId: string;
  conversationId: string;
  state: VoiceTurnState;
  userAudioBase64?: string;
  userTranscript?: string;
  toolCalls: Array<{ tool: string; action: string; data?: any }>;
  toolResults: Array<{ tool: string; success: boolean; data?: any; error?: string }>;
  candidateText?: string;
  finalResponse?: FinalTurnResponse;
  finalized: boolean;
  createdAt: number;
  updatedAt: number;
}

/**
 * Strips XML tags, internal thoughts, and leading verbal hesitations/thinking phrases
 * so Nova answers directly and warmly like a friend.
 */
export function stripThinkingPrefix(text: string): string {
  if (!text) return '';
  let cleaned = text.trim();

  // Strip XML tags and internal thought blocks
  cleaned = cleaned
    .replace(/<thought[\s\S]*?<\/thought>/gi, '')
    .replace(/<thinking[\s\S]*?<\/thinking>/gi, '')
    .replace(/<subconscious_actions[\s\S]*?<\/subconscious_actions>/gi, '')
    .replace(/\*thinking\*[\s\S]*?\*/gi, '')
    .replace(/\[Replying to:.*?\]/gs, '')
    .trim();

  // Regex patterns for leading verbal hesitation and thinking markers
  const PREFIX_PATTERNS = [
    /^(hmm+(\s*[,.]*\s*)+)/i,
    /^(sochne\s+de(\.\.\.|\s*)+)/i,
    /^(mujhe\s+(thoda\s+)?sochne\s+de(\.\.\.|\s*)+)/i,
    /^(let\s+me\s+think(\.\.\.|\s*)+)/i,
    /^(give\s+me\s+a\s+(moment|sec|second)(\.\.\.|\s*)+)/i,
    /^(ek\s+(minute|second|sec)(\s+ruko)?(\.\.\.|\s*)+)/i,
    /^(ruko(\s+thoda)?(\.\.\.|\s*)+)/i,
    /^(wait(\s+a\s+(minute|second|moment))?(\.\.\.|\s*)+)/i,
    /^(main\s+check\s+kar(ti|rahi)\s+(hu|hoon)(\.\.\.|\s*)+)/i,
    /^(main\s+dekh\s+rahi\s+(hu|hoon)(\.\.\.|\s*)+)/i,
    /^(main\s+dekhti\s+(hu|hoon)(\.\.\.|\s*)+)/i,
    /^(i['’]m\s+(currently\s+)?analyzing(\.\.\.|\s*)+)/i,
    /^(let\s+me\s+analyze\s+that(\.\.\.|\s*)+)/i,
    /^(let\s+me\s+check(\.\.\.|\s*)+)/i,
    /^(i['’]m\s+checking(\.\.\.|\s*)+)/i,
    /^(let\s+me\s+listen\s+again(\.\.\.|\s*)+)/i,
    /^(hang\s+on(\.\.\.|\s*)+)/i,
    /^(just\s+a\s+(second|moment|sec)(\.\.\.|\s*)+)/i,
  ];

  let changed = true;
  let iterations = 0;
  while (changed && iterations < 5) {
    changed = false;
    iterations++;
    for (const pat of PREFIX_PATTERNS) {
      if (pat.test(cleaned)) {
        cleaned = cleaned.replace(pat, '').trim();
        changed = true;
      }
    }
  }

  return cleaned;
}

/**
 * Returns true if the string is purely an internal thinking phrase, fallback message,
 * or status placeholder with no substantive answer.
 */
export function isInterimThinkingPhrase(text: string): boolean {
  if (!text || !text.trim()) return true;
  const raw = text.trim();

  // 1. Direct match on known fallback replies or status phrases
  const KNOWN_FALLBACK_SUBSTRINGS = [
    'mujhe thoda sochne de',
    'mujhe sochne de',
    'main abhi batati hu',
    'main abhi batata hu',
    'give me a moment to think',
    'give me a moment',
    'let me think',
    "i'll text you right back",
    'currently analyzing the voice',
    'currently analyzing',
    'analyzing the voice message',
    'let me analyze that',
    'let me listen again',
    'main check karti hoon',
    'main dekh rahi hoon',
  ];
  for (const sub of KNOWN_FALLBACK_SUBSTRINGS) {
    if (raw.toLowerCase().includes(sub) && raw.length < 130) {
      return true;
    }
  }

  // 2. Strip thinking prefixes and check what substantive text remains
  const stripped = stripThinkingPrefix(raw);
  const alphanumericOnly = stripped.replace(/[^a-zA-Z0-9\u0900-\u097F]/g, '');
  if (alphanumericOnly.length < 3) {
    return true;
  }

  // 3. Exact matching against isolated thinking phrases
  const cleanedForMatching = raw.replace(/[\s.,!?…]+$/g, '');
  const STANDALONE_PATTERNS = [
    /^(hmm+(\.\.\.)?|wait|ruko|ek\s+minute|ek\s+second|sochne\s+de|let\s+me\s+think|give\s+me\s+a\s+moment|hold\s+on)$/i,
    /^(mujhe\s+sochne\s+de|main\s+check\s+karti\s+hoon|main\s+check\s+karti\s+hu|main\s+dekh\s+rahi\s+hoon|main\s+dekh\s+rahi\s+hu|i\s*am\s*checking|let\s*me\s*check)$/i,
    /^(i\s*am\s*analyzing(\s*that)?|let\s*me\s*listen\s*again)$/i,
    /^(ek\s+minute\s+ruko|ek\s+second\s+ruko|thoda\s+wait\s+karo|wait\s+karo)$/i,
    /^(main\s+abhi\s+batati\s+hu|main\s+abhi\s+batata\s+hu|main\s+abhi\s+dekh\s+ke\s+batati\s+hu)$/i,
  ];

  if (STANDALONE_PATTERNS.some(p => p.test(cleanedForMatching) || p.test(raw))) {
    return true;
  }

  return false;
}

export class VoiceResponseLifecycle {
  private static instance: VoiceResponseLifecycle;
  private activeTurns = new Map<string, VoiceTurnContext>();

  private constructor() {}

  public static getInstance(): VoiceResponseLifecycle {
    if (!VoiceResponseLifecycle.instance) {
      VoiceResponseLifecycle.instance = new VoiceResponseLifecycle();
    }
    return VoiceResponseLifecycle.instance;
  }

  /**
   * Initializes a new voice turn in RECEIVED state.
   */
  startTurn(turnId: string, userId: string, conversationId: string, userAudioBase64?: string): VoiceTurnContext {
    const context: VoiceTurnContext = {
      turnId,
      userId,
      conversationId,
      state: 'RECEIVED',
      userAudioBase64,
      toolCalls: [],
      toolResults: [],
      finalized: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.activeTurns.set(turnId, context);
    logger.info('[VoiceLifecycle] Voice turn received', { turnId, userId, state: 'RECEIVED' });
    return context;
  }

  getTurn(turnId: string): VoiceTurnContext | undefined {
    return this.activeTurns.get(turnId);
  }

  transitionState(turnId: string, newState: VoiceTurnState): void {
    const turn = this.activeTurns.get(turnId);
    if (!turn) {
      logger.warn('[VoiceLifecycle] Cannot transition unknown turn', { turnId, newState });
      return;
    }
    if (turn.finalized && newState !== 'COMPLETED') {
      logger.warn('[VoiceLifecycle] Turn already finalized, ignoring state transition', { turnId, currentState: turn.state, attemptedState: newState });
      return;
    }
    const previousState = turn.state;
    turn.state = newState;
    turn.updatedAt = Date.now();
    logger.info('[VoiceLifecycle] State transition', { turnId, previousState, newState });
  }

  setUserTranscript(turnId: string, transcript: string): void {
    const turn = this.activeTurns.get(turnId);
    if (!turn) return;
    turn.userTranscript = transcript;
    this.transitionState(turnId, 'THINKING');
  }

  recordToolExecution(turnId: string, tool: string, action: string, data?: any): void {
    const turn = this.activeTurns.get(turnId);
    if (!turn) return;
    this.transitionState(turnId, 'ACTING');
    turn.toolCalls.push({ tool, action, data });
  }

  recordToolResult(turnId: string, tool: string, success: boolean, data?: any, error?: string): void {
    const turn = this.activeTurns.get(turnId);
    if (!turn) return;
    turn.toolResults.push({ tool, success, data, error });
  }

  /**
   * Finalization Gate:
   * Validates that the candidate text is NOT a thinking phrase.
   * Ensures exactly ONE final response is minted for this turn.
   */
  finalizeTurn(
    turnId: string,
    rawFinalText: string,
    finalAudioBase64?: string,
    finalAudioDuration?: number
  ): FinalTurnResponse | null {
    const turn = this.activeTurns.get(turnId);
    if (!turn) {
      logger.warn('[VoiceLifecycle] Cannot finalize unknown turn', { turnId });
      return null;
    }

    if (turn.finalized) {
      logger.warn('[VoiceLifecycle] Turn already finalized! Duplicate finalization blocked.', { turnId });
      return turn.finalResponse || null;
    }

    // Clean any leading thinking phrases from the text
    const cleanedText = stripThinkingPrefix(rawFinalText);

    // Guard: under NO circumstances may a thinking phrase be accepted as final text
    if (isInterimThinkingPhrase(cleanedText)) {
      logger.error('[VoiceLifecycle] Rejected thinking/status phrase at finalization gate', {
        turnId,
        rawText: rawFinalText.slice(0, 60),
        cleanedText: cleanedText.slice(0, 60),
      });
      return null;
    }

    turn.finalized = true;
    turn.state = 'COMPLETED';
    turn.updatedAt = Date.now();

    const finalResponse: FinalTurnResponse = {
      turnId,
      userId: turn.userId,
      conversationId: turn.conversationId,
      state: 'COMPLETED',
      finalText: cleanedText,
      finalAudioBase64,
      finalAudioDuration,
      finalizedAt: Date.now(),
    };

    turn.finalResponse = finalResponse;
    logger.info('[VoiceLifecycle] Turn successfully finalized (COMPLETED)', {
      turnId,
      textLength: cleanedText.length,
      hasAudio: !!finalAudioBase64,
      audioDuration: finalAudioDuration,
    });

    // Clean up cache after 60 seconds
    const timer = setTimeout(() => {
      this.activeTurns.delete(turnId);
    }, 60_000);
    if (typeof (timer as any).unref === 'function') (timer as any).unref();

    return finalResponse;
  }
}

export const voiceResponseLifecycle = VoiceResponseLifecycle.getInstance();
