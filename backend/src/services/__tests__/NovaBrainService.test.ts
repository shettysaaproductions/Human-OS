import { NovaBrainService, sanitizeReply } from '../NovaBrainService';
import { complete, stream } from '../../lib/nvidia';
import { promptBuilder } from '../promptBuilder';
import { logger } from '../../lib/logger';

// Legacy test aliases keep the behavioral assertions compact while production
// code now calls the profile API.
const chatCompletion = complete;
const chatCompletionBackground = complete;
const chatCompletionStream = stream;

jest.mock('../../lib/nvidia', () => ({
  complete: jest.fn(),
  determineUserProfile: jest.fn((message: string) => message.length > 90 ? 'USER_DEEP' : 'USER_FAST'),
  stream: jest.fn()
}));

// Phase 10.1: CognitiveModelRouter mock — delegates complete/stream to nvidia mock
// so all existing test value assertions still work.
jest.mock('../../lib/cognitiveRouter', () => ({
  cognitiveRouter: {
    complete: jest.fn(async (workload: string, messages: any[], options: any) => {
      // Delegate to nvidia.complete mock so tests can control the return value
      const { complete } = jest.requireMock('../../lib/nvidia');
      return complete(workload, messages, options);
    }),
    stream: jest.fn(async function*(workload: string, messages: any[], options: any) {
      const { stream } = jest.requireMock('../../lib/nvidia');
      yield* stream(workload, messages, options);
    }),
  },
}));


jest.mock('../BackgroundActionService', () => ({
  backgroundActions: {
    processCriticalActions: jest.fn().mockResolvedValue(undefined)
  }
}));

jest.mock('../../lib/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn()
  }
}));

jest.mock('../promptBuilder', () => ({
  promptBuilder: {
    buildSystemPrompt: jest.fn().mockReturnValue('SYSTEM PROMPT HERE')
  }
}));

describe('NovaBrainService', () => {
  let service: NovaBrainService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new NovaBrainService();
  });

  describe('4.1 Memory Retrieval', () => {
    it('should pass memories into the system prompt via promptBuilder', async () => {
      (complete as jest.Mock).mockResolvedValue('<reply>Hello</reply>');
      const memories = [{ id: 'mem-1', content: 'User wants to learn guitar' }];
      await service.processInteraction('u1', [{ client_message_id: 'test-uuid', message: 'hi' }], { memories });
      // 2nd arg is memories
      expect(promptBuilder.buildSystemPrompt).toHaveBeenCalledWith(
        expect.any(String),
        memories,
        expect.any(Array),
        undefined,
        undefined,
        expect.any(Array),
        'auto',
        undefined,
        'HUMAN_CHAT',
        undefined,
        undefined,
        undefined
      );
    });

    it('should pass workingMemories into the system prompt', async () => {
      (complete as jest.Mock).mockResolvedValue('<reply>Hello</reply>');
      const workingMemories = ['work1'];
      await service.processInteraction('u1', [{ client_message_id: 'test-uuid', message: 'hi' }], { workingMemories });
      // 3rd arg is workingMemories
      expect(promptBuilder.buildSystemPrompt).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Array),
        workingMemories,
        undefined,
        undefined,
        expect.any(Array),
        'auto',
        undefined,
        'HUMAN_CHAT',
        undefined,
        undefined,
        undefined
      );
    });

    it('should pass shortTermMemories into the system prompt', async () => {
      (complete as jest.Mock).mockResolvedValue('<reply>Hello</reply>');
      const shortTermMemories = ['short1'];
      await service.processInteraction('u1', [{ client_message_id: 'test-uuid', message: 'hi' }], { shortTermMemories });
      // 6th arg is shortTermMemories
      expect(promptBuilder.buildSystemPrompt).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Array),
        expect.any(Array),
        undefined,
        undefined,
        shortTermMemories,
        'auto',
        undefined,
        'HUMAN_CHAT',
        undefined,
        undefined,
        undefined
      );
    });

    it('should pass profile data', async () => {
      (complete as jest.Mock).mockResolvedValue('<reply>Hello</reply>');
      const profile = { preferred_name: 'Bhai', companion_personality: 'sarcastic' };
      await service.processInteraction('u1', [{ client_message_id: 'test-uuid', message: 'hi' }], { profile });
      expect(promptBuilder.buildSystemPrompt).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Array),
        expect.any(Array),
        'Bhai',
        'sarcastic',
        expect.any(Array),
        'auto',
        undefined,
        'HUMAN_CHAT',
        undefined,
        undefined,
        undefined
      );
    });

    it('should include memoryContext and lengthInstruction in the prompt', async () => {
      (chatCompletion as jest.Mock).mockResolvedValue('<reply>Hello</reply>');
      const context = { memoryContext: 'Some memory context', lengthInstruction: 'Be very brief' };
      await service.processInteraction('u1', [{ client_message_id: 'test-uuid', message: 'hi' }], context);

      const call = (chatCompletion as jest.Mock).mock.calls.find(c => c[0] === 'USER_FAST' || c[0] === 'USER_DEEP');
      const args = call ? call[1] : (chatCompletion as jest.Mock).mock.calls.find((c: any) => c[0] !== 'CRITICAL_ACTION')[1];
      const systemMsg = args.find((m: any) => m.role === 'system').content;
      expect(systemMsg).toContain('Some memory context');
      expect(systemMsg).toContain('Be very brief');
    });

    it('should include temporalContextBlock and remindersContext in the prompt', async () => {
      (chatCompletion as jest.Mock).mockResolvedValue('<reply>Hello</reply>');
      const context = {
        memoryContext: 'mem',
        temporalContextBlock: '## WHAT WAS SAID RECENTLY\n[Today] You: told you about the trip',
        remindersContext: '## ACTIVE REMINDERS (SOURCE OF TRUTH)\n- take medicine at 10am'
      };
      await service.processInteraction('u1', [{ client_message_id: 'test-uuid', message: 'hi' }], context);

      const call = (chatCompletion as jest.Mock).mock.calls.find(c => c[0] === 'USER_FAST' || c[0] === 'USER_DEEP');
      const args = call ? call[1] : (chatCompletion as jest.Mock).mock.calls.find((c: any) => c[0] !== 'CRITICAL_ACTION')[1];
      const systemMsg = args.find((m: any) => m.role === 'system').content;
      expect(systemMsg).toContain('## WHAT WAS SAID RECENTLY');
      expect(systemMsg).toContain('told you about the trip');
      expect(systemMsg).toContain('take medicine at 10am');
    });

    it('should handle empty/null memory arrays gracefully', async () => {
      (chatCompletion as jest.Mock).mockResolvedValue('<reply>Hello</reply>');
      await service.processInteraction('u1', [{ client_message_id: 'test-uuid', message: 'hi' }], { memories: null, workingMemories: undefined, shortTermMemories: null });
      expect(promptBuilder.buildSystemPrompt).toHaveBeenCalledWith(
        expect.any(String),
        [],
        [],
        undefined,
        undefined,
        [],
        'auto',
        undefined,
        'HUMAN_CHAT',
        undefined,
        undefined,
        undefined
      );
    });
  });

  describe('4.2 Subconscious Actions Parsing', () => {
    it('should parse valid subconscious_actions JSON array', async () => {
      (chatCompletion as jest.Mock).mockResolvedValue(
        `<reply>Got it!</reply>\n<subconscious_actions>\n[{"tool":"MomentEngine","action":"extract"}, {"tool":"MemoryRepository"}]\n</subconscious_actions>`
      );
      const result = await service.processInteraction('u1', [{ client_message_id: 'test-uuid', message: 'hi' }], {});
      // Layer 2 actions are now durably queued rather than returned inline.
      expect(result.subconscious_actions).toEqual([]);
    });

    it('should return empty array when no subconscious actions', async () => {
      (chatCompletion as jest.Mock).mockResolvedValue(
        `<reply>Got it!</reply>\n<subconscious_actions>\n[]\n</subconscious_actions>`
      );
      const result = await service.processInteraction('u1', [{ client_message_id: 'test-uuid', message: 'hi' }], {});
      expect(result.subconscious_actions).toEqual([]);
    });

    it('should handle malformed JSON gracefully', async () => {
      (chatCompletion as jest.Mock).mockResolvedValue(
        `<reply>Got it!</reply>\n<subconscious_actions>\n[invalid json}\n</subconscious_actions>`
      );
      const result = await service.processInteraction('u1', [{ client_message_id: 'test-uuid', message: 'hi' }], {});
      expect(result.subconscious_actions).toEqual([]);
      expect(logger.warn).not.toHaveBeenCalledWith(expect.stringContaining('Failed to parse subconscious actions JSON'), expect.any(Object));
    });

    it('should handle missing subconscious_actions tag', async () => {
      (chatCompletion as jest.Mock).mockResolvedValue(`Just a plain reply`);
      const result = await service.processInteraction('u1', [{ client_message_id: 'test-uuid', message: 'hi' }], {});
      expect(result.subconscious_actions).toEqual([]);
    });
  });

  describe('4.3 Reply Parsing & Fallbacks', () => {
    it('should extract reply from <reply> tags', async () => {
      (chatCompletion as jest.Mock).mockResolvedValue(
        `<reply>Hello Yaar!</reply><subconscious_actions>[]</subconscious_actions>`
      );
      const result = await service.processInteraction('u1', [{ client_message_id: 'test-uuid', message: 'hi' }], {});
      expect(result.reply).toBe('Hello Yaar!');
    });

    it('should strip XML bleed from reply text', async () => {
      (chatCompletion as jest.Mock).mockResolvedValue(
        `Hello Yaar!<subconscious_actions>[{"tool":"A"}]</subconscious_actions>`
      );
      const result = await service.processInteraction('u1', [{ client_message_id: 'test-uuid', message: 'hi' }], {});
      expect(result.reply).not.toContain('<subconscious_actions>');
      expect(result.reply).not.toContain('tool');
    });

    it('should use fallback when reply tag missing', async () => {
      (chatCompletion as jest.Mock).mockResolvedValue(
        `Some text before <subconscious_actions>[]</subconscious_actions>`
      );
      const result = await service.processInteraction('u1', [{ client_message_id: 'test-uuid', message: 'hi' }], {});
      expect(result.reply).toBe('Some text before');
    });

    it('should use absolute last resort fallback when reply is empty', async () => {
      (chatCompletion as jest.Mock).mockResolvedValue(`<subconscious_actions>[]</subconscious_actions>`);
      const result = await service.processInteraction('u1', [{ client_message_id: 'test-uuid', message: 'hi' }], {});
      // NOVA_EMPTY_REPLY — in-voice "friend blaming network", never debug jargon
      expect(result.reply).toBe('Hmm... mujhe thoda sochne de, main abhi batati hu thodi der me.');
    });
  });

  describe('4.4 Error Handling', () => {
    it('should throw on LLM failure', async () => {
      (chatCompletion as jest.Mock).mockRejectedValue(new Error('NVIDIA API timeout'));
      await expect(service.processInteraction('u1', [{ client_message_id: 'test-uuid', message: 'hi' }], {})).rejects.toThrow('NVIDIA API timeout');
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('4.5 streamInteraction', () => {
    it('should yield reply chunks and return subconscious actions', async () => {
      async function* mockStream() {
        yield '<reply>';
        yield 'chunk1';
        yield 'chunk2';
        yield '</reply>';
        yield '<subconscious_actions>[{"tool":"A"}]</subconscious_actions>';
      }
      
      (chatCompletionStream as jest.Mock).mockImplementation(mockStream);
      let result;

      const gen = service.streamInteraction('u1', [{ client_message_id: 'test-uuid', message: 'hi' }], {});
      let next = await gen.next();
      const chunks = [];
      while (!next.done) {
        chunks.push(next.value);
        next = await gen.next();
      }
      result = next.value; 

      expect(chunks.join('')).toContain('chunk1chunk2');
      expect(result).toEqual({ subconscious_actions: [] });
    });
  });

  describe('4.6 Consciousness Tiers', () => {
    it('evaluateConsciousnessTier1: should parse JSON reach decision', async () => {
      (chatCompletionBackground as jest.Mock).mockResolvedValue(JSON.stringify({ shouldReach: true, reason: 'Pending agenda', triggerType: 'agenda' }));
      const result = await service.evaluateConsciousnessTier1('ctx');
      expect(result.shouldReach).toBe(true);
    });

    it('evaluateConsciousnessTier2: should generate message with tone', async () => {
      (chatCompletionBackground as jest.Mock).mockResolvedValue(JSON.stringify({ message: 'hey', tone: 'playful' }));
      const result = await service.evaluateConsciousnessTier2('ctx');
      expect(result.message).toBeDefined();
      expect(result.tone).toBeDefined();
      expect(chatCompletionBackground).toHaveBeenCalledWith('PROACTIVE_GENERATION', expect.any(Array), expect.objectContaining({ temperature: 0.85, maxTokens: 200 }));
    });

    it('evaluateGoalFollowup: should include preferred name and avoid past IDs', async () => {
      (chatCompletionBackground as jest.Mock).mockResolvedValue(JSON.stringify({ shouldNotify: true }));
      await service.evaluateGoalFollowup('Alex', ['goal1'], ['past1']);
      
      const args = (chatCompletionBackground as jest.Mock).mock.calls[0][1];
      const userMsg = args.find((m: any) => m.role === 'user').content;
      
      expect(userMsg).toContain('Alex');
      expect(userMsg).toContain('past1');
    });

    it('evaluateDailyReflection: should return summary and takeaways', async () => {
      (chatCompletionBackground as jest.Mock).mockResolvedValue(JSON.stringify({ summary: 'good', key_takeaways: ['t1'] }));
      const res = await service.evaluateDailyReflection('m', 'e', 'g');
      expect(res.summary).toBeDefined();
      expect(res.key_takeaways).toBeDefined();
    });

    it('evaluateWeeklyReflection: should return macro trends', async () => {
      (chatCompletionBackground as jest.Mock).mockResolvedValue(JSON.stringify({ summary: 'week', key_takeaways: ['trend1'] }));
      const res = await service.evaluateWeeklyReflection('summaries');
      expect(res.key_takeaways).toContain('trend1');
    });

    it('refineMoment: should validate without inventing facts', async () => {
      (chatCompletionBackground as jest.Mock).mockResolvedValue(JSON.stringify({ title: 't', body: 'b' }));
      await service.refineMoment('test_type', { foo: 'bar' });
      
      const args = (chatCompletionBackground as jest.Mock).mock.calls[0][1];
      const userMsg = args.find((m: any) => m.role === 'user').content;
      
      expect(userMsg).toContain('Do NOT make up');
    });
  });

  describe('sanitizeReply (anti-robot formatting guard)', () => {
    it('strips bold markdown', () => {
      expect(sanitizeReply('**Hi Again!** 😊')).toBe('Hi Again! 😊');
    });
    it('strips numbered-list and bullet markers', () => {
      expect(sanitizeReply('1. Day\'s Highlight\n- Just chatting')).toBe("Day's Highlight\nJust chatting");
    });
    it('strips the leaked (subconscious_actions: ) pseudo-label', () => {
      expect(sanitizeReply('Arey, kaam chal raha hai (subconscious_actions: ) haan.')).toBe('Arey, kaam chal raha hai haan.');
    });
    it('collapses repeated emoji sequences', () => {
      expect(sanitizeReply('Hello 😊😊😊 there')).toBe('Hello 😊 there');
    });
  });
});
