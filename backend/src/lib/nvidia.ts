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
});

/** Thrown when the NVIDIA API does not respond within NVIDIA_TIMEOUT_MS. */
export class NvidiaTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`NVIDIA API did not respond within ${timeoutMs}ms`);
    this.name = 'NvidiaTimeoutError';
  }
}

const NVIDIA_TIMEOUT_MS = 30_000; // 30 seconds hard deadline

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
  /** Penalises bringing up topics already covered in the response. Range 0–2. */
  presence_penalty?: number;
  response_format?: { type: 'json_object' | 'text' };
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
    max_tokens: options?.maxTokens ?? 512,
    temperature: options?.temperature ?? 0.85,
    stream: false,
  };

  // Anti-repetition parameters — prevent token-level and topic-level loops
  if (options?.frequency_penalty !== undefined) {
    payload.frequency_penalty = options.frequency_penalty;
  }
  if (options?.presence_penalty !== undefined) {
    payload.presence_penalty = options.presence_penalty;
  }

  if (options?.response_format) {
    payload.response_format = options.response_format;
  }

  try {
    // Race the SDK call against a 30-second hard deadline.
    const response = await withNvidiaTimeout((signal) =>
      nvidiaClient.chat.completions.create(payload, { signal })
    );
    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('NVIDIA API returned an empty response');
    }
    return content;
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

  try {
    const stream = await nvidiaClient.chat.completions.create(payload) as any;
    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content || '';
      if (content) yield content;
    }
  } catch (err: any) {
    logger.error('NVIDIA API streaming call failed', {
      error: err.message,
      name: err.name,
    });
    throw err;
  }
}
