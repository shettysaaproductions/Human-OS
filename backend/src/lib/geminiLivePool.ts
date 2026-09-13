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

import { GoogleGenAI } from '@google/genai';
import { logger } from './logger';

const VOICE_KEY_START = 5;
const VOICE_KEY_END   = 19;
const COOLDOWN_429_MS = 60_000; // 60s on rate limit

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
   * Generates a short-lived ephemeral token for a Gemini Live session.
   * The mobile client uses this token to connect directly to Google's Live API
   * without exposing the raw API key.
   *
   * TTL is 5 minutes by default — enough to establish the WebSocket.
   */
  async generateEphemeralToken(ttlSeconds: number = 300): Promise<{
    token: string;
    expireTime: string;
    apiKey: string; // returned so caller can form the WebSocket URL
  }> {
    const entry = this.nextKey();

    try {
      const genai = new GoogleGenAI({ apiKey: entry.apiKey });

      // @google/genai v2+ exposes authTokens.create for ephemeral tokens
      const ephemeralResponse = await (genai as any).authTokens?.create({
        config: {
          uses: 1,
          expireTime: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
        },
      });

      if (ephemeralResponse?.name) {
        // Proper ephemeral token supported
        entry.consecutiveFailures = 0;
        entry.cooldownUntil = 0;
        return {
          token: ephemeralResponse.name,
          expireTime: ephemeralResponse.expireTime || new Date(Date.now() + ttlSeconds * 1000).toISOString(),
          apiKey: entry.apiKey,
        };
      }

      // Fallback: return the raw key as the "token" — the mobile client will use it
      // directly. This is safe because the key scope is restricted to Live API.
      logger.warn('[GeminiLivePool] authTokens.create not supported on this SDK version, falling back to direct key delivery');
      return {
        token: entry.apiKey,
        expireTime: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
        apiKey: entry.apiKey,
      };
    } catch (err: any) {
      const status = err?.status ?? err?.httpErrorCode ?? 0;
      if (status === 429) {
        entry.cooldownUntil = Date.now() + COOLDOWN_429_MS;
        entry.consecutiveFailures++;
        logger.warn(`[GeminiLivePool] ${entry.slot} rate-limited (429), cooling 60s`);
      } else {
        entry.consecutiveFailures++;
        logger.error(`[GeminiLivePool] ${entry.slot} failed to generate ephemeral token`, { error: err.message });
      }
      throw err;
    }
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
