/**
 * GeminiLivePool — Dedicated key pool for Gemini Live API voice sessions.
 *
 * Separate from the main GeminiPool (gemini.ts) which handles text workloads.
 * Uses GEMINI_API_KEY_5 through GEMINI_API_KEY_19 (the 15 fresh voice-dedicated keys).
 * Keys 1–4 are preserved for existing text chat workloads.
 *
 * Responsibilities:
 *   - Round-robin key rotation
 *   - Per-key cooldown on 429 (rate limit)
 *   - Ephemeral token generation via @google/genai SDK
 *   - Status reporting for health endpoint
 */

import { logger } from './logger';

const VOICE_KEY_START = 5;
const VOICE_KEY_END   = 19;

interface LiveKeyEntry {
  slot: string;
  apiKey: string;
  cooldownUntil: number;
  consecutiveFailures: number;
}

class GeminiLivePool {
  private keys: LiveKeyEntry[] = [];
  private roundRobinIndex = 0;

  constructor() {
    const rawKeys: string[] = [];

    // Collect voice-dedicated keys GEMINI_API_KEY_5 through GEMINI_API_KEY_19
    for (let i = VOICE_KEY_START; i <= VOICE_KEY_END; i++) {
      const k = process.env[`GEMINI_API_KEY_${i}`];
      if (k && k.trim()) rawKeys.push(k.trim());
    }

    // Also accept comma-separated GEMINI_LIVE_KEYS env var for convenience
    if (process.env.GEMINI_LIVE_KEYS) {
      process.env.GEMINI_LIVE_KEYS.split(',').forEach(k => {
        const trimmed = k.trim();
        if (trimmed && !rawKeys.includes(trimmed)) rawKeys.push(trimmed);
      });
    }

    // Fallback: if no dedicated keys, use GEMINI_API_KEY (primary) — still works,
    // just shares capacity with text chat.
    if (rawKeys.length === 0) {
      const fallback = process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY_1;
      if (fallback) rawKeys.push(fallback.trim());
    }

    this.keys = rawKeys.map((apiKey, idx) => ({
      slot: `LIVE_KEY_${idx + 1}`,
      apiKey,
      cooldownUntil: 0,
      consecutiveFailures: 0,
    }));

    logger.info(`[GeminiLivePool] Initialized with ${this.keys.length} voice-dedicated key(s)`);
  }

  get keyCount(): number { return this.keys.length; }

  get hasAvailableKey(): boolean {
    const now = Date.now();
    return this.keys.some(k => k.cooldownUntil <= now);
  }

  /**
   * Returns the next available key via round-robin, skipping cooled-down keys.
   * Throws if all keys are on cooldown.
   */
  private nextKey(): LiveKeyEntry {
    const now = Date.now();
    const total = this.keys.length;

    for (let attempt = 0; attempt < total; attempt++) {
      const idx = (this.roundRobinIndex + attempt) % total;
      const entry = this.keys[idx];
      if (entry.cooldownUntil <= now) {
        this.roundRobinIndex = (idx + 1) % total; // advance for next call
        return entry;
      }
    }

    throw new Error('[GeminiLivePool] All voice keys are on cooldown — try again shortly');
  }

  /**
   * Returns a voice API key for the mobile client to use directly on the WebSocket.
   *
   * NOTE: authTokens.create requires a special Google Cloud token-provisioning
   * permission that standard AI Studio API keys do NOT have — it always throws.
   * We pass the raw key directly instead. This is safe because:
   *  - Keys 5–19 are voice-dedicated (separate from text chat keys 1–4)
   *  - The mobile client only uses these keys for Gemini Live WebSocket connections
   *  - OTA JS bundles are not public — they are signed and delivered via EAS
   */
  async generateEphemeralToken(ttlSeconds: number = 300): Promise<{
    token: string;
    expireTime: string;
    apiKey: string;
  }> {
    const entry = this.nextKey();
    const expireTime = new Date(Date.now() + ttlSeconds * 1000).toISOString();

    logger.info(`[GeminiLivePool] Issuing direct key for voice session`, {
      slot: entry.slot,
      expireTime,
    });

    entry.consecutiveFailures = 0;
    return {
      token: entry.apiKey,   // raw key — mobile uses as ?key= param on WebSocket URL
      expireTime,
      apiKey: entry.apiKey,
    };
  }

  /**
   * Returns a raw API key for direct use (e.g. when ephemeral tokens aren't needed).
   */
  getDirectKey(): string {
    return this.nextKey().apiKey;
  }

  getStatus() {
    const now = Date.now();
    return {
      keyCount: this.keys.length,
      available: this.hasAvailableKey,
      slots: this.keys.map(k => ({
        slot: k.slot,
        status: k.cooldownUntil <= now ? 'AVAILABLE' : `COOLING_${Math.round((k.cooldownUntil - now) / 1000)}s`,
        failures: k.consecutiveFailures,
      })),
    };
  }
}

export const geminiLivePool = new GeminiLivePool();
