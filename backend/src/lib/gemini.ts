/**
 * Gemini Provider — Nova's Conversational Brain (Phase 10.1)
 *
 * Wraps @google/generative-ai (already installed) with a 2-key pool,
 * rate limiting, cooldown/backoff, and provider health tracking.
 *
 * Architecture:
 *   GeminiPool (key1, key2)
 *       ├── complete()      → text generation
 *       ├── completeJSON()  → structured/JSON generation
 *       └── stream()        → async text stream
 *
 * Error classification:
 *   429 → rate limit: cooldown 60s, try next key
 *   503/overload → cooldown 30s, try next key
 *   400 → bad request: do NOT retry (config or prompt error)
 *   other → surface to caller
 *
 * This file NEVER exposes API keys in logs.
 */

import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from '@google/generative-ai';
import { config } from '../config';
import { logger } from './logger';

const GEMINI_TIMEOUT_MS = 45_000; // 45s — conversational Gemini is fast; generous cap for safety

// ── Safety Settings ──────────────────────────────────────────────────────────
// Nova is a personal companion app. Use minimal safety blocking so natural
// Hinglish conversation doesn't get blocked by over-sensitive filters.
// Content moderation is handled at the application layer (ProactiveGate etc.)
const SAFETY_SETTINGS = [
  { category: HarmCategory.HARM_CATEGORY_HARASSMENT,        threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,       threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
  { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
];

export class GeminiTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Gemini API did not respond within ${timeoutMs}ms`);
    this.name = 'GeminiTimeoutError';
  }
}

export class GeminiRateLimitError extends Error {
  constructor() {
    super('Gemini API rate limit exceeded (429)');
    this.name = 'GeminiRateLimitError';
  }
}

function withGeminiTimeout<T>(fn: () => Promise<T>, timeoutMs: number = GEMINI_TIMEOUT_MS): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new GeminiTimeoutError(timeoutMs)), timeoutMs);
    fn().then(
      (result) => { clearTimeout(timer); resolve(result); },
      (err)    => { clearTimeout(timer); reject(err); }
    );
  });
}

export interface GeminiMessage {
  role: 'user' | 'model';
  content: string;
}

export interface GeminiOptions {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  jsonMode?: boolean;
  timeoutMs?: number;
}

// ── Key Pool Entry ────────────────────────────────────────────────────────────

interface PoolKey {
  index: number;
  client: GoogleGenerativeAI;
  cooldownUntil: number;
  consecutiveFailures: number;
}

// ── Gemini Key Pool ───────────────────────────────────────────────────────────

class GeminiPool {
  private readonly keys: PoolKey[] = [];
  private currentIndex = 0;

  private static readonly COOLDOWN_RATELIMIT_MS = 60_000;  // 60s for 429
  private static readonly COOLDOWN_OVERLOAD_MS  = 30_000;  // 30s for 503/overload

  constructor() {
    const rawKeys = [config.gemini.apiKey1, config.gemini.apiKey2]
      .filter(k => k && k.trim() !== '');

    if (rawKeys.length === 0) {
      logger.warn('[Gemini] No API keys configured — Gemini provider will be unavailable');
      return;
    }

    rawKeys.forEach((key, i) => {
      this.keys.push({
        index: i,
        client: new GoogleGenerativeAI(key),
        cooldownUntil: 0,
        consecutiveFailures: 0,
      });
    });

    logger.info(`[Gemini] Pool initialized with ${this.keys.length} key(s)`);
  }

  get available(): boolean {
    if (this.keys.length === 0) return false;
    const now = Date.now();
    return this.keys.some(k => k.cooldownUntil <= now);
  }

  get keyCount(): number { return this.keys.length; }

  /**
   * Execute an operation across the key pool with automatic failover.
   * Skips keys that are on cooldown (rate-limited or erroring).
   */
  async execute<T>(operation: (client: GoogleGenerativeAI) => Promise<T>): Promise<T> {
    if (this.keys.length === 0) {
      throw new Error('[Gemini] No API keys configured');
    }

    const now = Date.now();
    const total = this.keys.length;
    let lastError: any = null;

    for (let attempt = 0; attempt < total; attempt++) {
      const keyEntry = this.keys[(this.currentIndex + attempt) % total];

      if (keyEntry.cooldownUntil > now) {
        logger.debug(`[Gemini] Key ${keyEntry.index} on cooldown, skipping`, {
          remainingMs: keyEntry.cooldownUntil - now,
        });
        continue;
      }

      try {
        const result = await operation(keyEntry.client);
        // Success — clear consecutive failures
        keyEntry.consecutiveFailures = 0;
        keyEntry.cooldownUntil = 0;
        this.currentIndex = (this.currentIndex + 1) % total;
        return result;
      } catch (err: any) {
        lastError = err;
        const status = err.status ?? err.httpErrorCode ?? 0;
        const msg = (err.message || '').toLowerCase();

        const isRateLimit = status === 429 || msg.includes('quota') || msg.includes('rate') || msg.includes('resource_exhausted');
        const isOverload  = status === 503 || msg.includes('overload') || msg.includes('unavailable');
        const isBadRequest = status === 400 || status === 401 || status === 403;

        if (isBadRequest) {
          // Config or prompt error — don't retry across keys, surface immediately
          throw err;
        }

        // Only put a key on cooldown for definitive HTTP error codes.
        // Timeouts and unknown errors rotate to next key but don't cooldown the current
        // one — the key may be fine, the request may just have been slow.
        if (isRateLimit || isOverload) {
          const cooldownMs = isRateLimit ? GeminiPool.COOLDOWN_RATELIMIT_MS : GeminiPool.COOLDOWN_OVERLOAD_MS;
          keyEntry.cooldownUntil = Date.now() + cooldownMs;
          keyEntry.consecutiveFailures++;
          logger.warn(`[Gemini] Key ${keyEntry.index} rate-limited/overloaded, cooling ${cooldownMs}ms`, { status });
        } else {
          // Timeout or unknown: rotate to next key, do NOT lock this key.
          // It might work on retry or the next key might be faster.
          keyEntry.consecutiveFailures++;
          logger.warn(`[Gemini] Key ${keyEntry.index} failed (${err.name}), rotating to next key`, {
            status,
            errorName: err.name,
          });
        }
      }
    }

    if (!lastError) {
      lastError = new Error('[Gemini] All keys on cooldown');
    }
    throw lastError;
  }

  /**
   * Safe health status for observability — no keys exposed.
   */
  getStatus() {
    const now = Date.now();
    return {
      configured: this.keys.length > 0,
      keyCount: this.keys.length,
      availableKeys: this.keys.filter(k => k.cooldownUntil <= now).length,
      coolingKeys: this.keys.filter(k => k.cooldownUntil > now).length,
    };
  }
}

const pool = new GeminiPool();

// ── Message Format Adapter ────────────────────────────────────────────────────
// Gemini uses {role:'user'|'model', parts:[{text}]} instead of OpenAI's {role, content}.
// We accept OpenAI-style input for compatibility with the rest of the codebase.

type OAIMessage = { role: 'system' | 'user' | 'assistant'; content: string };

function toGeminiHistory(messages: OAIMessage[]): GeminiMessage[] {
  return messages
    .filter(m => m.role !== 'system') // system is handled as systemInstruction
    .map(m => ({
      role: m.role === 'assistant' ? 'model' as const : 'user' as const,
      content: m.content,
    }));
}

function extractSystem(messages: OAIMessage[]): string {
  return messages
    .filter(m => m.role === 'system')
    .map(m => m.content)
    .join('\n\n');
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Text completion via Gemini.
 * Accepts OpenAI-compatible message format for drop-in use.
 */
export async function geminiComplete(
  messages: OAIMessage[],
  options: GeminiOptions = {},
): Promise<string> {
  const modelName = options.model ?? config.gemini.chatModel;
  const systemInstruction = extractSystem(messages);
  const history = toGeminiHistory(messages);

  if (history.length === 0) {
    throw new Error('[Gemini] At least one non-system message is required');
  }

  // Last message is the current user turn; rest is history
  const lastMessage = history[history.length - 1];
  const historyMsgs = history.slice(0, -1);
  let text: string;
  const timeoutMs = options.timeoutMs ?? (options.jsonMode ? 30_000 : config.gemini.conversationTimeoutMs);

  return pool.execute(async (client) => {
    const model = client.getGenerativeModel({
      model: modelName,
      systemInstruction: systemInstruction || undefined,
      safetySettings: SAFETY_SETTINGS,
      generationConfig: {
        // 512 default — 300 was truncating Nova's conversational replies mid-sentence.
        maxOutputTokens: options.maxTokens ?? 512,
        temperature: options.temperature ?? 0.85,
        ...(options.jsonMode ? { responseMimeType: 'application/json' } : {}),
      },
    });

    if (historyMsgs.length === 0) {
      // Single-turn: use generateContent() directly with just the user text string.
      // systemInstruction is already embedded on the model via getGenerativeModel().
      // generateContent() accepts string | Part[] for single-turn (not Content[] with role).
      const response = await withGeminiTimeout(() =>
        model.generateContent(lastMessage.content),
        timeoutMs
      );
      text = response.response.text();
    } else {
      // Multi-turn: use startChat() to preserve conversation history.
      const chat = model.startChat({
        history: historyMsgs.map(m => ({
          role: m.role,
          parts: [{ text: m.content }],
        })),
      });

      const response = await withGeminiTimeout(() =>
        chat.sendMessage([{ text: lastMessage.content }]),
        timeoutMs
      );
      text = response.response.text();
    }

    if (!text || text.trim() === '') {
      throw new Error('[Gemini] Empty response received');
    }
    return text.trim();
  });
}

/**
 * JSON-mode completion via Gemini.
 * Enforces `application/json` MIME type for structured extraction.
 */
export async function geminiCompleteJSON(
  messages: OAIMessage[],
  options: Omit<GeminiOptions, 'jsonMode'> = {},
): Promise<string> {
  return geminiComplete(messages, { ...options, jsonMode: true });
}

/**
 * Streaming text completion via Gemini.
 * Yields text chunks as they arrive.
 */
export async function* geminiStream(
  messages: OAIMessage[],
  options: GeminiOptions = {},
): AsyncGenerator<string, void, unknown> {
  const modelName = options.model ?? config.gemini.chatModel;
  const systemInstruction = extractSystem(messages);
  const history = toGeminiHistory(messages);

  if (history.length === 0) {
    throw new Error('[Gemini] At least one non-system message is required');
  }

  const lastMessage = history[history.length - 1];
  const historyMsgs = history.slice(0, -1);
  const timeoutMs = options.timeoutMs ?? config.gemini.conversationTimeoutMs;

  // For streaming we can't use pool.execute() (generator can't be wrapped easily)
  // so we check availability first, then use first available key.
  if (!pool.available) {
    throw new Error('[Gemini] All keys are on cooldown or unconfigured');
  }

  // Collect chunks from execute callback
  let streamErr: any = null;
  const chunks: string[] = [];

  await pool.execute(async (client) => {
    const model = client.getGenerativeModel({
      model: modelName,
      systemInstruction: systemInstruction || undefined,
      safetySettings: SAFETY_SETTINGS,
      generationConfig: {
        maxOutputTokens: options.maxTokens ?? 512,
        temperature: options.temperature ?? 0.85,
      },
    });

    if (historyMsgs.length === 0) {
      const result = await withGeminiTimeout(
        () => model.generateContentStream(lastMessage.content),
        timeoutMs
      );
      for await (const chunk of result.stream) {
        const t = chunk.text();
        if (t) chunks.push(t);
      }
    } else {
      const chat = model.startChat({
        history: historyMsgs.map(m => ({
          role: m.role,
          parts: [{ text: m.content }],
        })),
      });

      const result = await withGeminiTimeout(
        () => chat.sendMessageStream([{ text: lastMessage.content }]),
        timeoutMs
      );

      for await (const chunk of result.stream) {
        const t = chunk.text();
        if (t) chunks.push(t);
      }
    }
    return null;
  }).catch(err => {
    streamErr = err;
  });

  if (streamErr) {
    throw streamErr;
  }

  for (const chunk of chunks) {
    yield chunk;
  }
}

/**
 * Health and status for the /health/cognitive endpoint.
 */
export function getGeminiStatus() {
  return pool.getStatus();
}
