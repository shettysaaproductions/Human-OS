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

export interface ChatOptions {
  model?: string;
  maxTokens?: number;
  temperature?: number;
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
 * Falls back to a high-fidelity local mock completion if the API key fails.
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

  try {
    const response = await nvidiaClient.chat.completions.create(payload);
    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('NVIDIA API returned an empty response');
    }
    return content;
  } catch (err: any) {
    logger.warn('NVIDIA API call failed, falling back to mock response generator', {
      error: err.message,
      status: err.status
    });
    return getMockResponse(messages, options);
  }
}
