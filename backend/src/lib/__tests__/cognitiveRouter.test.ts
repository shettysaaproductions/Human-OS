/**
 * CognitiveModelRouter Tests — Phase 10.1
 *
 * Verifies:
 * - Routing decisions per workload
 * - Gemini primary → NVIDIA fallback behavior
 * - NVIDIA primary path
 * - Health status output
 */

import { cognitiveRouter, CapabilityUnavailableError } from '../../lib/cognitiveRouter';

jest.mock('../../lib/nvidia', () => ({
  complete: jest.fn(),
  stream: jest.fn(),
  determineUserProfile: jest.fn(() => 'USER_FAST'),
  canRunNvidia: jest.fn(() => true),
}));

jest.mock('../../lib/gemini', () => ({
  geminiComplete: jest.fn(),
  geminiCompleteJSON: jest.fn(),
  geminiStream: jest.fn(),
  getGeminiStatus: jest.fn(() => ({
    configured: true,
    keyCount: 2,
    availableKeys: 2,
    coolingKeys: 0,
    available: true,
    availableCount: 2,
    slots: { KEY_1: 'AVAILABLE', KEY_2: 'AVAILABLE' },
  })),
  isGeminiAvailable: jest.fn(() => true),
}));

jest.mock('../../lib/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

// Reload config with Gemini routing defaults
jest.mock('../../config', () => ({
  config: {
    gemini: {
      apiKey1: 'test-key-1',
      apiKey2: 'test-key-2',
      chatModel: 'gemini-2.0-flash',
    },
    nvidia: {
      apiKey: 'nvapi-test-key',
    },
    routing: {
      conversation: 'gemini',
      proactiveReasoning: 'gemini',
      proactiveGeneration: 'gemini',
      memoryExtraction: 'nvidia',
      lifeThreads: 'nvidia',
      actionIntelligence: 'nvidia',
      backgroundCognition: 'nvidia',
      vision: 'nvidia',
      turnAnalysis: 'nvidia',
    },
  },
}));

import { geminiComplete, getGeminiStatus, isGeminiAvailable } from '../../lib/gemini';
import { complete as nvidiaComplete, canRunNvidia } from '../../lib/nvidia';

const MSG = [
  { role: 'system' as const, content: 'You are Nova.' },
  { role: 'user' as const, content: 'Hello' },
];

describe('CognitiveModelRouter', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('Routing: CONVERSATION → Gemini', () => {
    it('calls geminiComplete for CONVERSATION workload', async () => {
      (geminiComplete as jest.Mock).mockResolvedValue('Heyyy!');
      const result = await cognitiveRouter.complete('CONVERSATION', MSG);
      expect(geminiComplete).toHaveBeenCalledTimes(1);
      expect(nvidiaComplete).not.toHaveBeenCalled();
      expect(result).toBe('Heyyy!');
    });

    it('falls back to NVIDIA when Gemini fails for CONVERSATION', async () => {
      (geminiComplete as jest.Mock).mockRejectedValue(new Error('Gemini rate limit'));
      (nvidiaComplete as jest.Mock).mockResolvedValue('Fallback reply');
      const result = await cognitiveRouter.complete('CONVERSATION', MSG);
      expect(geminiComplete).toHaveBeenCalledTimes(1);
      expect(nvidiaComplete).toHaveBeenCalledTimes(1);
      expect(result).toBe('Fallback reply');
    });

    it('throws when both Gemini and NVIDIA fail for CONVERSATION', async () => {
      (geminiComplete as jest.Mock).mockRejectedValue(new Error('Gemini down'));
      (nvidiaComplete as jest.Mock).mockRejectedValue(new Error('NVIDIA down'));
      await expect(cognitiveRouter.complete('CONVERSATION', MSG)).rejects.toThrow();
      expect(geminiComplete).toHaveBeenCalledTimes(1);
      expect(nvidiaComplete).toHaveBeenCalledTimes(1);
    });
  });

  describe('Routing: MEMORY_EXTRACTION → NVIDIA', () => {
    it('calls nvidiaComplete (not Gemini) for MEMORY_EXTRACTION workload', async () => {
      (nvidiaComplete as jest.Mock).mockResolvedValue('{}');
      const result = await cognitiveRouter.complete('MEMORY_EXTRACTION', MSG, { jsonMode: true });
      expect(nvidiaComplete).toHaveBeenCalledTimes(1);
      expect(geminiComplete).not.toHaveBeenCalled();
      expect(result).toBe('{}');
    });

    it('calls nvidiaComplete for LIFE_THREAD_EXTRACTION workload', async () => {
      (nvidiaComplete as jest.Mock).mockResolvedValue('{}');
      await cognitiveRouter.complete('LIFE_THREAD_EXTRACTION', MSG);
      expect(nvidiaComplete).toHaveBeenCalledTimes(1);
      expect(geminiComplete).not.toHaveBeenCalled();
    });

    it('calls nvidiaComplete for ACTION_INTELLIGENCE workload', async () => {
      (nvidiaComplete as jest.Mock).mockResolvedValue('{}');
      await cognitiveRouter.complete('ACTION_INTELLIGENCE', MSG);
      expect(nvidiaComplete).toHaveBeenCalledTimes(1);
      expect(geminiComplete).not.toHaveBeenCalled();
    });
  });

  describe('Routing: PROACTIVE_REASONING → Gemini', () => {
    it('calls geminiComplete for PROACTIVE_REASONING workload', async () => {
      (geminiComplete as jest.Mock).mockResolvedValue('{"shouldReach": false}');
      const result = await cognitiveRouter.complete('PROACTIVE_REASONING', MSG, { jsonMode: true });
      expect(geminiComplete).toHaveBeenCalledTimes(1);
      expect(result).toBe('{"shouldReach": false}');
    });
  });

  describe('Health status', () => {
    it('returns routing table and gemini status', () => {
      const status = cognitiveRouter.getStatus();
      expect(status).toHaveProperty('gemini');
      expect(status).toHaveProperty('routing');
      expect(status.routing.conversation).toBe('gemini');
      expect(status.routing.memoryExtraction).toBe('nvidia');
      expect(status.routing.lifeThreads).toBe('nvidia');
    });
  });

  describe('Capability Negotiation (completeWithCapability)', () => {
    it('calls Gemini when Gemini keys are available for DEEP_SEMANTIC_REASONING (score 2)', async () => {
      (isGeminiAvailable as jest.Mock).mockReturnValue(true);
      (geminiComplete as jest.Mock).mockResolvedValue('{"has_flaw": false}');

      const res = await cognitiveRouter.completeWithCapability(
        { capability: 'DEEP_SEMANTIC_REASONING', minReasoningScore: 2 },
        MSG
      );

      expect(geminiComplete).toHaveBeenCalledTimes(1);
      expect(nvidiaComplete).not.toHaveBeenCalled();
      expect(res).toBe('{"has_flaw": false}');
    });

    it('falls back to NVIDIA USER_DEEP when all Gemini keys are configured but cooling down', async () => {
      // 9 keys configured, but ALL cooling down
      (getGeminiStatus as jest.Mock).mockReturnValue({
        configured: true,
        keyCount: 9,
        available: false,
        availableCount: 0,
        slots: { KEY_1: 'COOLING_45s' }
      });
      (isGeminiAvailable as jest.Mock).mockReturnValue(false);
      (canRunNvidia as jest.Mock).mockReturnValue(true);
      (nvidiaComplete as jest.Mock).mockResolvedValue('{"has_flaw": false, "provider": "nvidia"}');

      const res = await cognitiveRouter.completeWithCapability(
        { capability: 'DEEP_SEMANTIC_REASONING', minReasoningScore: 2, jsonMode: true },
        MSG
      );

      // Gemini was skipped without burning quota/failing
      expect(geminiComplete).not.toHaveBeenCalled();
      // NVIDIA USER_DEEP was called
      expect(nvidiaComplete).toHaveBeenCalledWith(
        'USER_DEEP',
        MSG,
        expect.objectContaining({
          response_format: { type: 'json_object' }
        })
      );
      expect(res).toBe('{"has_flaw": false, "provider": "nvidia"}');
    });

    it('falls back to NVIDIA USER_DEEP if Gemini throws during execution', async () => {
      (isGeminiAvailable as jest.Mock).mockReturnValue(true);
      (geminiComplete as jest.Mock).mockRejectedValue(new Error('[Gemini] All 9 production keys on cooldown or deadline expired'));
      (canRunNvidia as jest.Mock).mockReturnValue(true);
      (nvidiaComplete as jest.Mock).mockResolvedValue('{"has_flaw": true, "fallback": true}');

      const res = await cognitiveRouter.completeWithCapability(
        { capability: 'DEEP_SEMANTIC_REASONING', minReasoningScore: 2 },
        MSG
      );

      expect(geminiComplete).toHaveBeenCalledTimes(1);
      expect(nvidiaComplete).toHaveBeenCalledWith('USER_DEEP', MSG, expect.any(Object));
      expect(res).toBe('{"has_flaw": true, "fallback": true}');
    });

    it('throws CapabilityUnavailableError if no provider satisfies required capability', async () => {
      (isGeminiAvailable as jest.Mock).mockReturnValue(false);
      (canRunNvidia as jest.Mock).mockReturnValue(false);

      await expect(
        cognitiveRouter.completeWithCapability(
          { capability: 'DEEP_SEMANTIC_REASONING', minReasoningScore: 2 },
          MSG
        )
      ).rejects.toThrow(CapabilityUnavailableError);
    });

    it('does not weaken required reasoning score when required score cannot be met', async () => {
      (isGeminiAvailable as jest.Mock).mockReturnValue(false);
      // NVIDIA available at score 2, but ROOT_CAUSE_DIAGNOSIS requires score 3
      (canRunNvidia as jest.Mock).mockReturnValue(true);

      let caughtError: any = null;
      try {
        await cognitiveRouter.completeWithCapability(
          { capability: 'ROOT_CAUSE_DIAGNOSIS', minReasoningScore: 3 },
          MSG
        );
      } catch (err: any) {
        caughtError = err;
      }

      expect(caughtError).toBeInstanceOf(CapabilityUnavailableError);
      expect(caughtError.capability).toBe('ROOT_CAUSE_DIAGNOSIS');
      expect(caughtError.requiredScore).toBe(3);
      expect(caughtError.availableScore).toBeLessThan(3);
    });
  });
});
