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
  canRunNvidia,
} from './nvidia';
import {
  geminiComplete,
  geminiStream,
  getGeminiStatus,
  isGeminiAvailable,
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

// ── Nova Loop Capability Negotiation ──────────────────────────────────────────

export type NovaLoopCapability =
  | 'SURFACE_AUDIT'
  | 'DEEP_SEMANTIC_REASONING'
  | 'ROOT_CAUSE_DIAGNOSIS';

export interface CapabilityRequirement {
  capability: NovaLoopCapability;
  minReasoningScore: number; // 1 = Surface/11B, 2 = Deep/Flash, 3 = Expert/Pro
  timeoutMs?: number;
  jsonMode?: boolean;
  temperature?: number;
  maxTokens?: number;
}

export class CapabilityUnavailableError extends Error {
  readonly capability: NovaLoopCapability;
  readonly requiredScore: number;
  readonly availableScore: number;

  constructor(capability: NovaLoopCapability, requiredScore: number, availableScore: number, message: string) {
    super(message);
    this.name = 'CapabilityUnavailableError';
    this.capability = capability;
    this.requiredScore = requiredScore;
    this.availableScore = availableScore;
  }
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

        // If interactive conversation (default 12s budget), bound Gemini to up to 8500ms,
        // guaranteeing that NVIDIA has sufficient remaining budget before deadline.
        const geminiMaxTimeout = workload === 'CONVERSATION'
          ? Math.max(3000, Math.min(8500, totalRemainingBudget - 3500))
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
            timeoutMs: workload === 'CONVERSATION' ? 6000 : undefined,
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

      // NVIDIA primary — fallback to Gemini if keys are available
      if (primaryProvider === 'nvidia') {
        const geminiStatus = getGeminiStatus();
        if (geminiStatus.keyCount > 0) {
          logger.warn(`[CognitiveRouter] NVIDIA primary failed for ${workload} (${result.errorCategory}), falling back to Gemini pool (${geminiStatus.keyCount} keys)`, {
            error: primaryErr.message,
            elapsedMs: result.latencyMs,
          });

          try {
            const geminiOpts = {
              maxTokens: options.maxTokens,
              temperature: options.temperature,
              jsonMode: options.jsonMode,
              timeoutMs: 10000,
            };
            const text = options.jsonMode
              ? await geminiComplete(messages, { ...geminiOpts, jsonMode: true })
              : await geminiComplete(messages, geminiOpts);

            result.fallbackUsed = true;
            result.fallbackProvider = 'gemini';
            result.latencyMs = Date.now() - startMs;
            result.success = true;
            this.logResult(result);
            return text;
          } catch (geminiFallbackErr: any) {
            result.latencyMs = Date.now() - startMs;
            logger.error(`[CognitiveRouter] Both NVIDIA and Gemini fallback failed for ${workload}`, {
              nvidiaError: primaryErr.message,
              geminiError: geminiFallbackErr.message,
            });
            this.logResult(result);
            throw geminiFallbackErr;
          }
        }
      }

      // NVIDIA primary — re-throw (BrainKeyRouter has already exhausted all keys)
      this.logResult(result);
      throw primaryErr;
    }
  }

  /**
   * Route a streaming completion to the appropriate provider.
   * Falls back to NVIDIA for Gemini failures, and to Gemini for NVIDIA failures.
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
      // Interactive CONVERSATION streams enforce a strict 2.8s Gemini budget.
      // If Gemini cannot yield within 2.8s across keys, fail fast to NVIDIA's 15-key pool
      // so the mobile client (30s timeout) never aborts or shows connection lag.
      const geminiTimeoutMs = options.timeoutMs ?? (
        workload === 'CONVERSATION' ? Math.min(2800, config.gemini.conversationTimeoutMs) : 30_000
      );
      const geminiDeadline = Date.now() + geminiTimeoutMs;
      const geminiOpts = {
        maxTokens: options.maxTokens,
        temperature: options.temperature,
        timeoutMs: geminiTimeoutMs,
        deadlineMs: geminiDeadline,
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
    const nvidiaOpts = {
      maxTokens: options.maxTokens,
      temperature: options.temperature,
      timeoutMs: workload === 'CONVERSATION' ? 6000 : undefined,
    };
    let nvidiaOk = false;
    try {
      for await (const chunk of nvidiaStream(nvidiaProfile, messages, nvidiaOpts)) {
        nvidiaOk = true;
        yield chunk;
      }
      logger.info('[CognitiveRouter] NVIDIA stream completed', {
        workload, latencyMs: Date.now() - startMs, provider: 'nvidia'
      });
    } catch (nvidiaErr: any) {
      if (nvidiaOk) throw nvidiaErr;
      if (primaryProvider === 'nvidia') {
        const geminiStatus = getGeminiStatus();
        if (geminiStatus.keyCount > 0) {
          logger.warn(`[CognitiveRouter] NVIDIA stream failed for ${workload}, falling back to Gemini stream`, {
            error: nvidiaErr.message,
          });
          const geminiOpts = {
            maxTokens: options.maxTokens,
            temperature: options.temperature,
            timeoutMs: 10000,
          };
          for await (const chunk of geminiStream(messages, geminiOpts)) {
            yield chunk;
          }
          return;
        }
      }
      throw nvidiaErr;
    }
  }

  // ── Capability Negotiation (Nova Loop) ───────────────────────────────────

  /**
   * Capability-based execution for Nova Loop and engineering workflows.
   * Negotiates capability against currently available providers.
   * If the requested capability is unavailable, stops safely and throws CapabilityUnavailableError.
   */
  async completeWithCapability(
    requirement: CapabilityRequirement,
    messages: RouterMessage[]
  ): Promise<string> {
    const minScore = requirement.minReasoningScore;
    const geminiStatus = getGeminiStatus();

    // Distinguish CONFIGURED from CURRENTLY USABLE / AVAILABLE
    const geminiConfigured = Boolean(config.gemini.apiKey1 && geminiStatus.keyCount > 0);
    const geminiAvailable = Boolean(geminiConfigured && isGeminiAvailable());

    const nvidiaConfigured = Boolean(config.nvidia.apiKey && config.nvidia.apiKey !== 'dummy_key' && config.nvidia.apiKey !== '');
    const nvidiaAvailable = Boolean(nvidiaConfigured && canRunNvidia('USER_DEEP', 0));

    // Calculate maximum available reasoning score across currently usable active capacity
    let maxAvailableScore = 0;
    if (nvidiaAvailable) {
      // NVIDIA deep reasoning profile ('USER_DEEP' with Nemotron / Llama-3.3 70B / 11B) provides score 2 reasoning
      maxAvailableScore = Math.max(maxAvailableScore, 2);
    }
    if (geminiAvailable) {
      const isProConfigured = Boolean(process.env.GEMINI_PRO_MODEL || config.gemini.chatModel?.includes('pro'));
      maxAvailableScore = Math.max(maxAvailableScore, isProConfigured ? 3 : 2);
    }

    if (minScore > maxAvailableScore) {
      throw new CapabilityUnavailableError(
        requirement.capability,
        minScore,
        maxAvailableScore,
        `Required capability '${requirement.capability}' (score ${minScore}) cannot be satisfied by currently available capacity (max available score ${maxAvailableScore}). Safe halt without guessing.`
      );
    }

    // ── Execution with capability-negotiated fallback ─────────────────────────
    if (minScore >= 3) {
      const proModel = process.env.GEMINI_PRO_MODEL || 'gemini-2.5-pro';
      try {
        return await geminiComplete(messages, {
          model: proModel,
          maxTokens: requirement.maxTokens ?? 1024,
          temperature: requirement.temperature ?? 0.1,
          jsonMode: requirement.jsonMode ?? true,
          timeoutMs: requirement.timeoutMs ?? 45_000,
        });
      } catch (geminiErr: any) {
        throw new CapabilityUnavailableError(
          requirement.capability,
          minScore,
          0,
          `Gemini Pro capability execution failed for '${requirement.capability}': ${geminiErr?.message}`
        );
      }
    }

    if (minScore === 2) {
      // Primary: Gemini if available
      if (geminiAvailable) {
        try {
          return await geminiComplete(messages, {
            maxTokens: requirement.maxTokens ?? 1024,
            temperature: requirement.temperature ?? 0.1,
            jsonMode: requirement.jsonMode ?? true,
            timeoutMs: requirement.timeoutMs ?? 30_000,
          });
        } catch (geminiErr: any) {
          logger.warn('[CognitiveRouter] Gemini failed for capability execution, attempting NVIDIA fallback', {
            capability: requirement.capability,
            error: geminiErr?.message
          });
          // Fall back to NVIDIA if configured and available
          if (nvidiaAvailable) {
            try {
              return await nvidiaComplete('USER_DEEP', messages, {
                maxTokens: requirement.maxTokens ?? 1024,
                temperature: requirement.temperature ?? 0.1,
                ...(requirement.jsonMode ? { response_format: { type: 'json_object' as const } } : {}),
              });
            } catch (nvidiaErr: any) {
              throw new CapabilityUnavailableError(
                requirement.capability,
                minScore,
                0,
                `All providers for '${requirement.capability}' failed. Gemini: ${geminiErr?.message}; NVIDIA fallback: ${nvidiaErr?.message}`
              );
            }
          }
          throw new CapabilityUnavailableError(
            requirement.capability,
            minScore,
            0,
            `Gemini failed for '${requirement.capability}' (${geminiErr?.message}) and no NVIDIA fallback available`
          );
        }
      }

      // If Gemini is not currently available, but NVIDIA is available:
      if (nvidiaAvailable) {
        try {
          return await nvidiaComplete('USER_DEEP', messages, {
            maxTokens: requirement.maxTokens ?? 1024,
            temperature: requirement.temperature ?? 0.1,
            ...(requirement.jsonMode ? { response_format: { type: 'json_object' as const } } : {}),
          });
        } catch (nvidiaErr: any) {
          throw new CapabilityUnavailableError(
            requirement.capability,
            minScore,
            0,
            `NVIDIA capability execution failed for '${requirement.capability}': ${nvidiaErr?.message}`
          );
        }
      }

      throw new CapabilityUnavailableError(
        requirement.capability,
        minScore,
        0,
        `No provider currently available satisfying capability '${requirement.capability}' (score ${minScore})`
      );
    }

    // minScore <= 1 (Surface audit)
    if (nvidiaAvailable) {
      try {
        return await nvidiaComplete('PROACTIVE', messages, {
          maxTokens: requirement.maxTokens ?? 512,
          temperature: requirement.temperature ?? 0.1,
          ...(requirement.jsonMode ? { response_format: { type: 'json_object' as const } } : {}),
        });
      } catch (nvidiaErr: any) {
        if (geminiAvailable) {
          try {
            return await geminiComplete(messages, {
              maxTokens: requirement.maxTokens ?? 512,
              temperature: requirement.temperature ?? 0.1,
              jsonMode: requirement.jsonMode ?? true,
              timeoutMs: requirement.timeoutMs ?? 20_000,
            });
          } catch (geminiErr: any) {
            throw new CapabilityUnavailableError(
              requirement.capability,
              minScore,
              0,
              `Both NVIDIA and Gemini failed for '${requirement.capability}'`
            );
          }
        }
        throw new CapabilityUnavailableError(
          requirement.capability,
          minScore,
          0,
          `NVIDIA failed for '${requirement.capability}': ${nvidiaErr?.message}`
        );
      }
    }

    if (geminiAvailable) {
      try {
        return await geminiComplete(messages, {
          maxTokens: requirement.maxTokens ?? 512,
          temperature: requirement.temperature ?? 0.1,
          jsonMode: requirement.jsonMode ?? true,
          timeoutMs: requirement.timeoutMs ?? 20_000,
        });
      } catch (geminiErr: any) {
        throw new CapabilityUnavailableError(
          requirement.capability,
          minScore,
          0,
          `Gemini failed for '${requirement.capability}': ${geminiErr?.message}`
        );
      }
    }

    throw new CapabilityUnavailableError(
      requirement.capability,
      minScore,
      0,
      `No available provider for '${requirement.capability}'`
    );
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
