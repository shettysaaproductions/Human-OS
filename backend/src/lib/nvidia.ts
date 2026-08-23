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

  /** Check if tokens are available without consuming them */
  hasTokens(): boolean {
    this.refill();
    return this.tokens >= 1;
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

/**
 * Runtime capabilities are the only supported way for production code to select
 * an NVIDIA model/brain region.  They intentionally describe the work, never a
 * key or client.  BrainKeyRouter remains the sole key-management authority.
 */
export type RoutingProfile =
  | 'USER_FAST'
  | 'USER_DEEP'
  | 'SUBCONSCIOUS'
  | 'MEMORY'
  | 'LEARNING'
  | 'PROACTIVE'
  | 'CRITICAL_ACTION'
  | 'TIMEOUT_FALLBACK';

export interface RoutingDecision {
  profile: RoutingProfile;
  region: BrainRegionName;
  model: string;
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

type BrainRegionName = 'frontal' | 'hippocampus' | 'cerebellum' | 'deepCortex' | 'reserve';

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
  
  public activeRequests: number = 0;
  public reservedRequests: number = 0;

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

  get availableCapacity(): boolean {
    const now = Date.now();
    for (let i = 0; i < this.clients.length; i++) {
      if ((this.cooldowns.get(i) ?? 0) <= now) {
        if (this.rateLimiter.hasTokens()) return true;
      }
    }
    return false;
  }

  get totalUtilization(): number {
    return this.activeRequests + this.reservedRequests;
  }

  /**
   * Execute an operation using this region's key(s).
   * If a key hits 403/429/5xx/timeout, rotates to the next key in this region.
   * Keys that recently failed are placed on cooldown so they're skipped entirely
   * instead of burning a retry on a known-bad key.
   */
  async execute<T>(operation: (client: OpenAI, signal: AbortSignal, attempt: number) => Promise<T>): Promise<T> {
    this.activeRequests++;
    try {
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
    } finally {
      this.activeRequests = Math.max(0, this.activeRequests - 1);
    }
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
// Maps NVIDIA API keys to dedicated brain regions so no single region can
// starve another. With 15 keys the full architecture is:
//
//  ┌─────────────────────────────────────────────────────────────────────────┐
//  │  🧠  N O V A ' S   1 5 - K E Y   B R A I N   A R C H I T E C T U R E  │
//  ├────────────────┬────────────────────────────────────────────────────────┤
//  │ Frontal Cortex │ Keys 1,5,6,7,8  — Real-time chat (user-facing) ×5     │
//  │ Hippocampus    │ Keys 2,9,10     — Memory agents & learning ×3         │
//  │ Cerebellum     │ Keys 3,11,12    — Background engines (NACE/weather) ×3│
//  │ Deep Cortex    │ Keys 13,14      — Reflection, reasoning ×2            │
//  │ Reserve        │ Keys 4,15       — Emergency failover ×2               │
//  └────────────────┴────────────────────────────────────────────────────────┘
//
// With 4 keys: frontal=all4, hippocampus=key2, cerebellum=key3, reserve=key4+key1
// With 1-3 keys: degraded mode (shared pool)

class BrainKeyRouter {
  readonly frontal: BrainRegion;      // User-facing replies — HIGHEST PRIORITY
  readonly hippocampus: BrainRegion;  // Memory extraction & learning
  readonly cerebellum: BrainRegion;   // Background engines (NACE, weather, search)
  readonly deepCortex: BrainRegion;   // Reflection, weekly synthesis, deep reasoning
  readonly reserve: BrainRegion;      // Emergency failover

  constructor() {
    // Collect all available keys in order
    const allKeys = [
      config.nvidia.apiKey,
      config.nvidia.apiKey2,
      config.nvidia.apiKey3,
      config.nvidia.apiKey4,
      (config.nvidia as any).apiKey5  || '',
      (config.nvidia as any).apiKey6  || '',
      (config.nvidia as any).apiKey7  || '',
      (config.nvidia as any).apiKey8  || '',
      (config.nvidia as any).apiKey9  || '',
      (config.nvidia as any).apiKey10 || '',
      (config.nvidia as any).apiKey11 || '',
      (config.nvidia as any).apiKey12 || '',
      (config.nvidia as any).apiKey13 || '',
      (config.nvidia as any).apiKey14 || '',
      (config.nvidia as any).apiKey15 || '',
    ].filter(k => k && k.trim() !== '' && k !== 'dummy_key');

    const n = allKeys.length;
    logger.info(`[BrainKeyRouter] ${n} NVIDIA API key(s) available`);

    if (n >= 10) {
      // ── 10–15 keys: Full 5-region architecture ────────────────────────────
      // Split: frontal gets ~40%, hippocampus+cerebellum get ~20% each,
      //        deepCortex ~15%, reserve ~15%.
      const frontalKeys    = allKeys.slice(0, Math.ceil(n * 0.4));            // keys 1..~6
      const hippocampusKeys = allKeys.slice(Math.ceil(n * 0.4), Math.ceil(n * 0.6)); // ~keys 7-9
      const cerebellumKeys  = allKeys.slice(Math.ceil(n * 0.6), Math.ceil(n * 0.75)); // ~keys 10-11
      const deepCortexKeys  = allKeys.slice(Math.ceil(n * 0.75), Math.ceil(n * 0.9)); // ~keys 12-13
      const reserveKeys     = allKeys.slice(Math.ceil(n * 0.9));                      // ~keys 14-15

      this.frontal     = new BrainRegion('frontal',     frontalKeys);
      this.hippocampus = new BrainRegion('hippocampus', hippocampusKeys.length > 0 ? hippocampusKeys : [allKeys[1]]);
      this.cerebellum  = new BrainRegion('cerebellum',  cerebellumKeys.length > 0 ? cerebellumKeys : [allKeys[2]]);
      this.deepCortex  = new BrainRegion('deepCortex',  deepCortexKeys.length > 0 ? deepCortexKeys  : [allKeys[n-2]]);
      this.reserve     = new BrainRegion('reserve',     reserveKeys.length > 0 ? reserveKeys : [allKeys[n-1]]);

    } else if (n >= 4) {
      // ── 4–9 keys: 4-region architecture (original + deepCortex) ──────────
      // Frontal gets the bulk of keys; hippocampus/cerebellum get one each;
      // deepCortex shares the last key; reserve gets key4 + key1 as failover.
      const extraKeys = allKeys.slice(4);
      this.frontal     = new BrainRegion('frontal',     [allKeys[0], ...extraKeys.slice(0, Math.ceil(extraKeys.length / 2))]);
      this.hippocampus = new BrainRegion('hippocampus', [allKeys[1]]);
      this.cerebellum  = new BrainRegion('cerebellum',  [allKeys[2]]);
      this.deepCortex  = new BrainRegion('deepCortex',  extraKeys.length > Math.ceil(extraKeys.length / 2)
        ? extraKeys.slice(Math.ceil(extraKeys.length / 2))
        : [allKeys[3]]);
      this.reserve     = new BrainRegion('reserve',     [allKeys[3], allKeys[0]]);

    } else if (n === 3) {
      this.frontal     = new BrainRegion('frontal',     [allKeys[0]]);
      this.hippocampus = new BrainRegion('hippocampus', [allKeys[1]]);
      this.cerebellum  = new BrainRegion('cerebellum',  [allKeys[2]]);
      this.deepCortex  = new BrainRegion('deepCortex',  [allKeys[2]]);
      this.reserve     = new BrainRegion('reserve',     [allKeys[2]]);
    } else if (n === 2) {
      this.frontal     = new BrainRegion('frontal',     [allKeys[0]]);
      this.hippocampus = new BrainRegion('hippocampus', [allKeys[1]]);
      this.cerebellum  = new BrainRegion('cerebellum',  [allKeys[1]]);
      this.deepCortex  = new BrainRegion('deepCortex',  [allKeys[1]]);
      this.reserve     = new BrainRegion('reserve',     [allKeys[1]]);
    } else {
      // 1 or 0 keys: degraded mode — everything shares
      const pool = n > 0 ? allKeys : ['dummy_key'];
      this.frontal     = new BrainRegion('frontal',     pool);
      this.hippocampus = new BrainRegion('hippocampus', pool);
      this.cerebellum  = new BrainRegion('cerebellum',  pool);
      this.deepCortex  = new BrainRegion('deepCortex',  pool);
      this.reserve     = new BrainRegion('reserve',     pool);
    }

    logger.info(
      `[BrainKeyRouter] Architecture: ` +
      `frontal=${this.frontal.keyCount} ` +
      `hippocampus=${this.hippocampus.keyCount} ` +
      `cerebellum=${this.cerebellum.keyCount} ` +
      `deepCortex=${this.deepCortex.keyCount} ` +
      `reserve=${this.reserve.keyCount} ` +
      `(total=${n})`
    );
  }
}

const brain = new BrainKeyRouter();

/** Cheap, deterministic user-message routing. No network or database access. */
export function determineUserProfile(message: string): RoutingProfile {
  const text = message.trim();
  const lower = text.toLowerCase();
  const words = text.split(/\s+/).filter(Boolean);

  // Reflexes and acknowledgements should never consume the deep pool.
  if (text.length < 24 || /^(hi+|hello|hey+|ok(ay)?|hmm|hm|thanks|thx|yes|no|bye|gn|lol|haha|😂|👍|❤️)$/i.test(text)) {
    return 'USER_FAST';
  }

  const explicitDeep = /\b(analy[sz]e|analysis|compare|trade[- ]?off|explain (why|how|in detail)|step[- ]by[- ]step|strategy|diagnos[ei]s|evaluate|pros and cons|decision framework)\b/i.test(lower);
  const emotionalSupport = /\b(depressed|panic|anxious|heartbreak|suicid|self harm|overwhelmed|crying)\b/i.test(lower);
  const questionCount = (text.match(/[?]/g) || []).length;
  const enumeratedRequests = (text.match(/(?:^|\n|\s)(?:\d+[.)]|[-•])/g) || []).length;
  const multiStep = /\b(first|then|after that|before that|next|also|and then|if .* then)\b/i.test(lower);

  // Length alone is deliberately conservative: a long story is not automatically
  // deep reasoning. It needs another reasoning/ambiguity signal to escalate.
  const longAndDemanding = words.length > 90 && (questionCount > 0 || multiStep || explicitDeep);
  const operationHeavy = (questionCount >= 2 && words.length > 35) || enumeratedRequests >= 2 || (multiStep && words.length > 45);

  return explicitDeep || emotionalSupport || longAndDemanding || operationHeavy
    ? 'USER_DEEP'
    : 'USER_FAST';
}

export function resolveRoutingProfile(profile: RoutingProfile): RoutingDecision {
  switch (profile) {
    case 'USER_DEEP':
      return { profile, region: 'deepCortex', model: config.nvidia.deepModel };
    case 'MEMORY':
      return { profile, region: 'hippocampus', model: EXTRACTION_MODEL };
    case 'LEARNING':
      return { profile, region: 'hippocampus', model: config.nvidia.chatModel };
    case 'SUBCONSCIOUS':
    case 'CRITICAL_ACTION':
    case 'TIMEOUT_FALLBACK':
      return { profile, region: 'cerebellum', model: EXTRACTION_MODEL };
    case 'PROACTIVE':
      return { profile, region: 'cerebellum', model: config.nvidia.chatModel };
    case 'USER_FAST':
      return { profile, region: 'frontal', model: config.nvidia.chatModel };
  }
}

/** Safe for public health reporting: no keys, inference, or provider probes. */
export function getNvidiaRoutingStatus() {
  return {
    configured: brain.frontal.keyCount > 0 && config.nvidia.apiKey !== '',
    regions: {
      frontal: brain.frontal.keyCount,
      hippocampus: brain.hippocampus.keyCount,
      cerebellum: brain.cerebellum.keyCount,
      deepCortex: brain.deepCortex.keyCount,
      reserve: brain.reserve.keyCount,
    },
  };
}

function getRegion(name: BrainRegionName): BrainRegion {
  return brain[name];
}

function getFallback(name: BrainRegionName): BrainRegion | null {
  return name === 'frontal' || name === 'deepCortex' ? brain.reserve : null;
}

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

export async function complete(
  profile: RoutingProfile,
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  options?: Omit<ChatOptions, 'model'>,
): Promise<string> {
  const decision = resolveRoutingProfile(profile);
  logger.info('[NVIDIA] Routing completion', {
    profile: decision.profile,
    region: decision.region,
    model: decision.model,
    streaming: false,
  });
  return executeWithFailover(getRegion(decision.region), getFallback(decision.region), messages, {
    ...options,
    model: decision.model,
  });
}

/**
 * 🗣️ Frontal Cortex — Real-time user-facing chat reply.
 * Uses Key 1 with automatic failover to Key 4 (Reserve).
 * This is the HIGHEST PRIORITY call — the user is waiting for this.
 */
export async function chatCompletion(
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  options?: ChatOptions,
): Promise<string> {
  // Legacy compatibility only. Production callers should use complete(USER_FAST, ...).
  return complete('USER_FAST', messages, options);
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
  return complete('PROACTIVE', messages, options);
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
  return complete('LEARNING', messages, options);
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
  return complete('MEMORY', messages, options);
}

/**
 * 🧠 Deep Cortex — Reflection, weekly synthesis, complex life reasoning.
 * Uses dedicated deep cortex keys (Keys 13-14) with reserve failover.
 * Called by: ReflectionEngine, weekly insight synthesis, complex multi-step reasoning.
 * Also used by chatCompletionDeep when the deep cortex pool is available.
 */
export async function chatCompletionDeep(
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  options?: ChatOptions,
): Promise<string> {
  return complete('USER_DEEP', messages, options);
}

/**
 * 🗣️ Frontal Cortex — Streaming chat reply.
 * Uses Key 1 with failover to Key 4 (Reserve) for the initial connection.
 */
export async function* chatCompletionStream(
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  options?: ChatOptions,
): AsyncGenerator<string, void, unknown> {
  yield* stream('USER_FAST', messages, options);
}

export async function* stream(
  profile: RoutingProfile,
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  options?: Omit<ChatOptions, 'model'>,
): AsyncGenerator<string, void, unknown> {
  const decision = resolveRoutingProfile(profile);
  logger.info('[NVIDIA] Routing stream', {
    profile: decision.profile,
    region: decision.region,
    model: decision.model,
    streaming: true,
  });
  const payload = buildPayload(messages, { ...options, model: decision.model }, 0);
  payload.stream = true;

  const primary = getRegion(decision.region);
  const fallback = getFallback(decision.region);
  let stream: any;
  try {
    stream = await primary.execute(async (client, signal) => {
      return await client.chat.completions.create(payload, { signal }) as any;
    });
  } catch (frontalErr: any) {
    if (!fallback) throw frontalErr;
    logger.warn(`[Brain:${primary.name}] Streaming failed, falling over to reserve`, { error: frontalErr.message });
    try {
      stream = await fallback.execute(async (client, signal) => {
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

// ── Capability-Aware Scheduler API ──────────────────────────────────────────

/**
 * Advisory check to see if a routing profile can be executed right now.
 * Priority: 0 = interactive (highest), >0 = background (yields under load).
 */
export function canRunNvidia(profile: RoutingProfile, priority: number = 0): boolean {
  const decision = resolveRoutingProfile(profile);
  const region = getRegion(decision.region);
  
  if (priority > 0) {
    // Background workloads yield to interactive work by leaving concurrency headroom
    const maxBackgroundConcurrency = Math.max(1, region.keyCount * 2);
    if (region.totalUtilization >= maxBackgroundConcurrency) {
      return false;
    }
  }
  
  return region.availableCapacity;
}

/** Reserve capacity ahead of execution to prevent thundering herd in background queues */
export function reserveNvidiaCapacity(profile: RoutingProfile): void {
  const decision = resolveRoutingProfile(profile);
  getRegion(decision.region).reservedRequests++;
}

/** Release ahead-of-time capacity reservations (MUST be called in finally) */
export function releaseNvidiaCapacity(profile: RoutingProfile): void {
  const decision = resolveRoutingProfile(profile);
  const region = getRegion(decision.region);
  region.reservedRequests = Math.max(0, region.reservedRequests - 1);
}
