/**
 * NVIDIA API client.
 *
 * NVIDIA exposes their LLM APIs through an OpenAI-compatible endpoint,
 * so we use the official openai SDK pointed at NVIDIA's base URL.
 *
 * This module implements a robust 4-key round-robin rotation to avoid
 * free-tier rate limits, automatically failing over to the next key.
 */

import OpenAI from 'openai';
import { config } from '../config';
import { logger } from './logger';

const NVIDIA_TIMEOUT_MS = 55_000;

export class NvidiaTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`NVIDIA API did not respond within ${timeoutMs}ms`);
    this.name = 'NvidiaTimeoutError';
  }
}

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

export const EXTRACTION_MODEL = 'meta/llama-3.1-8b-instruct';

export interface ChatOptions {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  response_format?: { type: 'json_object' | 'text' };
  tools?: any[];
  tool_choice?: 'auto' | 'none' | { type: 'function', function: { name: string } };
}

function getMockResponse(
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  options?: ChatOptions
): string {
  const systemMessage = messages.find(m => m.role === 'system')?.content || '';
  const userMessage = messages.find(m => m.role === 'user')?.content || '';
  const combined = (systemMessage + '\n' + userMessage).toLowerCase();

  if (combined.includes('goals') && combined.includes('shouldnotify')) {
    return JSON.stringify({
      shouldNotify: true,
      title: "Goal Check-in",
      body: "Hey! How is your goal going?"
    });
  }

  if (options?.response_format?.type === 'json_object') {
    return '{}';
  }
  
  return "Hey! I'm Nova. I wanted to see how you're doing today!";
}

class KeyPool {
  private clients: OpenAI[] = [];
  private currentIndex: number = 0;

  constructor() {
    const keys = [
      config.nvidia.apiKey,
      config.nvidia.apiKey2,
      config.nvidia.apiKey3,
      config.nvidia.apiKey4
    ].filter(k => k && k.trim() !== '' && k !== 'dummy_key');

    if (keys.length === 0) {
      // Fallback if no keys provided
      this.clients.push(new OpenAI({ apiKey: 'dummy_key', baseURL: config.nvidia.baseUrl, maxRetries: 0 }));
    } else {
      this.clients = keys.map(apiKey => new OpenAI({
        apiKey,
        baseURL: config.nvidia.baseUrl,
        maxRetries: 0 // We handle retries manually to switch keys
      }));
    }
    
    logger.info(`Initialized NVIDIA KeyPool with ${this.clients.length} keys for round-robin rotation.`);
  }

  /**
   * Executes a function that takes an OpenAI client, automatically rotating
   * and retrying if a rate-limit (429) or 503 error occurs.
   */
  async execute<T>(operation: (client: OpenAI, signal: AbortSignal, attempt: number) => Promise<T>): Promise<T> {
    let lastError: any = null;
    const maxAttempts = this.clients.length;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      // Round-robin selection
      const client = this.clients[this.currentIndex];
      this.currentIndex = (this.currentIndex + 1) % this.clients.length;

      try {
        const result = await withNvidiaTimeout((signal) => operation(client, signal, attempt));
        return result;
      } catch (err: any) {
        lastError = err;
        
        // Only retry on rate limits or server errors
        const isRetryable = err.status === 429 || err.status >= 500 || err.name === 'NvidiaTimeoutError';
        if (!isRetryable) {
          throw err;
        }
        
        logger.warn(`NVIDIA API call failed (Attempt ${attempt + 1}/${maxAttempts}), switching to next key`, { 
          status: err.status, 
          error: err.message,
          name: err.name
        });
      }
    }
    
    throw lastError;
  }
}

const keyPool = new KeyPool();

function buildPayload(messages: any[], options?: ChatOptions, attempt: number = 0) {
  const payload: any = {
    model: options?.model ?? config.nvidia.chatModel,
    messages,
    max_tokens: options?.maxTokens ?? 1024,
    temperature: options?.temperature ?? 0.85,
    stream: false,
  };

  // Downgrade model on subsequent attempts to avoid timeouts on heavy load
  if (attempt > 0 && /70b|49b/i.test(payload.model)) {
    payload.model = EXTRACTION_MODEL;
    logger.info('Falling back to 8B extraction model on retry', { model: payload.model });
  }

  if (options?.frequency_penalty !== undefined) payload.frequency_penalty = options.frequency_penalty;
  if (options?.presence_penalty !== undefined) payload.presence_penalty = options.presence_penalty;
  if (options?.response_format) payload.response_format = options.response_format;
  if (options?.tools) {
    payload.tools = options.tools;
    if (options.tool_choice) payload.tool_choice = options.tool_choice;
  }
  return payload;
}

export async function chatCompletion(
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  options?: ChatOptions,
): Promise<string> {
  try {
    return await keyPool.execute(async (client, signal, attempt) => {
      const payload = buildPayload(messages, options, attempt);
      const response = await client.chat.completions.create(payload, { signal });
      const message = response.choices[0]?.message;
      if (message?.tool_calls?.length) {
        return JSON.stringify({ tool_calls: message.tool_calls });
      }
      if (!message?.content) throw new Error('NVIDIA API returned an empty response');
      return message.content;
    });
  } catch (err: any) {
    const isDev = process.env.NODE_ENV === 'development';
    if (isDev) {
      logger.warn('NVIDIA API call failed — returning mock response (development only)', { error: err.message });
      return getMockResponse(messages, options);
    }
    logger.error('NVIDIA API call failed all keys', { error: err.message, status: err.status });
    throw err;
  }
}

export async function chatCompletionBackground(
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  options?: ChatOptions,
): Promise<string> {
  return chatCompletion(messages, options);
}

export async function chatCompletionLearning(
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  options?: ChatOptions,
): Promise<string> {
  return chatCompletion(messages, options);
}

export async function* chatCompletionStream(
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  options?: ChatOptions,
): AsyncGenerator<string, void, unknown> {
  
  // Streaming is tricky with retries because the stream might break halfway.
  // We'll wrap the initial connection in the key pool, but if it breaks mid-stream, it throws.
  
  const payload = buildPayload(messages, options, 0);
  payload.stream = true;

  try {
    const stream = await keyPool.execute(async (client, signal) => {
      return await client.chat.completions.create(payload, { signal }) as any;
    });

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
    logger.error('NVIDIA API streaming call failed', { error: err.message });
    throw err;
  }
}
