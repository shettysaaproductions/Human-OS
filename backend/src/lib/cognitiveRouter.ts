/**
 * CognitiveModelRouter — Provider-Agnostic LLM Dispatch (Phase 10.1)
 *
 * Maps workload types to providers (Gemini | NVIDIA) based on configuration.
 * This is the single point of provider selection for all of Nova's LLM calls.
 *
 * Architecture:
 *
 *   Workload
 *     ↓
 *   CognitiveModelRouter.complete() / .stream()
 *     ↓
 *   [Gemini primary → Gemini fallback → NVIDIA fallback]
 *   [NVIDIA primary → NVIDIA failover (existing BrainKeyRouter)]
 *
 * The router does NOT know about application state, memory architecture,
 * ProactiveGate, or business logic. It only dispatches LLM requests.
 *
 * Observability: all completions emit a structured log with workload,
 * provider, model, latency, and success/fallback status.
 */

import { logger } from './logger';
import { config } from '../config';
import {
  complete as nvidiaComplete,
  stream as nvidiaStream,
  RoutingProfile,
} from './nvidia';
import {
  geminiComplete,
  geminiStream,
  getGeminiStatus,
} from './gemini';

// ── Workload Types ────────────────────────────────────────────────────────────

export type CognitiveWorkload =
  | 'CONVERSATION'
  | 'PROACTIVE_REASONING'
  | 'PROACTIVE_GENERATION'
  | 'MEMORY_EXTRACTION'
  | 'LIFE_THREAD_EXTRACTION'
  | 'ACTION_INTELLIGENCE'
  | 'BACKGROUND_COGNITION'
  | 'VISION'
  | 'TURN_ANALYSIS';

export type CognitiveProvider = 'gemini' | 'nvidia';

// Map workloads to NVIDIA RoutingProfile equivalents for backward compatibility
const WORKLOAD_TO_NVIDIA_PROFILE: Record<CognitiveWorkload, RoutingProfile> = {
  CONVERSATION:           'USER_FAST',
  PROACTIVE_REASONING:    'PROACTIVE',
  PROACTIVE_GENERATION:   'PROACTIVE',
  MEMORY_EXTRACTION:      'MEMORY',
  LIFE_THREAD_EXTRACTION: 'MEMORY',
  ACTION_INTELLIGENCE:    'SUBCONSCIOUS',
  BACKGROUND_COGNITION:   'PROACTIVE',
  VISION:                 'USER_FAST',
  TURN_ANALYSIS:          'MEMORY',
};

// ── Message Format ────────────────────────────────────────────────────────────

export type RouterMessage = { role: 'system' | 'user' | 'assistant'; content: string };

export interface RouterOptions {
  maxTokens?: number;
  temperature?: number;
  jsonMode?: boolean;
  timeoutMs?: number;
}

// ── Routing Decision ──────────────────────────────────────────────────────────

interface RoutingResult {
  workload: CognitiveWorkload;
  provider: CognitiveProvider;
  model: string;
  latencyMs: number;
  success: boolean;
  fallbackUsed: boolean;
  fallbackProvider?: CognitiveProvider;
  errorCategory?: string;
}

// ── Provider Selection ────────────────────────────────────────────────────────

function resolveProvider(workload: CognitiveWorkload): CognitiveProvider {
  const routingMap: Record<string, string> = {
    CONVERSATION:           config.routing.conversation,
    PROACTIVE_REASONING:    config.routing.proactiveReasoning,
    PROACTIVE_GENERATION:   config.routing.proactiveGeneration,
    MEMORY_EXTRACTION:      config.routing.memoryExtraction,
    LIFE_THREAD_EXTRACTION: config.routing.lifeThreads,
    ACTION_INTELLIGENCE:    config.routing.actionIntelligence,
    BACKGROUND_COGNITION:   config.routing.backgroundCognition,
    VISION:                 config.routing.vision,
    TURN_ANALYSIS:          config.routing.turnAnalysis,
  };

  const configured = routingMap[workload]?.toLowerCase();
  return (configured === 'gemini' || configured === 'nvidia') ? configured : 'nvidia';
}

function classifyError(err: any): string {
  const msg = (err?.message || '').toLowerCase();
  const status = err?.status ?? err?.httpErrorCode ?? 0;
  if (status === 429 || msg.includes('rate') || msg.includes('quota') || msg.includes('resource_exhausted')) return 'rate_limit';
  if (status === 503 || msg.includes('overload') || msg.includes('unavailable')) return 'overload';
  if (err?.name === 'GeminiTimeoutError' || err?.name === 'NvidiaTimeoutError') return 'timeout';
  if (status === 400 || status === 422) return 'bad_request';
  return 'unknown';
}

// ── Core Router ───────────────────────────────────────────────────────────────

class CognitiveModelRouter {

  /**
   * Route a completion request to the appropriate provider based on workload.
   * Falls back: primary provider → secondary key → NVIDIA (if Gemini primary).
   */
  async complete(
    workload: CognitiveWorkload,
    messages: RouterMessage[],
    options: RouterOptions = {},
  ): Promise<string> {
    const startMs = Date.now();
    const primaryProvider = resolveProvider(workload);
    const nvidiaProfile = WORKLOAD_TO_NVIDIA_PROFILE[workload];

    let result: RoutingResult = {
      workload,
      provider: primaryProvider,
      model: primaryProvider === 'gemini' ? config.gemini.chatModel : 'nvidia/' + nvidiaProfile,
      latencyMs: 0,
      success: false,
      fallbackUsed: false,
    };

    // ── Single Overall Deadline Policy ───────────────────────────────────────
    const overallTimeoutMs = options.timeoutMs ?? (
      workload === 'CONVERSATION' ? config.gemini.conversationTimeoutMs : 30_000
    );
    const deadlineTimestamp = startMs + overallTimeoutMs;

    // ── Primary Provider ──────────────────────────────────────────────────────
    try {
      let text: string;
      if (primaryProvider === 'gemini') {
        // Reserve at least 3500ms for NVIDIA fallback if Gemini times out or stalls
        const elapsedSoFar = Date.now() - startMs;
        const totalRemainingBudget = overallTimeoutMs - elapsedSoFar;

        // If interactive conversation, bound Gemini to at most ~3000ms (or totalBudget - 3500ms),
        // guaranteeing that NVIDIA has sufficient remaining budget before the 8000ms deadline.
        const geminiMaxTimeout = workload === 'CONVERSATION'
          ? Math.max(1200, Math.min(3000, totalRemainingBudget - 3500))
          : totalRemainingBudget;

        const geminiDeadline = Date.now() + geminiMaxTimeout;

        const geminiOpts = {
          maxTokens: options.maxTokens,
          temperature: options.temperature,
          jsonMode: options.jsonMode,
          timeoutMs: geminiMaxTimeout,
          deadlineMs: geminiDeadline,
        };
        text = options.jsonMode
          ? await geminiComplete(messages, { ...geminiOpts, jsonMode: true })
          : await geminiComplete(messages, geminiOpts);
      } else {
        const nvidiaOpts = {
          maxTokens: options.maxTokens,
          temperature: options.temperature,
          ...(options.jsonMode ? { response_format: { type: 'json_object' as const } } : {}),
        };
        text = await nvidiaComplete(nvidiaProfile, messages, nvidiaOpts);
      }

      result.latencyMs = Date.now() - startMs;
      result.success = true;
      this.logResult(result);
      return text;

    } catch (primaryErr: any) {
      result.errorCategory = classifyError(primaryErr);
      result.latencyMs = Date.now() - startMs;

      // ── Fallback ────────────────────────────────────────────────────────────
      // Gemini → NVIDIA fallback (for conversational workloads)
      // NVIDIA → no fallback (already has its own internal BrainKeyRouter failover)
      if (primaryProvider === 'gemini') {
        logger.warn(`[CognitiveRouter] Gemini failed for ${workload} (${result.errorCategory}), falling back to NVIDIA`, {
          error: primaryErr.message,
          elapsedMs: result.latencyMs,
          remainingDeadlineMs: Math.max(0, deadlineTimestamp - Date.now()),
        });

        try {
          const nvidiaOpts = {
            maxTokens: options.maxTokens,
            temperature: options.temperature,
            ...(options.jsonMode ? { response_format: { type: 'json_object' as const } } : {}),
          };
          const text = await nvidiaComplete(nvidiaProfile, messages, nvidiaOpts);

          result.fallbackUsed = true;
          result.fallbackProvider = 'nvidia';
          result.latencyMs = Date.now() - startMs;
          result.success = true;
          this.logResult(result);
          return text;
        } catch (fallbackErr: any) {
          result.latencyMs = Date.now() - startMs;
          logger.error(`[CognitiveRouter] Both Gemini and NVIDIA failed for ${workload}`, {
            geminiError: primaryErr.message,
            nvidiaError: fallbackErr.message,
          });
          this.logResult(result);
          throw fallbackErr; // Surface NVIDIA error (more informative)
        }
      }

      // NVIDIA primary — re-throw (BrainKeyRouter has already exhausted all keys)
      this.logResult(result);
      throw primaryErr;
    }
  }

  /**
   * Route a streaming completion to the appropriate provider.
   * Falls back to NVIDIA for Gemini failures.
   */
  async *stream(
    workload: CognitiveWorkload,
    messages: RouterMessage[],
    options: RouterOptions = {},
  ): AsyncGenerator<string, void, unknown> {
    const startMs = Date.now();
    const primaryProvider = resolveProvider(workload);
    const nvidiaProfile = WORKLOAD_TO_NVIDIA_PROFILE[workload];

    if (primaryProvider === 'gemini') {
      const timeoutMs = options.timeoutMs ?? (
        workload === 'CONVERSATION' ? config.gemini.conversationTimeoutMs : 30_000
      );
      const geminiOpts = {
        maxTokens: options.maxTokens,
        temperature: options.temperature,
        timeoutMs,
      };
      let geminiOk = false;
      let streamStarted = false;

      try {
        for await (const chunk of geminiStream(messages, geminiOpts)) {
          streamStarted = true;
          geminiOk = true;
          yield chunk;
        }
        if (!streamStarted) throw new Error('[CognitiveRouter] Gemini stream returned no chunks');
        logger.info('[CognitiveRouter] Gemini stream completed', {
          workload, latencyMs: Date.now() - startMs, provider: 'gemini'
        });
        return;
      } catch (geminiErr: any) {
        if (geminiOk) throw geminiErr; // Already yielded — can't fall back mid-stream
        logger.warn(`[CognitiveRouter] Gemini stream failed for ${workload}, falling back to NVIDIA`, {
          error: geminiErr.message,
        });
        // Fall through to NVIDIA stream
      }
    }

    // NVIDIA stream (primary or fallback)
    const nvidiaOpts = { maxTokens: options.maxTokens, temperature: options.temperature };
    for await (const chunk of nvidiaStream(nvidiaProfile, messages, nvidiaOpts)) {
      yield chunk;
    }
    logger.info('[CognitiveRouter] NVIDIA stream completed', {
      workload, latencyMs: Date.now() - startMs, provider: 'nvidia'
    });
  }

  // ── Observability ─────────────────────────────────────────────────────────

  private logResult(result: RoutingResult): void {
    const level = result.success ? 'info' : 'warn';
    logger[level]('[CognitiveRouter] Completion result', {
      workload: result.workload,
      provider: result.provider,
      latencyMs: result.latencyMs,
      success: result.success,
      fallbackUsed: result.fallbackUsed,
      fallbackProvider: result.fallbackProvider,
      errorCategory: result.errorCategory,
    });
  }

  /**
   * Health status for /health/cognitive — no keys exposed.
   */
  getStatus() {
    return {
      gemini: getGeminiStatus(),
      routing: {
        conversation:       resolveProvider('CONVERSATION'),
        proactiveReasoning: resolveProvider('PROACTIVE_REASONING'),
        proactiveGeneration:resolveProvider('PROACTIVE_GENERATION'),
        memoryExtraction:   resolveProvider('MEMORY_EXTRACTION'),
        lifeThreads:        resolveProvider('LIFE_THREAD_EXTRACTION'),
        actionIntelligence: resolveProvider('ACTION_INTELLIGENCE'),
        backgroundCognition:resolveProvider('BACKGROUND_COGNITION'),
        vision:             resolveProvider('VISION'),
        turnAnalysis:       resolveProvider('TURN_ANALYSIS'),
      },
    };
  }
}

export const cognitiveRouter = new CognitiveModelRouter();
