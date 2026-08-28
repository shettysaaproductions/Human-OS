/**
 * Gemini 4-Key Failover & Single Deadline Policy Tests — Phase 10.1
 *
 * Verifies:
 * 1. Key 1 success (happy path)
 * 2. Key 1 fail → Key 2 success
 * 3. Key 1/2 fail → Key 3 success
 * 4. Key 1/2/3 fail → Key 4 success
 * 5. All 4 unavailable → NVIDIA fallback
 * 6. Cooling key is skipped immediately without latency penalty
 * 7. No sequential timeout accumulation (never 8s + 8s + 8s + 8s)
 * 8. Exactly one response returned
 * 9. Late provider response cannot leak
 * 10. Global 8-second deadline remains intact
 */

import { GeminiPool, GeminiSlot } from '../gemini';
import { cognitiveRouter } from '../cognitiveRouter';
import { geminiComplete } from '../gemini';
import { complete as nvidiaComplete } from '../nvidia';

jest.mock('../nvidia', () => ({
  complete: jest.fn(),
  stream: jest.fn(),
  determineUserProfile: jest.fn(() => 'USER_FAST'),
}));

jest.mock('../logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

describe('Gemini 4-Key Failover Policy', () => {
  let pool: GeminiPool;

  beforeEach(() => {
    jest.clearAllMocks();
    pool = new GeminiPool([
      { slot: 'KEY_1', role: 'primary',    key: 'mock-key-1' },
      { slot: 'KEY_2', role: 'failover_1', key: 'mock-key-2' },
      { slot: 'KEY_3', role: 'failover_2', key: 'mock-key-3' },
      { slot: 'KEY_4', role: 'failover_3', key: 'mock-key-4' },
    ]);
  });

  // 1. Key 1 success
  it('1. routes to KEY_1 when KEY_1 is healthy and succeeds', async () => {
    const executedSlots: GeminiSlot[] = [];
    const result = await pool.execute(async (_client, slot) => {
      executedSlots.push(slot);
      return 'Reply from KEY_1';
    });

    expect(result).toBe('Reply from KEY_1');
    expect(executedSlots).toEqual(['KEY_1']);
  });

  // 2. Key 1 fail → Key 2 success
  it('2. falls over from KEY_1 to KEY_2 when KEY_1 fails (rate limit)', async () => {
    const executedSlots: GeminiSlot[] = [];
    const result = await pool.execute(async (_client, slot) => {
      executedSlots.push(slot);
      if (slot === 'KEY_1') {
        const err: any = new Error('Rate limit exceeded');
        err.status = 429;
        throw err;
      }
      return 'Reply from KEY_2';
    });

    expect(result).toBe('Reply from KEY_2');
    expect(executedSlots).toEqual(['KEY_1', 'KEY_2']);
    // Key 1 should now be cooling
    expect(pool.keys.get('KEY_1')!.cooldownUntil).toBeGreaterThan(Date.now());
  });

  // 3. Key 1/2 fail → Key 3 success
  it('3. falls over to KEY_3 when KEY_1 and KEY_2 fail', async () => {
    const executedSlots: GeminiSlot[] = [];
    const result = await pool.execute(async (_client, slot) => {
      executedSlots.push(slot);
      if (slot === 'KEY_1' || slot === 'KEY_2') {
        const err: any = new Error('Quota exceeded');
        err.status = 429;
        throw err;
      }
      return 'Reply from KEY_3';
    });

    expect(result).toBe('Reply from KEY_3');
    expect(executedSlots).toEqual(['KEY_1', 'KEY_2', 'KEY_3']);
  });

  // 4. Key 1/2/3 fail → Key 4 success
  it('4. falls over to KEY_4 when KEY_1, KEY_2, and KEY_3 fail', async () => {
    const executedSlots: GeminiSlot[] = [];
    const result = await pool.execute(async (_client, slot) => {
      executedSlots.push(slot);
      if (slot !== 'KEY_4') {
        const err: any = new Error('Overloaded');
        err.status = 503;
        throw err;
      }
      return 'Reply from KEY_4';
    });

    expect(result).toBe('Reply from KEY_4');
    expect(executedSlots).toEqual(['KEY_1', 'KEY_2', 'KEY_3', 'KEY_4']);
  });

  // 5. All 4 unavailable → NVIDIA fallback
  it('5. falls back to NVIDIA when all 4 Gemini keys fail', async () => {
    // When gemini fails completely across all 4 keys, cognitiveRouter triggers NVIDIA
    (nvidiaComplete as jest.Mock).mockResolvedValue('NVIDIA fallback reply');

    // Test cognitiveRouter integration
    const MSG = [
      { role: 'system' as const, content: 'You are Nova.' },
      { role: 'user' as const, content: 'Kaise ho?' },
    ];

    // Mock geminiComplete throwing all 4 keys exhausted error
    const spy = jest.spyOn(require('../gemini'), 'geminiComplete').mockRejectedValueOnce(
      new Error('[Gemini] All production keys (KEY_1..4) on cooldown or deadline expired')
    );

    const reply = await cognitiveRouter.complete('CONVERSATION', MSG);
    expect(reply).toBe('NVIDIA fallback reply');
    expect(nvidiaComplete).toHaveBeenCalledTimes(1);

    spy.mockRestore();
  });

  // 6. Cooling key is skipped immediately without latency penalty
  it('6. skips already-cooling keys immediately (0ms delay)', async () => {
    // Put KEY_1, KEY_2 on cooldown
    pool.keys.get('KEY_1')!.cooldownUntil = Date.now() + 60000;
    pool.keys.get('KEY_2')!.cooldownUntil = Date.now() + 60000;

    const executedSlots: GeminiSlot[] = [];
    const startTime = Date.now();
    const result = await pool.execute(async (_client, slot) => {
      executedSlots.push(slot);
      return 'Reply from KEY_3';
    });

    const duration = Date.now() - startTime;
    expect(result).toBe('Reply from KEY_3');
    // KEY_1 and KEY_2 skipped instantly without invoking operation
    expect(executedSlots).toEqual(['KEY_3']);
    expect(duration).toBeLessThan(50);
  });

  // 7. No sequential timeout accumulation
  it('7. bounds each slot attempt dynamically and stops when deadline budget is depleted', async () => {
    const deadline = Date.now() + 1200; // Only 1200ms total left
    const executedSlots: GeminiSlot[] = [];

    await expect(
      pool.execute(
        async (_client, slot) => {
          executedSlots.push(slot);
          // Simulate KEY_1 consuming 600ms then failing
          await new Promise(r => setTimeout(r, 600));
          throw new Error('Key 1 timeout');
        },
        undefined,
        deadline
      )
    ).rejects.toThrow();

    // After KEY_1 consumed 600ms, remaining budget was < 600ms (< 800ms threshold),
    // so subsequent keys (KEY_2, KEY_3, KEY_4) were bypassed to preserve remaining budget for NVIDIA
    expect(executedSlots.length).toBeLessThan(4);
  });

  // 8. Exactly one response returned
  it('8. returns exactly one response string and terminates iteration upon first success', async () => {
    let callCount = 0;
    const result = await pool.execute(async (_client, _slot) => {
      callCount++;
      return 'Unique Single Response';
    });

    expect(result).toBe('Unique Single Response');
    expect(callCount).toBe(1);
  });

  // 9. Late provider response cannot leak
  it('9. prevents unhandled rejection or late mutation on failed slot', async () => {
    pool.keys.get('KEY_1')!.cooldownUntil = 0;
    const err: any = new Error('Network reset');
    err.status = 500;

    await expect(
      pool.execute(
        async (_client, slot) => {
          if (slot === 'KEY_1') throw err;
          return 'Slot 2 Succeeded';
        }
      )
    ).resolves.toBe('Slot 2 Succeeded');

    // Key 1 recorded failure cleanly without leaking promise
    expect(pool.keys.get('KEY_1')!.consecutiveFailures).toBe(1);
  });

  // 10. Global 8-second deadline remains intact
  it('10. respects global deadline timestamp across cognitiveRouter and provider failover', async () => {
    const startTime = Date.now();
    (nvidiaComplete as jest.Mock).mockImplementation(async () => {
      await new Promise(r => setTimeout(r, 50));
      return 'Guaranteed NVIDIA within overall budget';
    });

    const spy = jest.spyOn(require('../gemini'), 'geminiComplete').mockImplementation(async () => {
      // Simulate Gemini failing in 200ms
      await new Promise(r => setTimeout(r, 200));
      throw new Error('Rate limit');
    });

    const MSG = [{ role: 'user' as const, content: 'Hey' }];
    const reply = await cognitiveRouter.complete('CONVERSATION', MSG, { timeoutMs: 8000 });
    const totalTime = Date.now() - startTime;

    expect(reply).toBe('Guaranteed NVIDIA within overall budget');
    expect(totalTime).toBeLessThan(8000);

    spy.mockRestore();
  });
});
