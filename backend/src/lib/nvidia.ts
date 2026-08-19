/**
 * NVIDIA API client — Nova's Brain Architecture
 *
 * Models Nova's cognition after the human brain. Each NVIDIA API key is assigned
 * a dedicated "brain region" so that the user-facing reply (Frontal Cortex) is
 * NEVER starved by background memory extraction or learning jobs.
 *
 * ┌─────────────────────────────────────────────────────────────────────┐
 * │  🧠  N O V A ' S   B R A I N   A R C H I T E C T U R E           │
 * ├───────────────┬─────────────────────────────────────────────────────┤
 * │ Frontal Cortex│ Key 1 — Real-time chat replies (user-facing)       │
 * │ Hippocampus   │ Key 2 — Memory agents & learning services          │
 * │ Cerebellum    │ Key 3 — Background tasks (search, weather, proact) │
 * │ Reserve       │ Key 4 — Emergency failover for Frontal Cortex      │
 * └───────────────┴─────────────────────────────────────────────────────┘
 *
 * Each region is an isolated OpenAI client so rate limits on one key
 * never block another region. If the Frontal Cortex key (Key 1) fails,
 * it automatically falls over to the Reserve key (Key 4), guaranteeing
 * the user always gets a reply.
 */

import OpenAI from 'openai';
import { config } from '../config';
import { logger } from './logger';

const NVIDIA_TIMEOUT_MS = 55_000; // 55s — 49B Nemotron needs 20-40s on free tier

// ── Rate Limiter (Token Bucket) ─────────────────────────────────────────────
// Prevents burning through NVIDIA free-tier limits (60 RPM per key).
// Token bucket refills continuously — smooth traffic shaping, no thundering herd.

class TokenBucket {
  private tokens: number;
  private readonly maxTokens: number;
  private readonly refillRate: number; // tokens per ms
  private lastRefill: number;

  constructor(maxTokensPerMinute: number) {
    this.maxTokens = maxTokensPerMinute;
    this.tokens = maxTokensPerMinute;
    this.refillRate = maxTokensPerMinute / 60_000; // per ms
    this.lastRefill = Date.now();
  }

  /** Try to consume one token. Returns true if allowed, false if rate-limited. */
  tryConsume(): boolean {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    this.tokens = Math.min(this.maxTokens, this.tokens + elapsed * this.refillRate);
    this.lastRefill = now;
  }
}

export class NvidiaTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`NVIDIA API did not respond within ${timeoutMs}ms`);
    this.name = 'NvidiaTimeoutError';
  }
}

function withTimeout<T>(fn: (signal: AbortSignal) => Promise<T>, timeoutMs: number = NVIDIA_TIMEOUT_MS): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  return fn(controller.signal).then(
    (result) => { clearTimeout(timer); return result; },
    (err) => {
      clearTimeout(timer);
      if (controller.signal.aborted) {
        throw new NvidiaTimeoutError(timeoutMs);
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

// ── Brain Region (isolated key pool) ─────────────────────────────────────────

type BrainRegionName = 'frontal' | 'hippocampus' | 'cerebellum' | 'reserve';

class BrainRegion {
  readonly name: BrainRegionName;
  private clients: OpenAI[] = [];
  private currentIndex: number = 0;
  // Per-key cooldown: when a key hits 429/403, it's cooled for this many ms
  // before it's eligible again. This prevents burning retries on a key that's
  // clearly rate-limited or dead — skip it and move on.
  private cooldowns: Map<number, number> = new Map();
  private static readonly COOLDOWN_429_MS = 60_000;   // 60s for rate limit (429)
  private static readonly COOLDOWN_403_MS = 2 * 60_000; // 2min for 403 (may be model access issue, not dead key)
  private static readonly COOLDOWN_403_MODEL_ACCESS_MS = 60_000; // 1min if 403 looks like model access
  private rateLimiter: TokenBucket;
  private static readonly RPM_LIMIT = 50; // 50 RPM per key (headroom below NVIDIA's 60 RPM free tier)

  constructor(name: BrainRegionName, keys: string[]) {
    this.name = name;
    if (keys.length === 0) {
      this.clients.push(new OpenAI({ apiKey: 'dummy_key', baseURL: config.nvidia.baseUrl, maxRetries: 0 }));
    } else {
      this.clients = keys.map(apiKey => new OpenAI({
        apiKey,
        baseURL: config.nvidia.baseUrl,
        maxRetries: 0
      }));
    }
    // Rate limit per-key: each key gets its own bucket at 50 RPM
    this.rateLimiter = new TokenBucket(BrainRegion.RPM_LIMIT * this.clients.length);
    logger.info(`[Brain:${name}] Initialized with ${this.clients.length} key(s) [RPM limit: ${BrainRegion.RPM_LIMIT}/key]`);
  }

  get keyCount(): number { return this.clients.length; }

  /**
   * Execute an operation using this region's key(s).
   * If a key hits 403/429/5xx/timeout, rotates to the next key in this region.
   * Keys that recently failed are placed on cooldown so they're skipped entirely
   * instead of burning a retry on a known-bad key.
   */
  async execute<T>(operation: (client: OpenAI, signal: AbortSignal, attempt: number) => Promise<T>): Promise<T> {
    let lastError: any = null;
    const total = this.clients.length;
    const now = Date.now();

    // Build the rotation order once, starting at the current index.
    const order: number[] = [];
    for (let i = 0; i < total; i++) {
      order.push((this.currentIndex + i) % total);
    }
    this.currentIndex = (this.currentIndex + 1) % total;

    for (let attempt = 0; attempt < total; attempt++) {
      const keyIdx = order[attempt];

      // Skip keys currently on cooldown (rate-limited / dead) — move on to the next.
      const cooldownUntil = this.cooldowns.get(keyIdx) ?? 0;
      if (now < cooldownUntil) {
        logger.debug(`[Brain:${this.name}] Key ${keyIdx} on cooldown, skipping`, {
          remainingMs: cooldownUntil - now,
        });
        continue;
      }

      // Rate limit check — if bucket empty, skip this key (treat like cooldown)
      if (!this.rateLimiter.tryConsume()) {
        logger.debug(`[Brain:${this.name}] Key ${keyIdx} rate limit bucket empty, skipping`);
        continue;
      }

      try {
        const client = this.clients[keyIdx];
        const result = await withTimeout((signal) => operation(client, signal, attempt));
        // Success — clear any lingering cooldown for this key.
        this.cooldowns.delete(keyIdx);
        return result;
      } catch (err: any) {
        lastError = err;
        const isRetryable = err.status === 403 || err.status === 429 || err.status >= 500 || err.name === 'NvidiaTimeoutError';
        if (!isRetryable) throw err;

        this.setCooldown(keyIdx, err.status, err.message);

        const reason = err.status === 403
          ? 'dead/disabled (403)'
          : err.status === 429
            ? 'rate-limited (429)'
            : `error ${err.status}`;
        logger.warn(`[Brain:${this.name}] Key ${keyIdx} failed (${attempt + 1}/${total}), rotating — ${reason}`, {
          status: err.status,
          error: err.message,
          cooldownMs: this.getCooldownMs(err.status),
        });
      }
    }

    // If every key was on cooldown (nothing failed this call, nothing succeeded),
    // surface a clear error instead of throwing null.
    if (!lastError) {
      const err = new Error(`[Brain:${this.name}] All ${total} key(s) on cooldown — no available key`);
      err.name = 'AllKeysCoolingDownError';
      logger.error(err.message);
      throw err;
    }
    throw lastError;
  }

  private setCooldown(keyIdx: number, status: number, errorMessage?: string): void {
    const ms = this.getCooldownMs(status, errorMessage);
    this.cooldowns.set(keyIdx, Date.now() + ms);
  }

  private getCooldownMs(status: number, errorMessage?: string): number {
    if (status === 429) return BrainRegion.COOLDOWN_429_MS;
    if (status === 403) {
      // Check if 403 is likely a model access issue (not dead key)
      // Model access 403s typically mention "model" or "access" in the message
      const msg = (errorMessage || '').toLowerCase();
      if (msg.includes('model') || msg.includes('access') || msg.includes('permission') || msg.includes('not found')) {
        return BrainRegion.COOLDOWN_403_MODEL_ACCESS_MS; // 1 min - might recover
      }
      return BrainRegion.COOLDOWN_403_MS; // 2 min - likely key issue
    }
    return 30_000; // 5xx/timeout: 30s cooldown
  }
}

// ── Brain Key Router ─────────────────────────────────────────────────────────

class BrainKeyRouter {
  readonly frontal: BrainRegion;      // Key 1 — user-facing replies
  readonly hippocampus: BrainRegion;  // Key 2 — memory & learning
  readonly cerebellum: BrainRegion;   // Key 3 — background tasks
  readonly reserve: BrainRegion;      // Key 4 — emergency failover

  constructor() {
    // Collect all available keys
    const allKeys = [
      config.nvidia.apiKey,
      config.nvidia.apiKey2,
      config.nvidia.apiKey3,
      config.nvidia.apiKey4,
      (config.nvidia as any).apiKey5 || '',
      (config.nvidia as any).apiKey6 || '',
    ].filter(k => k && k.trim() !== '' && k !== 'dummy_key');

    logger.info(`[BrainKeyRouter] ${allKeys.length} NVIDIA API key(s) available`);

    if (allKeys.length >= 4) {
      // Full brain: frontal (user-facing replies) gets ALL keys — the highest priority
      // operation must never fail on a single key's rate limit or outage. Other regions
      // keep dedicated keys; reserve keeps its own + frontal's primary as a final fallback.
      this.frontal     = new BrainRegion('frontal',     [...allKeys]);
      this.hippocampus = new BrainRegion('hippocampus', [allKeys[1]]);
      this.cerebellum  = new BrainRegion('cerebellum',  [allKeys[2]]);
      this.reserve     = new BrainRegion('reserve',     [allKeys[3], allKeys[0]]);

      // If extra keys exist (5, 6, ...), add them to the reserve pool for extra resilience
      if (allKeys.length > 4) {
        const extraKeys = allKeys.slice(4);
        logger.info(`[BrainKeyRouter] ${extraKeys.length} extra key(s) added to reserve pool`);
        // Recreate reserve with all extra keys + key 4 + key 1 (frontal's primary)
        (this as any).reserve = new BrainRegion('reserve', [allKeys[3], allKeys[0], ...extraKeys]);
      }
    } else if (allKeys.length === 3) {
      // 3 keys: frontal gets dedicated, hippocampus+cerebellum share, reserve = frontal backup
      this.frontal     = new BrainRegion('frontal',     [allKeys[0]]);
      this.hippocampus = new BrainRegion('hippocampus', [allKeys[1]]);
      this.cerebellum  = new BrainRegion('cerebellum',  [allKeys[2]]);
      this.reserve     = new BrainRegion('reserve',     [allKeys[2]]); // shares with cerebellum
    } else if (allKeys.length === 2) {
      // 2 keys: frontal gets dedicated, everything else shares key 2
      this.frontal     = new BrainRegion('frontal',     [allKeys[0]]);
      this.hippocampus = new BrainRegion('hippocampus', [allKeys[1]]);
      this.cerebellum  = new BrainRegion('cerebellum',  [allKeys[1]]);
      this.reserve     = new BrainRegion('reserve',     [allKeys[1]]);
    } else {
      // 1 or 0 keys: everything shares (degraded mode — original behavior)
      const pool = allKeys.length > 0 ? allKeys : ['dummy_key'];
      this.frontal     = new BrainRegion('frontal',     pool);
      this.hippocampus = new BrainRegion('hippocampus', pool);
      this.cerebellum  = new BrainRegion('cerebellum',  pool);
      this.reserve     = new BrainRegion('reserve',     pool);
    }

    logger.info(`[BrainKeyRouter] Architecture: frontal=${this.frontal.keyCount} hippocampus=${this.hippocampus.keyCount} cerebellum=${this.cerebellum.keyCount} reserve=${this.reserve.keyCount}`);
  }
}

const brain = new BrainKeyRouter();

// ── Payload Builder ──────────────────────────────────────────────────────────

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

// ── Internal executor (region + optional failover) ───────────────────────────

async function executeWithFailover(
  primary: BrainRegion,
  fallback: BrainRegion | null,
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  options?: ChatOptions,
): Promise<string> {
  const run = async (region: BrainRegion) => {
    return region.execute(async (client, signal, attempt) => {
      const payload = buildPayload(messages, options, attempt);
      const response = await client.chat.completions.create(payload, { signal });
      const message = response.choices[0]?.message;
      if (message?.tool_calls?.length) {
        return JSON.stringify({ tool_calls: message.tool_calls });
      }
      if (!message?.content) throw new Error('NVIDIA API returned an empty response');
      return message.content;
    });
  };

  try {
    return await run(primary);
  } catch (primaryErr: any) {
    if (fallback && fallback !== primary) {
      logger.warn(`[Brain:${primary.name}] All keys exhausted, failing over to [Brain:${fallback.name}]`, {
        error: primaryErr.message
      });
      try {
        return await run(fallback);
      } catch (fallbackErr: any) {
        logger.error(`[Brain:${fallback.name}] Failover also failed`, { error: fallbackErr.message });
        // Fall through to dev mock or throw
      }
    }

    const isDev = process.env.NODE_ENV === 'development';
    if (isDev) {
      logger.warn('All brain regions failed — returning mock (dev only)', { error: primaryErr.message });
      return getMockResponse(messages, options);
    }
    throw primaryErr;
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * 🗣️ Frontal Cortex — Real-time user-facing chat reply.
 * Uses Key 1 with automatic failover to Key 4 (Reserve).
 * This is the HIGHEST PRIORITY call — the user is waiting for this.
 */
export async function chatCompletion(
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  options?: ChatOptions,
): Promise<string> {
  return executeWithFailover(brain.frontal, brain.reserve, messages, options);
}

/**
 * ⚡ Cerebellum — Background processing tasks.
 * Uses Key 3. No failover — if it fails, background tasks silently skip.
 * Used by: WebSearchService, WeatherWatcher, ResponseIntelligence, proactive triggers.
 */
export async function chatCompletionBackground(
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  options?: ChatOptions,
): Promise<string> {
  return executeWithFailover(brain.cerebellum, null, messages, options);
}

/**
 * 💾 Hippocampus — Learning & self-improvement.
 * Uses Key 2. No failover — learning can retry on the next cycle.
 * Used by: NovaSelfImprovementService, NovaRealtimeLearningService.
 */
export async function chatCompletionLearning(
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  options?: ChatOptions,
): Promise<string> {
  return executeWithFailover(brain.hippocampus, null, messages, options);
}

/**
 * 🧩 Hippocampus — Memory extraction & agent work.
 * Uses Key 2. No failover — memory extraction can retry later.
 * Used by: All 7 memory agents (Working, ShortTerm, Episodic, Emotional, KG, Semantic, Reflection, Milestone).
 */
export async function chatCompletionMemory(
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  options?: ChatOptions,
): Promise<string> {
  return executeWithFailover(brain.hippocampus, null, messages, options);
}

/**
 * 🧠 Deep Cortex — For complex, emotional, or multi-step reasoning.
 * Uses the 49B deep model with frontal+reserve failover.
 * Called only when the message is classified as needing deeper thought.
 */
export async function chatCompletionDeep(
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  options?: ChatOptions,
): Promise<string> {
  const deepOptions = { ...options, model: config.nvidia.deepModel };
  return executeWithFailover(brain.frontal, brain.reserve, messages, deepOptions);
}

/**
 * 🗣️ Frontal Cortex — Streaming chat reply.
 * Uses Key 1 with failover to Key 4 (Reserve) for the initial connection.
 */
export async function* chatCompletionStream(
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  options?: ChatOptions,
): AsyncGenerator<string, void, unknown> {
  
  const payload = buildPayload(messages, options, 0);
  payload.stream = true;

  // Try frontal first, then reserve
  let stream: any;
  try {
    stream = await brain.frontal.execute(async (client, signal) => {
      return await client.chat.completions.create(payload, { signal }) as any;
    });
  } catch (frontalErr: any) {
    logger.warn(`[Brain:frontal] Streaming failed, falling over to reserve`, { error: frontalErr.message });
    try {
      stream = await brain.reserve.execute(async (client, signal) => {
        return await client.chat.completions.create(payload, { signal }) as any;
      });
    } catch (reserveErr: any) {
      logger.error('[Brain:reserve] Streaming failover also failed', { error: reserveErr.message });
      throw reserveErr;
    }
  }

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
}
