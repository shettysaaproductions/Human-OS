/**
 * ConversationalEvaluator.ts — Independent Objective Dialogue Evaluator
 *
 * ARCHITECTURAL INVARIANTS:
 * 1. Independent Ground Truth: Evaluates raw observable evidence between user and Nova.
 *    Does NOT trust or require Nova's internal monitors, logs, or self-reporting.
 * 2. Deterministic Precision on Core Regression Patterns: Flags benchmark failures
 *    (e.g., location/transit amnesia, direct contradictions) with high deterministic confidence.
 * 3. Bounded LLM Escalation: For ambiguous multi-turn scenarios, requests capabilities
 *    via CognitiveModelRouter with strict confidence thresholds (>= 0.75). Inconclusive = no_issue.
 * 4. Forensic Hygiene: Output contains only structured engineering summaries; never stores
 *    hidden chain-of-thought traces.
 */

import {
  ObservableDialogueEvidence,
  EvaluationFinding,
  FlawType
} from './types';
import { cognitiveRouter, CapabilityUnavailableError } from '../../lib/cognitiveRouter';
import { logger } from '../../lib/logger';

export class EvaluationBlockedError extends Error {
  public readonly reason: string;
  public readonly cause?: any;

  constructor(message: string, reason: string = 'capability_unavailable', cause?: any) {
    super(message);
    this.name = 'EvaluationBlockedError';
    this.reason = reason;
    this.cause = cause;
  }
}

/**
 * Normalizes a fingerprint slug into a stable canonical form,
 * preventing minor LLM wording variations from fragmenting fingerprints.
 */
export function normalizeFingerprintSlug(input: string): string {
  if (!input) return 'unspecified';
  let slug = input.trim().toLowerCase();
  slug = slug.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

  // Strip common noisy stop-words
  const stopWords = new Set(['the', 'a', 'an', 'is', 'was', 'were', 'after', 'of', 'in', 'on', 'to', 'for', 'with', 'by']);
  const tokens = slug.split('_').filter(t => !stopWords.has(t) && t.length > 0);
  const joined = tokens.join('_');

  // Semantic domain clusters
  if (/transit|commute|metro|travel|heading_home/.test(joined) && /where|destination|location/.test(joined)) {
    return 'transit_destination_amnesia';
  }
  if (/work|office|job|employer/.test(joined) && /where|company|role/.test(joined)) {
    return 'workplace_amnesia';
  }
  if (/interrogat|questions|excessive_question/.test(joined)) {
    return 'multi_question_interrogation_loop';
  }
  if (/prompt|system_instruction|system_rule/.test(joined)) {
    return 'prompt_instruction_leak';
  }

  return joined || 'unspecified';
}

export class ConversationalEvaluator {
  private static readonly ACTIONABLE_CONFIDENCE_THRESHOLD = 0.75;
  public sessionGapHours: number = parseFloat(process.env.NOVA_LOOP_SESSION_GAP_HOURS || '4.0');

  constructor(sessionGapHours?: number) {
    if (typeof sessionGapHours === 'number' && !isNaN(sessionGapHours)) {
      this.sessionGapHours = sessionGapHours;
    }
  }

  /**
   * Determine elapsed time in hours between the current turn and the most recent preceding turn.
   */
  calculateSessionGapHours(evidence: ObservableDialogueEvidence): number {
    if (!evidence.surroundingContext || evidence.surroundingContext.length === 0) {
      return Infinity;
    }
    const currentTs = new Date(evidence.userMessageTimestamp || evidence.assistantResponseTimestamp).getTime();
    if (isNaN(currentTs)) return 0;

    // surroundingContext is ordered chronologically from oldest to newest
    const lastPriorTurn = evidence.surroundingContext[evidence.surroundingContext.length - 1];
    const priorTs = new Date(lastPriorTurn.created_at).getTime();
    if (isNaN(priorTs)) return 0;

    const diffMs = currentTs - priorTs;
    return Math.max(0, diffMs / (1000 * 60 * 60));
  }

  /**
   * Main evaluation entry point.
   * Evaluates an observable turn slice and returns any detected findings.
   */
  async evaluateTurn(evidence: ObservableDialogueEvidence): Promise<EvaluationFinding | null> {
    const sessionGapHours = this.calculateSessionGapHours(evidence);
    evidence.sessionGapHours = sessionGapHours;

    // 1. Fast, high-confidence deterministic evaluation (Immune to prompt flakiness)
    const deterministicFinding = this.evaluateDeterministicPatterns(evidence);
    if (deterministicFinding && deterministicFinding.confidence >= ConversationalEvaluator.ACTIONABLE_CONFIDENCE_THRESHOLD) {
      return {
        ...deterministicFinding,
        isDeterministic: true,
        sessionGapHours
      };
    }

    // 2. Multi-turn heuristic screening before invoking LLM capabilities
    if (!this.shouldInvokeLlmAudit(evidence, sessionGapHours)) {
      return null;
    }

    // 3. Capability-Negotiated Deep Audit
    try {
      const finding = await this.evaluateWithLlmCapability(evidence, sessionGapHours);
      if (finding) {
        finding.sessionGapHours = sessionGapHours;
        finding.isDeterministic = false;
      }
      return finding;
    } catch (err: any) {
      if (err instanceof CapabilityUnavailableError) {
        logger.warn('[ConversationalEvaluator] Required capability unavailable for deep audit; surfacing blocked evaluation', {
          capability: err.capability,
          requiredScore: err.requiredScore,
          error: err.message
        });
        throw new EvaluationBlockedError(
          `Evaluation blocked: required capability '${err.capability}' (score ${err.requiredScore}) is currently unavailable.`,
          'capability_unavailable',
          err
        );
      }
      logger.error('[ConversationalEvaluator] Evaluation error during LLM capability audit', { error: err?.message });
      throw new EvaluationBlockedError(
        `Evaluation failed due to provider/LLM error: ${err?.message}`,
        'provider_error',
        err
      );
    }
  }

  /**
   * Deterministic pattern matcher for benchmark failure modes.
   */
  private evaluateDeterministicPatterns(evidence: ObservableDialogueEvidence): EvaluationFinding | null {
    const userText = (evidence.userMessage || '').toLowerCase().trim();
    const assistantText = (evidence.assistantResponse || '').toLowerCase().trim();
    const currentTs = new Date(evidence.userMessageTimestamp || evidence.assistantResponseTimestamp).getTime();

    // Check recent context for established transit/location within the current session only
    const allPrecedingTurns = evidence.surroundingContext
      .filter(t => {
        if (t.role !== 'user') return false;
        const turnTs = new Date(t.created_at).getTime();
        if (isNaN(turnTs) || isNaN(currentTs)) return true;
        const gapHours = (currentTs - turnTs) / (1000 * 60 * 60);
        return gapHours < this.sessionGapHours;
      })
      .map(t => t.content.toLowerCase())
      .concat([userText]);


    const combinedRecentUserText = allPrecedingTurns.slice(-3).join(' · ');

    // ── PATTERN A: Location / Transit Context Amnesia ──────────────────────────
    // e.g. User: "I am right now going home by metro from office."
    //      Nova: "Where are you going?" / "Kahan ja rahe ho?"
    const hasGoingHomeOrTransit =
      /\b(going home|metro|train|bus|cab|uber|auto|driving home|on the way home|heading home|traveling|travel|commuting)\b/i.test(combinedRecentUserText) ||
      /\b(ghar ja raha|ghar ja rahi|metro me hoon|metro mein hoon|office se nikal|on the way)\b/i.test(combinedRecentUserText);

    const questionsDestinationOrLocation =
      /\b(where are you going|where you going|kahan ja rahe|kidhar ja rahe|kaha ja rahe|where are you headed|going where)\b/i.test(assistantText) ||
      /\b(where are you\?|kahan ho\?|kidhar ho\?)\b/i.test(assistantText);

    if (hasGoingHomeOrTransit && questionsDestinationOrLocation) {
      return {
        flawType: 'CONTEXT_AMNESIA',
        severity: 'high',
        confidence: 0.98,
        canonicalSubject: 'transit_destination_amnesia',
        failureSignature: 'questioned_destination_after_transit_explicitly_stated',
        evidenceReferences: {
          userMessageId: evidence.userMessageId,
          assistantMessageId: evidence.assistantMessageId,
          priorTurnIds: evidence.surroundingContext.map(c => c.id)
        },
        reasoningSummary: 'Nova questioned the user destination/location immediately after the user explicitly declared they are commuting/going home.',
        requiredCapability: 'SURFACE_AUDIT',
        recommendedAction: 'Verify ContextPacket recentMessages window hydration and prompt context preservation.'
      };
    }

    // ── PATTERN B: Repetitive Interrogation ─────────────────────────────────────
    // If Nova ends with 3 consecutive questions across conversational bubbles
    const questionMarks = (assistantText.match(/\?/g) || []).length;
    const isVeryShortUserTurn = userText.split(/\s+/).length <= 2;
    if (questionMarks >= 3 && isVeryShortUserTurn) {
      return {
        flawType: 'REPETITIVE_INTERROGATION',
        severity: 'medium',
        confidence: 0.88,
        canonicalSubject: 'multi_question_interrogation_loop',
        failureSignature: 'excessive_questions_on_terse_user_ack',
        evidenceReferences: {
          userMessageId: evidence.userMessageId,
          assistantMessageId: evidence.assistantMessageId,
          priorTurnIds: []
        },
        reasoningSummary: 'Nova ended reply with 3 or more questions despite brief user message, causing conversational fatigue.',
        requiredCapability: 'SURFACE_AUDIT',
        recommendedAction: 'Enforce companion conversation flow guidelines: one question maximum per turn.'
      };
    }

    // ── PATTERN C: Prompt Instruction Leak ─────────────────────────────────────
    const hasPromptLeak = /\b(system prompt|instruction|rule \d+|prompt constraints|ai companion rules|developer instruction)\b/i.test(assistantText);
    if (hasPromptLeak) {
      return {
        flawType: 'PROMPT_LEAK',
        severity: 'critical',
        confidence: 0.99,
        canonicalSubject: 'prompt_instruction_leak',
        failureSignature: 'raw_system_prompt_rules_exposed_to_user',
        evidenceReferences: {
          userMessageId: evidence.userMessageId,
          assistantMessageId: evidence.assistantMessageId,
          priorTurnIds: []
        },
        reasoningSummary: 'Nova leaked internal prompt instructions or rule citations directly into the user bubble.',
        requiredCapability: 'SURFACE_AUDIT',
        recommendedAction: 'Check output sanitization filter in NovaBrainService.'
      };
    }

    return null;
  }

  /**
   * Determine whether an LLM evaluation is warranted to conserve quota.
   */
  private shouldInvokeLlmAudit(evidence: ObservableDialogueEvidence, sessionGapHours: number): boolean {
    const userText = (evidence.userMessage || '').toLowerCase().trim();
    const assistantText = (evidence.assistantResponse || '').toLowerCase().trim();

    // Check for correction or identity markers in subsequent or current messages
    const hasCorrectionMarker = /\b(galat|wrong|nahi bola|already told|bhul gaye|maine bataya|kya bol rahe|confused|helucinate|hallucinate|nickname|mera naam|mera name|naam toh|maine bola|bola tha|bola na)\b/i.test(userText);
    const hasQuestionInAssistant = assistantText.includes('?');

    // If there is an extended session gap, casual greetings or proactive check-ins without correction markers should not invoke LLM audit
    const isProactiveOrCasual = /^(hi|hello|hey|all good|shubh raatri|good morning|ok|thik hai|mast|hlo|hii)[.!\s]*$/i.test(userText) || userText.length === 0;
    if (sessionGapHours >= this.sessionGapHours && isProactiveOrCasual && !hasCorrectionMarker) {
      // Natural session initiation: skip LLM audit unless Nova repeats 3+ questions (interrogation)
      const questionCount = (assistantText.match(/\?/g) || []).length;
      if (questionCount < 3) {
        return false;
      }
    }

    // Only audit turns that have dialogue complexity or potential friction
    return hasCorrectionMarker || (evidence.surroundingContext.length >= 2 && hasQuestionInAssistant);
  }

  /**
   * Execute an LLM-assisted capability evaluation.
   */
  private async evaluateWithLlmCapability(
    evidence: ObservableDialogueEvidence,
    sessionGapHours: number
  ): Promise<EvaluationFinding | null> {
    const contextLines = evidence.surroundingContext.map((t, idx) => {
      let prefix = '';
      if (idx > 0) {
        const prevTs = new Date(evidence.surroundingContext[idx - 1].created_at).getTime();
        const currTs = new Date(t.created_at).getTime();
        const diffHours = (currTs - prevTs) / (1000 * 60 * 60);
        if (diffHours >= this.sessionGapHours) {
          prefix = `\n--- [SESSION BREAK: ${diffHours.toFixed(1)}h inactivity gap] ---\n`;
        }
      }
      return `${prefix}[${t.role.toUpperCase()}] ${t.content}`;
    }).join('\n');

    let sessionBoundaryContext = '';
    if (sessionGapHours >= this.sessionGapHours && sessionGapHours !== Infinity) {
      sessionBoundaryContext = `\n--- [SESSION BOUNDARY: ${sessionGapHours.toFixed(1)}h elapsed since last interaction] ---\n`;
    }

    const prompt = `You are the Human-OS Offline Conversational Engineering Evaluator.
Analyze this raw user-assistant interaction for genuine conversational or contextual failures:

PAST CONTEXT:
${contextLines || '(None)'}
${sessionBoundaryContext}
CURRENT USER MESSAGE:
${evidence.userMessage || '(Proactive / Empty)'}

NOVA ASSISTANT RESPONSE:
${evidence.assistantResponse}

SESSION BOUNDARY RULES:
- If a session boundary (>= ${this.sessionGapHours} hours) occurred before the current turn:
  1. Previous goals are now DORMANT. Proactive check-ins, greetings, or Nova introducing a new conversational topic after a session gap are NATURAL and MUST NOT be flagged as GOAL_DERAILMENT.
  2. Ephemeral states (current location, transit mode, immediate activity) expire across session boundaries and are NOT CONTEXT_AMNESIA.
  3. Direct contradictions of permanent user facts (e.g., user name, established family kin, fixed calendar dates) or explicit amnesia ("I forgot what you told me") REMAIN ACTIONABLE DEFECTS.

EVALUATION CRITERIA:
1. CONTEXT_AMNESIA: Nova asks for or forgets information explicitly established in recent conversation.
2. SEMANTIC_CONTRADICTION: Nova makes a claim that directly contradicts known facts from the dialogue.
3. GOAL_DERAILMENT: Nova ignores or changes the subject away from a serious active user question or goal in the current session.
4. TEMPORAL_ERROR: Nova claims an impossible time, date, or day-of-week sequence.

CANONICAL TOPIC EXAMPLES (use snake_case, pick the closest canonical topic):
- "transit_destination_amnesia"
- "workplace_amnesia"
- "family_relationship_amnesia"
- "goal_commitment_amnesia"
- "schedule_temporal_contradiction"
- "direct_factual_contradiction"
- "multi_question_interrogation_loop"
- "prompt_instruction_leak"

Do NOT flag acceptable casual Hinglish banter, empathy, or natural clarifications.
If the interaction is healthy or inconclusive, return has_flaw: false.

Return JSON ONLY:
{
  "has_flaw": boolean,
  "flaw_type": "CONTEXT_AMNESIA" | "SEMANTIC_CONTRADICTION" | "GOAL_DERAILMENT" | "TEMPORAL_ERROR" | "OTHER",
  "severity": "low" | "medium" | "high" | "critical",
  "confidence": number, // 0.0 to 1.0
  "canonical_subject": "snake_case_topic",
  "failure_signature": "short_signature_of_defect",
  "reasoning_summary": "1-2 sentence engineering diagnosis",
  "recommended_action": "recommended pipeline or prompt action"
}`;

    // Request DEEP_SEMANTIC_REASONING (Score 2) for dialogue audit
    const rawResult = await cognitiveRouter.completeWithCapability(
      {
        capability: 'DEEP_SEMANTIC_REASONING',
        minReasoningScore: 2,
        jsonMode: true,
        temperature: 0.1,
        timeoutMs: 25_000
      },
      [{ role: 'user', content: prompt }]
    );

    const match = rawResult.match(/\{[\s\S]*\}/);
    if (!match) {
      throw new Error(`LLM output did not contain valid JSON object: ${rawResult.slice(0, 100)}`);
    }

    const parsed = JSON.parse(match[0]);
    if (!parsed.has_flaw || typeof parsed.confidence !== 'number') {
      return null;
    }

    // Post-evaluator session gap validation:
    // Suppress false GOAL_DERAILMENT when user started a new session with greeting or no active question
    if (sessionGapHours >= this.sessionGapHours && parsed.flaw_type === 'GOAL_DERAILMENT') {
      const userMsg = (evidence.userMessage || '').trim().toLowerCase();
      const hasActiveQuestion = userMsg.includes('?');
      const isShortGreeting = /^(hi|hello|hey|all good|shubh raatri|good morning|ok|thik hai|mast|hlo|hii)[.!\s]*$/i.test(userMsg);
      const isProactiveStart = !evidence.userMessage || isShortGreeting;

      if (isProactiveStart && !hasActiveQuestion) {
        logger.debug('[ConversationalEvaluator] Suppressing false GOAL_DERAILMENT across session gap', {
          sessionGapHours,
          userMessage: evidence.userMessage
        });
        return null;
      }
    }

    if (parsed.confidence < ConversationalEvaluator.ACTIONABLE_CONFIDENCE_THRESHOLD) {
      logger.debug('[ConversationalEvaluator] Inconclusive finding discarded below confidence threshold', {
        confidence: parsed.confidence,
        flawType: parsed.flaw_type
      });
      return null;
    }

    const canonicalSubject = normalizeFingerprintSlug(parsed.canonical_subject || 'unknown_subject');
    const failureSignature = normalizeFingerprintSlug(parsed.failure_signature || 'unspecified_failure');

    return {
      flawType: (parsed.flaw_type as FlawType) || 'OTHER',
      severity: parsed.severity || 'medium',
      confidence: parsed.confidence,
      canonicalSubject,
      failureSignature,
      evidenceReferences: {
        userMessageId: evidence.userMessageId,
        assistantMessageId: evidence.assistantMessageId,
        priorTurnIds: evidence.surroundingContext.map(t => t.id)
      },
      reasoningSummary: parsed.reasoning_summary || 'Dialogue consistency failure detected by capability audit.',
      requiredCapability: 'DEEP_SEMANTIC_REASONING',
      recommendedAction: parsed.recommended_action || 'Inspect conversational pipeline grounding.'
    };
  }

}

export const conversationalEvaluator = new ConversationalEvaluator();
