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

export type GeminiSlot = 'KEY_1' | 'KEY_2' | 'KEY_3' | 'KEY_4';
export type GeminiKeyRole = 'primary' | 'failover' | 'benchmark' | 'reserve';

export interface GeminiOptions {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  jsonMode?: boolean;
  timeoutMs?: number;
  targetSlot?: GeminiSlot;
  deadlineMs?: number;
}

// ── Key Pool Entry ────────────────────────────────────────────────────────────

interface PoolKey {
  slot: GeminiSlot;
  role: GeminiKeyRole;
  client: GoogleGenerativeAI;
  cooldownUntil: number;
  consecutiveFailures: number;
}

// ── Gemini Key Pool ───────────────────────────────────────────────────────────

class GeminiPool {
  private readonly keys: Map<GeminiSlot, PoolKey> = new Map();

  private static readonly COOLDOWN_RATELIMIT_MS = 60_000;  // 60s for 429
  private static readonly COOLDOWN_OVERLOAD_MS  = 30_000;  // 30s for 503/overload

  constructor() {
    const keyConfigs: Array<{ slot: GeminiSlot; role: GeminiKeyRole; key: string }> = [
      { slot: 'KEY_1', role: 'primary',   key: config.gemini.apiKey1 },
      { slot: 'KEY_2', role: 'failover',  key: config.gemini.apiKey2 },
      { slot: 'KEY_3', role: 'benchmark', key: config.gemini.apiKey3 },
      { slot: 'KEY_4', role: 'reserve',   key: config.gemini.apiKey4 },
    ];

    keyConfigs.forEach(({ slot, role, key }) => {
      if (key && key.trim() !== '') {
        this.keys.set(slot, {
          slot,
          role,
          client: new GoogleGenerativeAI(key.trim()),
          cooldownUntil: 0,
          consecutiveFailures: 0,
        });
      }
    });

    logger.info(`[Gemini] Pool initialized with ${this.keys.size} key(s) [Roles: 1=primary, 2=failover, 3=benchmark, 4=reserve]`);
  }

  get available(): boolean {
    const now = Date.now();
    const key1 = this.keys.get('KEY_1');
    const key2 = this.keys.get('KEY_2');
    return (key1 !== undefined && key1.cooldownUntil <= now) ||
           (key2 !== undefined && key2.cooldownUntil <= now);
  }

  get keyCount(): number { return this.keys.size; }

  /**
   * Execute an operation across the credential pool with a SINGLE overall deadline.
   * - Normal production traffic: attempts KEY_1 (primary) -> KEY_2 (failover) within deadline.
   * - Targeted traffic (e.g. benchmark): uses targetSlot directly (e.g. KEY_3) in isolation.
   * - Never sequentially consumes 8s KEY_1 + 8s KEY_2; breaks immediately if deadline is near.
   */
  async execute<T>(
    operation: (client: GoogleGenerativeAI, slot: GeminiSlot, remainingTimeoutMs: number) => Promise<T>,
    targetSlot?: GeminiSlot,
    deadlineMs?: number,
    defaultTimeoutMs: number = 8000
  ): Promise<T> {
    const now = Date.now();

    // 1. Isolated Targeted Execution (e.g. KEY_3 for benchmark)
    if (targetSlot) {
      const keyEntry = this.keys.get(targetSlot);
      if (!keyEntry) {
        throw new Error(`[Gemini] Target credential slot ${targetSlot} is not configured`);
      }
      if (keyEntry.cooldownUntil > now) {
        throw new Error(`[Gemini] Target credential slot ${targetSlot} is on cooldown (${keyEntry.cooldownUntil - now}ms remaining)`);
      }
      const remainingMs = deadlineMs ? Math.max(500, deadlineMs - Date.now()) : defaultTimeoutMs;

      try {
        const result = await operation(keyEntry.client, targetSlot, remainingMs);
        keyEntry.consecutiveFailures = 0;
        keyEntry.cooldownUntil = 0;
        return result;
      } catch (err: any) {
        this.handleKeyFailure(keyEntry, err);
        throw err;
      }
    }

    // 2. Production Conversational Execution: KEY_1 (Primary) -> KEY_2 (Failover)
    const productionSlots: GeminiSlot[] = ['KEY_1', 'KEY_2'];
    let lastError: any = null;

    for (const slot of productionSlots) {
      const keyEntry = this.keys.get(slot);
      if (!keyEntry) continue;

      const currentNow = Date.now();
      if (keyEntry.cooldownUntil > currentNow) {
        logger.debug(`[Gemini] ${slot} on cooldown, checking next failover slot`, {
          remainingMs: keyEntry.cooldownUntil - currentNow,
        });
        continue;
      }

      // Check remaining deadline budget before attempting slot
      const remainingMs = deadlineMs ? deadlineMs - currentNow : defaultTimeoutMs;
      if (remainingMs < 1000) {
        logger.warn(`[Gemini] Skipping ${slot} — remaining deadline budget (${remainingMs}ms) too small, failing fast to fallback`);
        break; // Stop immediately to preserve remaining budget for NVIDIA fallback
      }

      try {
        const result = await operation(keyEntry.client, slot, remainingMs);
        keyEntry.consecutiveFailures = 0;
        keyEntry.cooldownUntil = 0;
        return result;
      } catch (err: any) {
        lastError = err;
        const status = err.status ?? err.httpErrorCode ?? 0;
        const isBadRequest = status === 400 || status === 401 || status === 403;
        if (isBadRequest) throw err; // Don't retry bad request across keys

        this.handleKeyFailure(keyEntry, err);
        // Continue to KEY_2 ONLY if remaining deadline allows
      }
    }

    if (!lastError) {
      lastError = new Error('[Gemini] All production conversational keys (KEY_1, KEY_2) on cooldown or deadline expired');
    }
    throw lastError;
  }

  private handleKeyFailure(keyEntry: PoolKey, err: any): void {
    const status = err.status ?? err.httpErrorCode ?? 0;
    const msg = (err.message || '').toLowerCase();

    const isRateLimit = status === 429 || msg.includes('quota') || msg.includes('rate') || msg.includes('resource_exhausted');
    const isOverload  = status === 503 || msg.includes('overload') || msg.includes('unavailable');

    if (isRateLimit || isOverload) {
      const cooldownMs = isRateLimit ? GeminiPool.COOLDOWN_RATELIMIT_MS : GeminiPool.COOLDOWN_OVERLOAD_MS;
      keyEntry.cooldownUntil = Date.now() + cooldownMs;
      keyEntry.consecutiveFailures++;
      logger.warn(`[Gemini] ${keyEntry.slot} (${keyEntry.role}) rate-limited/overloaded, cooling ${cooldownMs}ms`, { status });
    } else {
      keyEntry.consecutiveFailures++;
      logger.warn(`[Gemini] ${keyEntry.slot} (${keyEntry.role}) failed (${err.name}), rotating to failover`, {
        status,
        errorName: err.name,
      });
    }
  }

  /**
   * Safe health status for observability — no keys exposed.
   */
  getStatus() {
    const now = Date.now();
    const slotStatus: Record<string, string> = {};
    this.keys.forEach((key, slot) => {
      slotStatus[slot] = key.cooldownUntil <= now ? 'AVAILABLE' : `COOLING_${Math.round((key.cooldownUntil - now)/1000)}s`;
    });

    return {
      configured: this.keys.size > 0,
      keyCount: this.keys.size,
      slots: slotStatus,
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

  return pool.execute(async (client, _slot, remainingTimeoutMs) => {
    const effectiveTimeoutMs = Math.min(timeoutMs, remainingTimeoutMs);
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
        effectiveTimeoutMs
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
        effectiveTimeoutMs
      );
      text = response.response.text();
    }

    if (!text || text.trim() === '') {
      throw new Error('[Gemini] Empty response received');
    }
    return text.trim();
  }, options.targetSlot, options.deadlineMs, timeoutMs);
}

/**
 * Isolated benchmark completion via Gemini (strictly routes to KEY_3).
 */
export async function geminiBenchmarkComplete(
  messages: OAIMessage[],
  options: Omit<GeminiOptions, 'targetSlot'> = {},
): Promise<string> {
  return geminiComplete(messages, { ...options, targetSlot: 'KEY_3' });
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
