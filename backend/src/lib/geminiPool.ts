import { logger } from './logger';

export class GeminiPool {
  private keys: string[] = [];
  private currentIndex: number = 0;

  constructor() {
    this.refreshKeys();
  }

  /**
   * Loads keys from GEMINI_API_KEY and GEMINI_API_KEYS (comma separated)
   */
  public refreshKeys() {
    const keySet = new Set<string>();
    
    // Add primary key if exists
    if (process.env.GEMINI_API_KEY) {
      keySet.add(process.env.GEMINI_API_KEY.trim());
    }

    // Add keys from comma-separated list
    if (process.env.GEMINI_API_KEYS) {
      const keys = process.env.GEMINI_API_KEYS.split(',').map(k => k.trim()).filter(k => k.length > 0);
      keys.forEach(k => keySet.add(k));
    }

    this.keys = Array.from(keySet);
    if (this.keys.length > 0) {
      logger.info(`[GeminiPool] Initialized with ${this.keys.length} API key(s).`);
    } else {
      logger.warn('[GeminiPool] No Gemini API keys found in environment variables.');
    }
  }

  /**
   * Returns the next API key in a round-robin fashion.
   * Returns null if no keys are available.
   */
  public getNextKey(): string | null {
    if (this.keys.length === 0) return null;
    
    const key = this.keys[this.currentIndex];
    this.currentIndex = (this.currentIndex + 1) % this.keys.length;
    return key;
  }

  public hasKeys(): boolean {
    return this.keys.length > 0;
  }
}

export const geminiPool = new GeminiPool();
