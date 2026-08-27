/**
 * CognitiveModelRouter Tests — Phase 10.1
 *
 * Verifies:
 * - Routing decisions per workload
 * - Gemini primary → NVIDIA fallback behavior
 * - NVIDIA primary path
 * - Health status output
 */

import { cognitiveRouter } from '../../lib/cognitiveRouter';

jest.mock('../../lib/nvidia', () => ({
  complete: jest.fn(),
  stream: jest.fn(),
  determineUserProfile: jest.fn(() => 'USER_FAST'),
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
  })),
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

import { geminiComplete } from '../../lib/gemini';
import { complete as nvidiaComplete } from '../../lib/nvidia';

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
});
