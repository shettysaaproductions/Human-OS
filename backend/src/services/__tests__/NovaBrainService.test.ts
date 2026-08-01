import { NovaBrainService } from '../NovaBrainService';
import { chatCompletion, chatCompletionBackground, chatCompletionStream } from '../../lib/nvidia';
import { promptBuilder } from '../promptBuilder';
import { logger } from '../../lib/logger';

jest.mock('../../lib/nvidia', () => ({
  chatCompletion: jest.fn(),
  chatCompletionBackground: jest.fn(),
  chatCompletionStream: jest.fn()
}));

jest.mock('../promptBuilder', () => ({
  promptBuilder: {
    buildSystemPrompt: jest.fn().mockReturnValue('MOCKED_SYSTEM_PROMPT')
  }
}));

jest.mock('../../lib/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn()
  }
}));

describe('NovaBrainService', () => {
  let service: NovaBrainService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new NovaBrainService();
  });

  describe('processInteraction', () => {
    it('Memory Retrieval: passes memories and profile to promptBuilder', async () => {
      (chatCompletion as jest.Mock).mockResolvedValue('<reply>Hello</reply><subconscious_actions>[]</subconscious_actions>');
      
      const context = {
        memories: ['mem1'],
        workingMemories: ['work1'],
        shortTermMemories: ['short1'],
        profile: { preferred_name: 'Alex', companion_personality: 'friendly' },
        memoryContext: 'CTX',
        lengthInstruction: 'SHORT',
        situationBrief: 'Working',
        recentCrossSessionContext: 'recent_ctx'
      };

      await service.processInteraction('u1', 'hi', context);

      expect(promptBuilder.buildSystemPrompt).toHaveBeenCalledWith(
        expect.any(String),
        ['mem1'],
        ['work1'],
        'Alex',
        'friendly',
        ['short1'],
        'auto',
        'recent_ctx',
        'HUMAN_CHAT',
        'Working'
      );
    });

    it('Handles null/undefined memory arrays gracefully', async () => {
      (chatCompletion as jest.Mock).mockResolvedValue('<reply>Hello</reply>');
      
      await service.processInteraction('u1', 'hi', {});

      expect(promptBuilder.buildSystemPrompt).toHaveBeenCalledWith(
        expect.any(String),
        [], // memories
        [], // working
        undefined, // name
        undefined, // personality
        [], // shortterm
        'auto',
        undefined,
        'HUMAN_CHAT',
        undefined
      );
    });

    it('Parses valid JSON array from <subconscious_actions> tag', async () => {
      (chatCompletion as jest.Mock).mockResolvedValue(
        `<reply>Got it!</reply>\n<subconscious_actions>\n[{"tool": "MemoryRepository", "action": "save"}]\n</subconscious_actions>`
      );
      
      const result = await service.processInteraction('u1', 'hi', {});
      expect(result.subconscious_actions).toEqual([{ tool: 'MemoryRepository', action: 'save' }]);
    });

    it('Returns empty array when no actions / Handles malformed JSON gracefully', async () => {
      (chatCompletion as jest.Mock).mockResolvedValue(
        `<reply>Got it!</reply>\n<subconscious_actions>\n[invalid json}\n</subconscious_actions>`
      );
      
      const result = await service.processInteraction('u1', 'hi', {});
      expect(result.subconscious_actions).toEqual([]);
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Failed to parse subconscious actions JSON'), expect.any(Object));
    });

    it('Handles missing tag gracefully (returns empty array)', async () => {
      (chatCompletion as jest.Mock).mockResolvedValue(`<reply>Got it!</reply>`);
      const result = await service.processInteraction('u1', 'hi', {});
      expect(result.subconscious_actions).toEqual([]);
    });

    it('Extracts reply from <reply> tags and strips XML bleed', async () => {
      (chatCompletion as jest.Mock).mockResolvedValue(
        `<reply>Hello there!</reply><subconscious_actions>[]</subconscious_actions>`
      );
      const result = await service.processInteraction('u1', 'hi', {});
      expect(result.reply).toBe('Hello there!');
    });

    it('Uses fallback when reply tag missing', async () => {
      (chatCompletion as jest.Mock).mockResolvedValue(
        `This is a raw reply without tags.<subconscious_actions>[]</subconscious_actions>`
      );
      const result = await service.processInteraction('u1', 'hi', {});
      expect(result.reply).toBe('This is a raw reply without tags.');
    });

    it('Uses absolute fallback "Yaar, ek second ruk." when empty', async () => {
      (chatCompletion as jest.Mock).mockResolvedValue(`<reply></reply>`);
      const result = await service.processInteraction('u1', 'hi', {});
      expect(result.reply).toBe('Yaar, ek second ruk.');
    });

    it('Throws on LLM failure and logs error', async () => {
      (chatCompletion as jest.Mock).mockRejectedValue(new Error('API Down'));
      await expect(service.processInteraction('u1', 'hi', {})).rejects.toThrow('API Down');
      expect(logger.error).toHaveBeenCalledWith('[NOVA BRAIN] LLM failure', expect.any(Object));
    });
  });

  describe('streamInteraction', () => {
    it('Yields reply chunks and returns subconscious actions at end', async () => {
      async function* mockStream() {
        yield '<reply>';
        yield 'chunk1';
        yield 'chunk2';
        yield '</reply>';
        yield '<subconscious_actions>[{"tool":"A"}]</subconscious_actions>';
      }
      
      (chatCompletionStream as jest.Mock).mockImplementation(mockStream);
      let result;

      const gen2 = service.streamInteraction('u1', 'hi', {});
      let next = await gen2.next();
      const chunks2 = [];
      while (!next.done) {
        chunks2.push(next.value);
        next = await gen2.next();
      }
      result = next.value; // The return value

      expect(chunks2).toEqual(['chunk1', 'chunk2']);
      expect(result).toEqual({ subconscious_actions: [{ tool: 'A' }] });
    });
  });

  describe('Consciousness Tiers', () => {
    it('evaluateConsciousnessTier1: parses JSON reach decision', async () => {
      (chatCompletionBackground as jest.Mock).mockResolvedValue(JSON.stringify({ shouldReach: true, reason: 'test' }));
      const result = await service.evaluateConsciousnessTier1('ctx');
      expect(result).toEqual({ shouldReach: true, reason: 'test' });
    });

    it('evaluateConsciousnessTier2: generates message with tone, uses temp=0.85', async () => {
      (chatCompletionBackground as jest.Mock).mockResolvedValue(JSON.stringify({ message: 'hey', tone: 'playful' }));
      const result = await service.evaluateConsciousnessTier2('ctx');
      expect(result).toEqual({ message: 'hey', tone: 'playful' });
      expect(chatCompletionBackground).toHaveBeenCalledWith(expect.any(Array), expect.objectContaining({ temperature: 0.85 }));
    });

    it('evaluateGoalFollowup: includes preferred name, avoids past IDs', async () => {
      (chatCompletionBackground as jest.Mock).mockResolvedValue(JSON.stringify({ shouldNotify: true }));
      await service.evaluateGoalFollowup('Alex', ['goal1'], ['past1']);
      expect(chatCompletionBackground).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            content: expect.stringContaining('Alex')
          })
        ]),
        expect.any(Object)
      );
    });

    it('evaluateDailyReflection: returns summary + takeaways', async () => {
      (chatCompletionBackground as jest.Mock).mockResolvedValue(JSON.stringify({ summary: 'good', key_takeaways: ['t1'] }));
      const res = await service.evaluateDailyReflection('m', 'e', 'g');
      expect(res).toEqual({ summary: 'good', key_takeaways: ['t1'] });
    });

    it('evaluateWeeklyReflection: returns macro trends', async () => {
      (chatCompletionBackground as jest.Mock).mockResolvedValue(JSON.stringify({ summary: 'week', key_takeaways: ['t1'] }));
      const res = await service.evaluateWeeklyReflection('summaries');
      expect(res).toEqual({ summary: 'week', key_takeaways: ['t1'] });
    });

    it('refineMoment: validates without inventing facts', async () => {
      (chatCompletionBackground as jest.Mock).mockResolvedValue(JSON.stringify({ title: 't', body: 'b' }));
      const res = await service.refineMoment('test_type', { foo: 'bar' });
      expect(res).toEqual({ title: 't', body: 'b' });
    });
  });
});
