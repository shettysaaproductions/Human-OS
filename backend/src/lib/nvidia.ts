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

export const nvidiaClient = new OpenAI({
  apiKey: config.nvidia.apiKey,
  baseURL: config.nvidia.baseUrl,
});

export interface ChatOptions {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  response_format?: { type: 'json_object' | 'text' };
}

/**
 * Sends a chat completion request to NVIDIA's API.
 * Returns the full response text (non-streaming).
 *
 * For Phase 1 this is sufficient. Phase 2 adds streaming via SSE.
 */
export async function chatCompletion(
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  options?: ChatOptions,
): Promise<string> {
  const payload: any = {
    model: options?.model ?? config.nvidia.chatModel,
    messages,
    max_tokens: options?.maxTokens ?? 1024,
    temperature: options?.temperature ?? 0.7,
    stream: false,
  };

  if (options?.response_format) {
    payload.response_format = options.response_format;
  }

  const response = await nvidiaClient.chat.completions.create(payload);

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error('NVIDIA API returned an empty response');
  }

  return content;
}
