/**
 * NVIDIA API client.
 *
 * NVIDIA exposes their LLM APIs through an OpenAI-compatible endpoint,
 * so we use the official openai SDK pointed at NVIDIA's base URL.
 *
 * Models available: https://build.nvidia.com/explore/discover
 */

import OpenAI from 'openai';
import { config } from '../config';
import { logger } from './logger';

export const nvidiaClient = new OpenAI({
  apiKey: config.nvidia.apiKey || 'dummy_key',
  baseURL: config.nvidia.baseUrl,
  maxRetries: 0, // Fail fast on 429 so we can use secondary key
});

export const nvidiaClientSecondary = new OpenAI({
  apiKey: config.nvidia.apiKey2 || config.nvidia.apiKey || 'dummy_key',
  baseURL: config.nvidia.baseUrl,
  maxRetries: 0,
});

// Key 3: Dedicated to Self-Improvement + Realtime Learning
export const nvidiaClientLearning = new OpenAI({
  apiKey: config.nvidia.apiKey3 || config.nvidia.apiKey2 || config.nvidia.apiKey || 'dummy_key',
  baseURL: config.nvidia.baseUrl,
  maxRetries: 0,
});

// Key 4: Dedicated to Memory Extraction + Background Actions
export const nvidiaClientExtraction = new OpenAI({
  apiKey: config.nvidia.apiKey4 || config.nvidia.apiKey2 || config.nvidia.apiKey || 'dummy_key',
  baseURL: config.nvidia.baseUrl,
  maxRetries: 0,
});


/** Thrown when the NVIDIA API does not respond within NVIDIA_TIMEOUT_MS. */
export class NvidiaTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`NVIDIA API did not respond within ${timeoutMs}ms`);
    this.name = 'NvidiaTimeoutError';
  }
}

const NVIDIA_TIMEOUT_MS = 55_000; // 55 seconds — accommodates Nemotron 49B / larger models on free tier
                                   // async_mode returns 202 immediately, so user isn't blocked by this wait

/**
 * Races an NVIDIA SDK call against a 30-second AbortSignal.
 * Throws NvidiaTimeoutError if the deadline is exceeded.
 */
function withNvidiaTimeout<T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), NVIDIA_TIMEOUT_MS);

  return fn(controller.signal).then(
    (result) => { clearTimeout(timer); return result; },
    (err) => {
      clearTimeout(timer);
      if (controller.signal.aborted) {
        throw new NvidiaTimeoutError(NVIDIA_TIMEOUT_MS);
      }
      throw err;
    }
  );
}

/**
 * Lightweight model used by background extraction agents (Semantic, Emotional, Episodic, etc.).
 * These agents only extract structured JSON from a single message — 8B is ideal for this.
 * The main chat model (70B) is configured via NVIDIA_CHAT_MODEL env var.
 */
export const EXTRACTION_MODEL = 'meta/llama-3.1-8b-instruct';

export interface ChatOptions {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  /** Penalises repeating the same tokens (phrases) mid-response. Range 0–2. */
  frequency_penalty?: number;
  presence_penalty?: number;
  response_format?: { type: 'json_object' | 'text' };
  tools?: any[];
  tool_choice?: 'auto' | 'none' | { type: 'function', function: { name: string } };
}

/**
 * Mock response generator when the NVIDIA API key fails or during testing.
 */
function getMockResponse(
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  options?: ChatOptions
): string {
  const systemMessage = messages.find(m => m.role === 'system')?.content || '';
  const userMessage = messages.find(m => m.role === 'user')?.content || '';
  const combined = (systemMessage + '\n' + userMessage).toLowerCase();

  // 1. Goal Check-ins
  if (combined.includes('goals') && combined.includes('shouldnotify')) {
    const idMatch = userMessage.match(/\[ID:\s*([a-f0-9\-]{36})\]/i);
    const goalId = idMatch ? idMatch[1] : null;
    return JSON.stringify({
      shouldNotify: true,
      title: "Goal Check-in",
      body: "Hey Alex! How is your goal of running a marathon by September 2026 going?",
      source_memory_id: goalId
    });
  }

  // 2. Child Milestones Check-ins
  if (combined.includes('family') && combined.includes('shouldnotify')) {
    const idMatch = userMessage.match(/\[ID:\s*([a-f0-9\-]{36})\]/i);
    const childId = idMatch ? idMatch[1] : null;
    return JSON.stringify({
      shouldNotify: true,
      title: "Emily's Milestone",
      body: "Hey Alex! How is Emily doing? She must be growing up so fast at age 3!",
      source_memory_id: childId
    });
  }

  // 3. Grounding & Refinement
  if (combined.includes('grounding') || combined.includes('refine')) {
    const jsonMatch = userMessage.match(/\{[\s\S]*?\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        return JSON.stringify({
          title: parsed.title || "Moment Check-in",
          body: parsed.body || "How is everything going?"
        });
      } catch (e) {}
    }
    return JSON.stringify({
      title: "Moment Check-in",
      body: "Just wanted to check in and see how you're doing!"
    });
  }

  // 4. Default JSON if requested
  if (options?.response_format?.type === 'json_object') {
    if (combined.includes('kg_nodes')) {
      return JSON.stringify({ kg_nodes: [], kg_edges: [] });
    }
    if (combined.includes('extracted_memories') || combined.includes('persist')) {
      return JSON.stringify([]);
    }
    if (combined.includes('flawsdetected') || combined.includes('behavioral flaws')) {
      return JSON.stringify({
        flawsDetected: [
          {
            flaw_type: "Repetition",
            severity: "medium",
            evidence: "Repeated 'Hey!' multiple times",
            patch_rule: "ANTI-ROBOT RULE (REPETITION): Never start messages with the exact same greeting consecutively."
          }
        ],
        healthScore: 85,
        summary: "Nova is mostly healthy but repeating greetings."
      });
    }
    return '{}';
  }

  // 5. Default text response
  if (systemMessage.includes('CRITICAL INSTRUCTION: You MUST respond in Hindi')) {
    return "नमस्ते! मैं नोवा हूँ। मैं जानना चाहती थी कि आज आप कैसे हैं!";
  }
  
  return "Hey! I'm Nova. I wanted to see how you're doing today!";
}

/**
 * Sends a chat completion request to NVIDIA's API.
 * Returns the full response text (non-streaming).
 *
 * - Enforces a 30-second hard timeout via AbortSignal.
 * - In development: falls back to getMockResponse on any failure.
 * - In production: throws so the caller returns a proper error to the client.
 *   Production users must never receive a silent mock fallback.
 */
export async function chatCompletion(
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  options?: ChatOptions,
): Promise<string> {
  const payload: any = {
    model: options?.model ?? config.nvidia.chatModel,
    messages,
    max_tokens: options?.maxTokens ?? 1024,
    temperature: options?.temperature ?? 0.85,
    stream: false,
  };

  // Anti-repetition parameters — prevent token-level and topic-level loops
  if (options?.frequency_penalty !== undefined) {
    payload.frequency_penalty = options.frequency_penalty;
  }
  if (options?.presence_penalty !== undefined) payload.presence_penalty = options.presence_penalty;
  if (options?.response_format) payload.response_format = options.response_format;
  if (options?.tools) {
    payload.tools = options.tools;
    if (options.tool_choice) payload.tool_choice = options.tool_choice;
  }

  try {
    // Race the SDK call against a hard deadline.
    try {
      const response = await withNvidiaTimeout((signal) =>
        nvidiaClient.chat.completions.create(payload, { signal })
      );
      const message = response.choices[0]?.message;
      if (message?.tool_calls?.length) {
        return JSON.stringify({ tool_calls: message.tool_calls });
      }
      if (!message?.content) throw new Error('NVIDIA API returned an empty response');
      return message.content;
    } catch (primaryErr: any) {
      const isRetryable = primaryErr.status === 429 || primaryErr.status >= 500 || primaryErr.name === 'NvidiaTimeoutError';
      if (!isRetryable) throw primaryErr;
      logger.warn('NVIDIA primary key failed/rate-limited, falling back to secondary', { error: primaryErr.message });

      // If it's a timeout/503 on a big model (70B or 49B), downgrade to the fast 8B model.
      const isBigModel = /70b|49b/i.test(payload.model);
      if ((primaryErr.status >= 500 || primaryErr.name === 'NvidiaTimeoutError') && isBigModel) {
        payload.model = EXTRACTION_MODEL;
        logger.info('Falling back to 8B extraction model to avoid big-model timeout', { model: payload.model });
      }

      try {
        const responseSecondary = await withNvidiaTimeout((signal) =>
          nvidiaClientSecondary.chat.completions.create(payload, { signal })
        );
        const messageSec = responseSecondary.choices[0]?.message;
        if (messageSec?.tool_calls?.length) {
          return JSON.stringify({ tool_calls: messageSec.tool_calls });
        }
        if (!messageSec?.content) throw new Error('NVIDIA API returned an empty response');
        return messageSec.content;
      } catch (secondaryErr: any) {
        // Both chat keys failed on the big model — almost always the per-model free-tier
        // rate cap (the 8B extraction agents keep succeeding on the SAME key1). Last
        // resort: answer with the fast 8B extraction model instead of the zero-drop
        // fallback text, so the user always gets a real reply under free-tier pressure.
        const secRetryable = secondaryErr.status === 429 || secondaryErr.status >= 500 || secondaryErr.name === 'NvidiaTimeoutError';
        if (!secRetryable) throw secondaryErr;
        try {
          payload.model = EXTRACTION_MODEL;
          logger.warn('NVIDIA secondary also failed — last-resort 8B extraction model', { error: secondaryErr.message });
          const responseTertiary = await withNvidiaTimeout((signal) =>
            nvidiaClient.chat.completions.create(payload, { signal })
          );
          const messageTer = responseTertiary.choices[0]?.message;
          if (messageTer?.tool_calls?.length) {
            return JSON.stringify({ tool_calls: messageTer.tool_calls });
          }
          if (!messageTer?.content) throw new Error('NVIDIA API returned an empty response');
          return messageTer.content;
        } catch (tertiaryErr: any) {
          // Final fallback: wait 2s and retry with 8B on the secondary key.
          // NVIDIA free-tier per-model rate windows often reset in <2s. This
          // prevents FALLBACK_REPLY from firing on transient spikes — a 2s pause
          // is far less jarring than killing the conversation with a fake reply.
          const isFinalRetryable = tertiaryErr.status === 429 || tertiaryErr.status >= 500 || tertiaryErr.name === 'NvidiaTimeoutError';
          if (isFinalRetryable) {
            logger.warn('NVIDIA all tiers failed — waiting 2s for rate-limit window reset, then final retry', { error: tertiaryErr.message });
            await new Promise(resolve => setTimeout(resolve, 2000));
            try {
              payload.model = EXTRACTION_MODEL;
              const responseFinal = await withNvidiaTimeout((signal) =>
                nvidiaClientSecondary.chat.completions.create(payload, { signal })
              );
              const messageFin = responseFinal.choices[0]?.message;
              if (messageFin?.tool_calls?.length) {
                return JSON.stringify({ tool_calls: messageFin.tool_calls });
              }
              if (!messageFin?.content) throw new Error('Final retry: empty response');
              logger.info('NVIDIA final retry succeeded after 2s backoff');
              return messageFin.content;
            } catch (finalErr) {
              logger.error('NVIDIA final retry also failed — FALLBACK_REPLY will be sent', { error: finalErr instanceof Error ? finalErr.message : String(finalErr) });
              throw finalErr;
            }
          }
          throw tertiaryErr;
        }
      }
    }
  } catch (err: any) {
    const isDev = process.env.NODE_ENV === 'development';

    if (isDev) {
      // Development only: use mock so local dev works without a live API key.
      logger.warn('NVIDIA API call failed — returning mock response (development only)', {
        error: err.message,
        name: err.name,
      });
      return getMockResponse(messages, options);
    }

    // Production: surface the real error so the caller can return HTTP 503.
    // Do NOT silently return a fake response to real users.
    logger.error('NVIDIA API call failed', {
      error: err.message,
      name: err.name,
      status: err.status,
    });
    throw err;
  }
}

/**
 * Sends a chat completion request to NVIDIA's API using the secondary background key.
 * Use this for NACE, ReflectionScheduler, MomentEngine, and SelfImprovement.
 */
export async function chatCompletionBackground(
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  options?: ChatOptions,
): Promise<string> {
  const payload: any = {
    model: options?.model ?? config.nvidia.chatModel,
    messages,
    max_tokens: options?.maxTokens ?? 1024,
    temperature: options?.temperature ?? 0.85,
    stream: false,
  };

  if (options?.frequency_penalty !== undefined) payload.frequency_penalty = options.frequency_penalty;
  if (options?.presence_penalty !== undefined) payload.presence_penalty = options.presence_penalty;
  if (options?.response_format) payload.response_format = options.response_format;
  if (options?.tools) {
    payload.tools = options.tools;
    if (options.tool_choice) payload.tool_choice = options.tool_choice;
  }

  try {
    const response = await withNvidiaTimeout((signal) =>
      nvidiaClientSecondary.chat.completions.create(payload, { signal })
    );
    const message = response.choices[0]?.message;
    if (message?.tool_calls?.length) {
      return JSON.stringify({ tool_calls: message.tool_calls });
    }
    if (!message?.content) {
      throw new Error('NVIDIA background API returned an empty response');
    }
    return message.content;
  } catch (err: any) {
    const isDev = process.env.NODE_ENV === 'development';
    if (isDev) {
      logger.warn('NVIDIA API call failed (background) — returning mock response', {
        error: err.message,
        name: err.name,
      });
      return getMockResponse(messages, options);
    }
    logger.error('NVIDIA API call failed (background)', {
      error: err.message,
      name: err.name,
      status: err.status,
    });
    throw err;
  }
}

/**
 * Sends a chat completion request using the LEARNING key (Key 3).
 * Use this for NovaSelfImprovementService and NovaRealtimeLearningService.
 * Falls back to Key 2, then Key 1 if Key 3 is not configured.
 */
export async function chatCompletionLearning(
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  options?: ChatOptions,
): Promise<string> {
  const payload: any = {
    model: options?.model ?? config.nvidia.chatModel,
    messages,
    max_tokens: options?.maxTokens ?? 1024,
    temperature: options?.temperature ?? 0.85,
    stream: false,
  };

  if (options?.frequency_penalty !== undefined) payload.frequency_penalty = options.frequency_penalty;
  if (options?.presence_penalty !== undefined) payload.presence_penalty = options.presence_penalty;
  if (options?.response_format) payload.response_format = options.response_format;

  try {
    const response = await withNvidiaTimeout((signal) =>
      nvidiaClientLearning.chat.completions.create(payload, { signal })
    );
    const message = response.choices[0]?.message;
    if (!message?.content) {
      throw new Error('NVIDIA learning API returned an empty response');
    }
    return message.content;
  } catch (err: any) {
    // Fallback to secondary key
    logger.warn('NVIDIA learning key failed, falling back to secondary', { error: err.message });
    try {
      const response = await withNvidiaTimeout((signal) =>
        nvidiaClientSecondary.chat.completions.create(payload, { signal })
      );
      const message = response.choices[0]?.message;
      if (!message?.content) throw new Error('NVIDIA fallback API returned empty');
      return message.content;
    } catch (fallbackErr: any) {
      const isDev = process.env.NODE_ENV === 'development';
      if (isDev) {
        logger.warn('NVIDIA API call failed (learning) — returning mock response', { error: fallbackErr.message });
        return getMockResponse(messages, options);
      }
      logger.error('NVIDIA learning API call failed (all keys)', { error: fallbackErr.message });
      throw fallbackErr;
    }
  }
}

/**
 * Streams a chat completion response from NVIDIA's API.
 * Yields chunks of text as they arrive.
 */
export async function* chatCompletionStream(
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  options?: ChatOptions,
): AsyncGenerator<string, void, unknown> {
  const payload: any = {
    model: options?.model ?? config.nvidia.chatModel,
    messages,
    max_tokens: options?.maxTokens ?? 1024,
    temperature: options?.temperature ?? 0.85,
    stream: true,
  };

  if (options?.frequency_penalty !== undefined) payload.frequency_penalty = options.frequency_penalty;
  if (options?.presence_penalty !== undefined) payload.presence_penalty = options.presence_penalty;
  if (options?.tools) {
    payload.tools = options.tools;
    if (options.tool_choice) payload.tool_choice = options.tool_choice;
  }

  // Hard timeout for the streaming call. Without an AbortSignal, a stalled upstream leaves
  // the `for await` hanging forever (the default OpenAI SDK timeout never aborts the socket).
  const controller = new AbortController();
  const streamTimeout = setTimeout(() => controller.abort(), NVIDIA_TIMEOUT_MS);
  try {
    const stream = await nvidiaClient.chat.completions.create(payload, { signal: controller.signal }) as any;
    let toolCallBuffer = '';
    let toolCallName = '';
    let isToolCall = false;

    for await (const chunk of stream) {
      const tc = chunk.choices[0]?.delta?.tool_calls?.[0];
      if (tc) {
        isToolCall = true;
        if (tc.function?.name) toolCallName = tc.function.name;
        if (tc.function?.arguments) toolCallBuffer += tc.function.arguments;
        continue;
      }
      const content = chunk.choices[0]?.delta?.content || '';
      if (content) yield content;
    }

    if (isToolCall) {
      yield JSON.stringify({ tool_calls: [{ function: { name: toolCallName, arguments: toolCallBuffer } }] });
    }
  } catch (err: any) {
    logger.error('NVIDIA API streaming call failed', {
      error: err.message,
      name: err.name,
    });
    throw err;
  } finally {
    clearTimeout(streamTimeout);
  }
}
