/**
 * ProactiveFactGroundingGate — Deterministic Proactive Claim Enforcement (P0)
 *
 * INVARIANT: Every proactive factual assertion must be traceable to authoritative
 * context (explicit user state, canonical memory, deterministic state).
 *
 * This gate runs AFTER the LLM generates a proactive message and BEFORE dispatch.
 * It is purely deterministic — zero LLM calls — so it cannot be hallucinated away.
 *
 * Decision flow:
 *   RAW LLM OUTPUT
 *        ↓
 *   ProactiveFactGroundingGate.validate(message, authCtx)
 *        ↓
 *   SUPPORTED? ── YES → allowed → dispatch
 *        │
 *        NO
 *        ↓
 *   QUESTION possible? ── YES → transformedMessage (question) → dispatch
 *        │
 *        NO
 *        ↓
 *   BLOCK → message = '' → caller silences or skips
 *
 * Claim classification:
 *   EXPLICIT_USER       — fact directly stated by user in authoritative context
 *   CONFIRMED_MEMORY    — fact present in canonical memories or working memory
 *   DETERMINISTIC_STATE — fact present in agenda / reminder / calendar state
 *   SUPPORTED_INFERENCE — inferable, but must be expressed as a question
 *   UNKNOWN             — no evidence → must NOT assert
 */

import { logger } from '../lib/logger';

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

export type ClaimClass =
  | 'EXPLICIT_USER'
  | 'CONFIRMED_MEMORY'
  | 'DETERMINISTIC_STATE'
  | 'SUPPORTED_INFERENCE'
  | 'UNKNOWN';

export interface ProactiveAuthoritativeContext {
  /** Canonical persisted memories (key/value pairs). */
  memories: Array<{ key: string; value: string; [key: string]: any }>;
  /** Working memory entries (transient, session-scoped facts). */
  workingMemories: Array<{ key: string; value: string; [key: string]: any }>;
  /** Active life threads that Nova knows about. */
  lifeThreads: Array<{ topic: string; provenance?: string; [key: string]: any }>;
  /** Recent conversation snippet used to build tier2 context. */
  conversationSnippet: string;
  /** Active agenda item (deterministic state). */
  agendaItem: any | null;
  /**
   * Facts that the user has explicitly negated in recent turns.
   * Populated from a correction negation cache in working_memory.
   * E.g. ["event", "dinner"] after "Kal koi event nai hai".
   */
  negatedClaims?: string[];
}

export interface GroundingGateResult {
  /** Whether the message is allowed through (possibly with transformation). */
  allowed: boolean;
  /**
   * The message to use.
   * - If allowed=true and no transformation: same as input.
   * - If allowed=true after transformation: the question form.
   * - If allowed=false: null (caller should silence/skip).
   */
  transformedMessage: string | null;
  /** Classification of the primary claim found. */
  claimClass: ClaimClass;
  /** Human-readable reason for logging. */
  reason: string;
  /** List of claim snippets that were blocked. */
  claimsBlocked: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal patterns
//
// DESIGN PRINCIPLE: These patterns detect the STRUCTURE of a factual assertion
// (subject + action + object), not the semantic meaning. They identify candidate
// claims for context-lookup validation — they are NOT a regex-based semantic
// interpreter. The primary resolution is always the authoritative context lookup.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Patterns that indicate an assertion about the user's own upcoming/past events,
 * appointments, meetings, or plans.
 *
 * These are dangerous because they can be fabricated with zero evidence.
 */
const USER_EVENT_ASSERTION_PATTERNS: RegExp[] = [
  // "kal ka event", "kal mein event hai", "kal koi event hai"
  /\bkal\b.{0,25}\b(event|meeting|kaam|appointment|interview|exam|function|program)\b/i,
  // "parso meeting hai", "parso ... tha"
  /\bparso\b.{0,25}\b(event|meeting|hai|tha|hoga)\b/i,
  // "kal tera dinner hai", "tumhara plan hai kal"
  /\b(tera|tumhara|apna|mera)\b.{0,30}\b(dinner|party|trip|travel|plan|outing)\b.{0,20}\b(hai|tha|hoga|tha na|hai na)\b/i,
  // "kal (tum|tu|aap) ... jaoge/jayenge"
  /\bkal\b.{0,20}\b(tum|tu|aap)\b.{0,25}\b(ja|jayenge|jaoge|niklo|nikloge)\b/i,
];

/**
 * Patterns that indicate assertions about third-party actions (people doing things).
 * These are the most dangerous category — Nova inventing friends/family actions.
 *
 * Canonical example that triggered the bug:
 *   "mere dost ne mujhe dinner ka invite diya hai"
 */
const THIRD_PARTY_ACTION_PATTERNS: RegExp[] = [
  // "(dost|yaar|bhai|mama|papa) ne ... kiya/diya/bola/bheja/invite"
  /\b(dost|yaar|bhai|bhaiya|mama|papa|baba|chacha|nana|nani|wife|husband|girlfriend|boyfriend|friend|colleague|boss)\b.{0,30}\bne\b.{0,40}\b(kiya|diya|bola|bheja|invite|call|message|text|bataya|milne)\b/i,
  // "mere dost ne"
  /\bmere?\b.{0,10}\b(dost|yaar|bhai|friend|colleague)\b.{0,30}\bne\b/i,
  // "uski/uske ... ki taraf se ... kiya/bola"
  /\b(usk[io]|unka|unke)\b.{0,20}\b(ne|ki taraf|se)\b.{0,30}\b(bola|kiya|diya|bheja)\b/i,
];

// ─────────────────────────────────────────────────────────────────────────────
// ProactiveFactGroundingGate
// ─────────────────────────────────────────────────────────────────────────────

export class ProactiveFactGroundingGate {

  /**
   * Validate a proactive LLM-generated message against authoritative context.
   *
   * This is the primary entry point. Always synchronous (no I/O).
   */
  validate(
    message: string,
    ctx: ProactiveAuthoritativeContext,
  ): GroundingGateResult {
    if (!message || !message.trim()) {
      return {
        allowed: false,
        transformedMessage: null,
        claimClass: 'UNKNOWN',
        reason: 'Empty message',
        claimsBlocked: [],
      };
    }

    const trimmed = message.trim();

    // ── Step 1: Detect unsupported life-fact assertions ──────────────────────
    const blockedClaims: string[] = [];

    // 1a. Third-party action assertions (highest risk)
    const thirdPartyBlocked = this._detectThirdPartyActionAssertions(trimmed, ctx);
    blockedClaims.push(...thirdPartyBlocked);

    // 1b. User event/appointment assertions ("kal ka event")
    const eventBlocked = this._detectUserEventAssertions(trimmed, ctx);
    blockedClaims.push(...eventBlocked);

    // 1c. Negated claims — if user explicitly denied a topic, block same topic
    const negationBlocked = this._detectNegatedClaims(trimmed, ctx);
    blockedClaims.push(...negationBlocked);

    if (blockedClaims.length === 0) {
      // No unsupported claims detected — allow
      return {
        allowed: true,
        transformedMessage: trimmed,
        claimClass: this._classifyGrounded(trimmed, ctx),
        reason: 'No unsupported life-fact assertions detected',
        claimsBlocked: [],
      };
    }

    // ── Step 2: Try to convert blocked assertion to a question ───────────────
    const questionForm = this._tryConvertToQuestion(trimmed, blockedClaims, ctx);
    if (questionForm) {
      logger.info('[ProactiveFactGroundingGate] Converted unsupported assertion to question', {
        original: trimmed.substring(0, 80),
        transformed: questionForm.substring(0, 80),
        claimsBlocked: blockedClaims,
      });
      return {
        allowed: true,
        transformedMessage: questionForm,
        claimClass: 'SUPPORTED_INFERENCE',
        reason: `Unsupported assertion converted to question: ${blockedClaims.join('; ')}`,
        claimsBlocked: blockedClaims,
      };
    }

    // ── Step 3: Block — no safe transformation available ─────────────────────
    logger.warn('[ProactiveFactGroundingGate] BLOCKED unsupported proactive claim', {
      messagePreview: trimmed.substring(0, 100),
      claimsBlocked: blockedClaims,
    });
    return {
      allowed: false,
      transformedMessage: null,
      claimClass: 'UNKNOWN',
      reason: `Unsupported life-fact assertions blocked: ${blockedClaims.join('; ')}`,
      claimsBlocked: blockedClaims,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Private helpers
  // ─────────────────────────────────────────────────────────────────────────



  /**
   * Detect assertions about third-party actions (friends/family doing things)
   * that are not supported by authoritative context.
   */
  private _detectThirdPartyActionAssertions(
    message: string,
    ctx: ProactiveAuthoritativeContext,
  ): string[] {
    const blocked: string[] = [];
    for (const pattern of THIRD_PARTY_ACTION_PATTERNS) {
      const match = message.match(pattern);
      if (!match) continue;
      const claim = match[0];
      if (!this._isClaimSupportedByContext(claim, ctx)) {
        blocked.push(claim);
      }
    }
    return blocked;
  }

  /**
   * Detect assertions about the user's upcoming or past events/appointments
   * that are not supported by authoritative context.
   */
  private _detectUserEventAssertions(
    message: string,
    ctx: ProactiveAuthoritativeContext,
  ): string[] {
    const blocked: string[] = [];
    for (const pattern of USER_EVENT_ASSERTION_PATTERNS) {
      const match = message.match(pattern);
      if (!match) continue;
      const claim = match[0];
      if (!this._isClaimSupportedByContext(claim, ctx)) {
        blocked.push(claim);
      }
    }
    return blocked;
  }

  /**
   * Detect if the message makes a claim about a topic the user has explicitly negated.
   * Uses the negatedClaims list from working_memory correction cache.
   */
  private _detectNegatedClaims(
    message: string,
    ctx: ProactiveAuthoritativeContext,
  ): string[] {
    if (!ctx.negatedClaims || ctx.negatedClaims.length === 0) return [];
    const blocked: string[] = [];
    const msgLower = message.toLowerCase();
    for (const negatedTopic of ctx.negatedClaims) {
      if (negatedTopic && msgLower.includes(negatedTopic.toLowerCase())) {
        blocked.push(`negated_claim:${negatedTopic}`);
      }
    }
    return blocked;
  }

  /**
   * Lexical check: is the given claim snippet grounded in authoritative context?
   *
   * We extract key content words from the claim and check whether they appear
   * in memories, working memory, life threads, conversation snippet, or agenda.
   * This is NOT a semantic interpreter — it is a lexical presence check.
   */
  isClaimSupportedByContext(claim: string, ctx: ProactiveAuthoritativeContext): boolean {
    return this._isClaimSupportedByContext(claim, ctx);
  }

  private _isClaimSupportedByContext(claim: string, ctx: ProactiveAuthoritativeContext): boolean {
    // Build a single authoritative context string to search
    const authoritativeStrings: string[] = [];

    for (const m of ctx.memories) {
      authoritativeStrings.push(`${m.key} ${m.value}`);
    }
    for (const wm of ctx.workingMemories) {
      authoritativeStrings.push(`${wm.key} ${wm.value}`);
    }
    for (const lt of ctx.lifeThreads) {
      authoritativeStrings.push(`${lt.topic} ${lt.provenance || ''}`);
    }
    authoritativeStrings.push(ctx.conversationSnippet || '');
    if (ctx.agendaItem) {
      authoritativeStrings.push(
        `${ctx.agendaItem.event_description || ''} ${ctx.agendaItem.follow_up_question || ''}`
      );
    }

    const fullContext = authoritativeStrings.join(' ').toLowerCase();

    // Extract meaningful content words (skip stop words)
    const stopWords = new Set([
      'ne', 'ko', 'ka', 'ki', 'ke', 'se', 'mein', 'hai', 'tha', 'the', 'hoga',
      'bhi', 'aur', 'ya', 'na', 'nahi', 'nai', 'koi', 'kuch', 'ab', 'to',
      'mere', 'mera', 'meri', 'tera', 'teri', 'tumhara', 'tumhari', 'apna',
      'a', 'an', 'is', 'was', 'are', 'were', 'of', 'in', 'at', 'on', 'and',
      'dost', 'yaar', // relationship words alone don't count as evidence
      'kal', 'aaj', 'parso', 'tomorrow', 'today', 'yesterday' // temporal markers
    ]);

    const claimWords = claim.toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2 && !stopWords.has(w));

    if (claimWords.length === 0) return true; // No content words to assert

    const supportedWords = claimWords.filter(w => fullContext.includes(w));
    const supportRatio = supportedWords.length / claimWords.length;

    // Require 60%+ word overlap for a claim to be considered grounded.
    return supportRatio >= 0.6;
  }

  /**
   * Attempt to convert a blocked assertion into a safe question form.
   *
   * Third-party action assertions CANNOT be converted safely — any rephrasing
   * would still imply the invented action. Those are dropped entirely.
   */
  private _tryConvertToQuestion(
    _message: string,
    blockedClaims: string[],
    _ctx: ProactiveAuthoritativeContext,
  ): string | null {
    // Third-party action claims cannot be safely rephrased
    const hasThirdPartyBlock = blockedClaims.some(c =>
      THIRD_PARTY_ACTION_PATTERNS.some(p => p.test(c))
    );
    if (hasThirdPartyBlock) return null;

    // Negated topics must not be re-raised even as questions
    const hasNegationBlock = blockedClaims.some(c => c.startsWith('negated_claim:'));
    if (hasNegationBlock) return null;

    // User event assertions → convert to a neutral open question about plans
    const hasEventBlock = blockedClaims.some(c =>
      USER_EVENT_ASSERTION_PATTERNS.some(p => p.test(c))
    );
    if (hasEventBlock) {
      const claimLower = blockedClaims[0]?.toLowerCase() || '';
      if (claimLower.includes('kal') || claimLower.includes('tomorrow')) {
        return 'Kal kuch plan hai kya?';
      }
      if (claimLower.includes('parso') || claimLower.includes('aaj')) {
        return 'Aaj kuch plan hai kya?';
      }
      return 'Kuch plan hai aaj kal?';
    }

    return null;
  }

  /** Classify a grounded message for telemetry. */
  private _classifyGrounded(
    _message: string,
    ctx: ProactiveAuthoritativeContext,
  ): ClaimClass {
    if (ctx.agendaItem) return 'DETERMINISTIC_STATE';
    if (ctx.memories.length > 0 || ctx.workingMemories.length > 0) return 'CONFIRMED_MEMORY';
    return 'SUPPORTED_INFERENCE';
  }
}

export const proactiveFactGroundingGate = new ProactiveFactGroundingGate();
